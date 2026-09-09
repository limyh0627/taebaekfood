import { describe, it, expect } from 'vitest';
import {
  applyRawCommand, emptyRawInventory, operationDocId, inventoryDocId,
  type RawInventoryState, type RawInventoryCommand, type RawInventoryMovement,
} from './rawInventoryCore';

/**
 * 설계 §16 이 "반드시 잠그라"고 한 것 중 **순수 계산으로 잡을 수 있는 것들**.
 * 트랜잭션이 실제로 둘을 같이 쓰는지는 3단계(에뮬레이터)에서 잠근다.
 *
 * 이 시험들이 지키는 한 줄: **같은 명령을 두 번 보내도 재고는 한 번만 움직인다.**
 * 지금 앱이 못 지켜서 원료 18개 중 7개가 갈렸다(2026-09-09 조사, 절대값 합 2,719kg).
 */

const NOW = '2026-09-09T00:00:00.000Z';

const 상태 = (o: Partial<RawInventoryState> = {}): RawInventoryState => ({
  ...emptyRawInventory('taebaek', 'raw-깨분', '깨분', NOW),
  ...o,
});

const 명령 = (o: Partial<RawInventoryCommand> = {}): RawInventoryCommand => ({
  operationId: 'op-1',
  companyId: 'taebaek',
  rawItemId: 'raw-깨분',
  materialSnapshot: '깨분',
  effectiveDate: '2026-09-09',
  source: { type: 'manual', id: 'm1' },
  kind: 'receive',
  kg: 100,
  lot: { supplierName: '청정' },
  ...o,
} as RawInventoryCommand);

/** 적용해서 다음 상태를 얻는다 — 안 되면 이유를 그대로 터뜨린다. */
const 적용 = (
  state: RawInventoryState | null, command: RawInventoryCommand,
  det: Record<string, string> = {}, original?: RawInventoryMovement,
) => {
  const r = applyRawCommand({
    state, command, original,
    det: { now: NOW, newLotId: 'L1', carryOverLotId: 'C1', ...det },
  });
  if (r.status !== 'applied') throw new Error(`applied 가 아니다: ${JSON.stringify(r)}`);
  return r;
};

describe('원료 재고 코어 — 등식', () => {
  it('stockKg 는 언제나 활성 로트 합이다', () => {
    const a = 적용(상태(), 명령({ kg: 100 }));
    expect(a.state.stockKg).toBe(100);

    const b = 적용(a.state, 명령({ operationId: 'op-2', kind: 'consume', kg: 30 } as never));
    expect(b.state.stockKg).toBe(70);
    expect(b.state.stockKg).toBe(
      b.state.activeLots.reduce((s, l) => s + l.kgRemaining, 0),
    );
  });

  it('소진된 로트는 활성에서 빠지고 보존 배열로 물러난다', () => {
    const a = 적용(상태(), 명령({ kg: 50 }));
    const b = 적용(a.state, 명령({ operationId: 'op-2', kind: 'consume', kg: 50 } as never));
    expect(b.state.activeLots).toHaveLength(0);
    expect(b.state.recentDepletedLots.map(l => l.id)).toContain('L1');
    expect(b.state.stockKg).toBe(0);
  });
});

describe('같은 작업은 한 번만 먹는다', () => {
  it('같은 operationId 를 두 번 보내면 두 번째는 duplicate 다', () => {
    const a = 적용(상태(), 명령({ kg: 100 }));
    const 두번째 = applyRawCommand({
      state: a.state, command: 명령({ kg: 100 }),
      existing: a.movement,
      det: { now: NOW, newLotId: 'L2' },
    });
    expect(두번째.status).toBe('duplicate');
    //  재고가 안 움직인다 — 200 이 되면 안 된다.
    if (두번째.status === 'duplicate') expect(두번째.movement.operationId).toBe('op-1');
    expect(a.state.stockKg).toBe(100);
  });

  it('생산 취소를 다시 보내도 이중 복원되지 않는다', () => {
    const 입고 = 적용(상태(), 명령({ kg: 100 }));
    const 사용 = 적용(입고.state, 명령({ operationId: 'prod-1', kind: 'consume', kg: 40 } as never));
    const 취소 = 적용(사용.state, 명령({
      operationId: 'reverse_prod-1', kind: 'reverse', originalOperationId: 'prod-1',
      source: { type: 'reversal', id: 'prod-1' },
    } as never), {}, 사용.movement);
    expect(취소.state.stockKg).toBe(100);

    const 또취소 = applyRawCommand({
      state: 취소.state,
      command: 명령({ operationId: 'reverse_prod-1', kind: 'reverse', originalOperationId: 'prod-1' } as never),
      existing: 취소.movement,
      det: { now: NOW },
    });
    expect(또취소.status).toBe('duplicate');
    expect(취소.state.stockKg).toBe(100);
  });
});

describe('회사 경계', () => {
  it('풍회 명령이 태백 상태를 못 건드린다', () => {
    const r = applyRawCommand({
      state: 상태(),
      command: 명령({ companyId: 'punghoe' }),
      det: { now: NOW, newLotId: 'L1' },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.reason).toContain('대상이 다르다');
  });

  it('상태 문서 id 가 회사와 품목을 둘 다 담는다', () => {
    expect(inventoryDocId('taebaek', 'raw-깨분')).toBe('taebaek__raw-깨분');
    expect(inventoryDocId('punghoe', 'raw-깨분')).toBe('punghoe__raw-깨분');
  });
});

describe('FIFO 와 되돌리기', () => {
  const 두로트 = () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 60 }), { newLotId: 'L1' });
    return 적용(a.state, 명령({ operationId: 'in-2', kg: 40, lot: { supplierName: '대성' } } as never), { newLotId: 'L2' });
  };

  it('먼저 들어온 로트부터 빠진다', () => {
    const s = 두로트();
    const used = 적용(s.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 70 } as never));
    const byId = new Map(used.state.activeLots.map(l => [l.id, l.kgRemaining]));
    expect(byId.get('L1')).toBeUndefined();   // 60 다 쓰고 소진
    expect(byId.get('L2')).toBe(30);          // 나머지 10 은 두 번째에서
  });

  it('되돌리면 원본이 적은 로트 그대로 돌아간다', () => {
    const s = 두로트();
    const used = 적용(s.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 70 } as never));
    //  되돌리기 전에 입고가 하나 더 들어와도, FIFO 로 다시 계산하지 않고 원본 분배대로 복원한다.
    const extra = 적용(used.state, 명령({ operationId: 'in-3', kg: 5 } as never), { newLotId: 'L3' });
    const rev = 적용(extra.state, 명령({
      operationId: 'reverse_use-1', kind: 'reverse', originalOperationId: 'use-1',
    } as never), {}, used.movement);

    const byId = new Map(rev.state.activeLots.map(l => [l.id, l.kgRemaining]));
    expect(byId.get('L1')).toBe(60);   // 소진됐던 로트가 되살아난다
    expect(byId.get('L2')).toBe(40);
    expect(byId.get('L3')).toBe(5);
    expect(rev.state.stockKg).toBe(105);
    expect(rev.movement.reversalOf).toBe('use-1');
  });

  it('이미 사용된 입고는 취소하지 못한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const used = 적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 80 } as never));
    const r = applyRawCommand({
      state: used.state,
      command: 명령({ operationId: 'reverse_in-1', kind: 'reverse', originalOperationId: 'in-1' } as never),
      original: a.movement,
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.reason).toContain('이미 사용된 입고');
  });

  it('원본 이력은 되돌려도 그대로 남는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const before = JSON.stringify(a.movement);
    적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 10 } as never));
    expect(JSON.stringify(a.movement)).toBe(before);
  });
});

describe('실사와 소급 입력', () => {
  it('실사는 목표량으로 맞추고 앵커를 남긴다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 80, effectiveDate: '2026-09-08',
    } as never));
    expect(s.state.stockKg).toBe(80);
    expect(s.state.lastStocktakeDate).toBe('2026-09-08');
    expect(s.state.lastStocktakeOperationId).toBe('st-1');
    expect(s.movement.targetKg).toBe(80);
  });

  it('실사보다 앞선 날짜의 사용은 재고를 안 움직인다', () => {
    //  참깨가 이 경우였다 — 8/20 앵커 뒤에 8/17·8/19 사용을 넣어 로트만 깎였다.
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 100, effectiveDate: '2026-08-20',
    } as never));
    const back = 적용(s.state, 명령({
      operationId: 'use-old', kind: 'consume', kg: 30, effectiveDate: '2026-08-17',
    } as never));

    expect(back.state.stockKg).toBe(100);              // 잔량 그대로
    expect(back.movement.appliedDeltaKg).toBe(0);
    expect(back.movement.reportedDeltaKg).toBe(-30);   // 업무 수량은 남는다(서류가 본다)
    expect(back.movement.backdatedBeforeStocktake).toBe(true);
    expect(back.movement.lotChanges).toEqual([]);
  });

  it('소급으로 적힌 줄을 되돌려도 재고가 안 움직인다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({ operationId: 'st-1', kind: 'stocktake', targetKg: 100, effectiveDate: '2026-08-20' } as never));
    const back = 적용(s.state, 명령({ operationId: 'use-old', kind: 'consume', kg: 30, effectiveDate: '2026-08-17' } as never));
    const rev = applyRawCommand({
      state: back.state,
      command: 명령({ operationId: 'reverse_use-old', kind: 'reverse', originalOperationId: 'use-old', effectiveDate: '2026-09-09' } as never),
      original: back.movement,
      det: { now: NOW },
    });
    expect(rev.status).toBe('applied');
    if (rev.status === 'applied') expect(rev.state.stockKg).toBe(100);
  });
});

describe('로트 삭제는 지우지 않고 소진 처리한다', () => {
  it('남은 양만큼 빠지고 이력이 남는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const d = 적용(a.state, 명령({ operationId: 'del-L1', kind: 'delete-lot', lotId: 'L1' } as never));
    expect(d.state.stockKg).toBe(0);
    expect(d.movement.lotChanges).toEqual([
      expect.objectContaining({ lotId: 'L1', deltaKg: -100, kgAfter: 0 }),
    ]);
    //  기록은 남는다 — hard delete 가 아니다.
    expect(d.state.recentDepletedLots.map(l => l.id)).toContain('L1');
  });

  it('없는 로트는 거절한다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ operationId: 'del-x', kind: 'delete-lot', lotId: '없음' } as never),
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
  });
});

describe('트랜잭션 안에서 여러 번 돌아도 같다', () => {
  it('같은 입력이면 결과가 글자 하나까지 같다', () => {
    //  §6 — 콜백은 경합하면 여러 번 돈다. 안에서 Date.now()·난수를 쓰면 재시도마다 달라진다.
    const a = applyRawCommand({ state: 상태(), command: 명령({ kg: 100 }), det: { now: NOW, newLotId: 'L1' } });
    const b = applyRawCommand({ state: 상태(), command: 명령({ kg: 100 }), det: { now: NOW, newLotId: 'L1' } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('로트 id 를 안 넘기면 거절한다 — 안에서 만들지 않는다', () => {
    const r = applyRawCommand({ state: 상태(), command: 명령({ kg: 100 }), det: { now: NOW } });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.reason).toContain('로트 id');
  });
});

describe('작업 id 를 문서 id 로 쓸 수 있게 다듬는다', () => {
  it('경로를 가르는 문자를 바꾼다', () => {
    expect(operationDocId('purchase:po-1:line/2:raw-깨분')).toBe('purchase:po-1:line_2:raw-깨분');
    expect(operationDocId('a.b')).toBe('a_b');
  });

  it('Firestore 가 막는 모양을 피한다', () => {
    expect(operationDocId('__proto__')).toBe('op___proto__');
    expect(operationDocId('')).toBe('op_');
  });
});

describe('이력이 셈의 근거를 남긴다', () => {
  it('순번은 상태 version 과 같이 올라간다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    expect(a.movement.sequence).toBe(1);
    expect(a.state.version).toBe(1);
    const b = 적용(a.state, 명령({ operationId: 'in-2', kg: 10 } as never), { newLotId: 'L2' });
    expect(b.movement.sequence).toBe(2);
    expect(b.state.version).toBe(2);
  });

  it('업무 수량과 실제 적용량을 따로 적는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    expect(a.movement.reportedDeltaKg).toBe(100);
    expect(a.movement.appliedDeltaKg).toBe(100);
    expect(a.movement.balanceAfterKg).toBe(100);
  });

  it('사용 이력이 어느 로트에서 얼마가 빠졌는지 적는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const u = 적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 30 } as never));
    expect(u.movement.lotChanges).toEqual([
      expect.objectContaining({ lotId: 'L1', deltaKg: -30, kgAfter: 70 }),
    ]);
  });
});

describe('빈 입력을 거절한다', () => {
  it.each([
    ['입고 0', 명령({ kg: 0 })],
    ['입고 음수', 명령({ kg: -5 })],
    ['사용 0', 명령({ kind: 'consume', kg: 0 } as never)],
  ])('%s', (_, cmd) => {
    const r = applyRawCommand({ state: 상태(), command: cmd, det: { now: NOW, newLotId: 'L1' } });
    expect(r.status).toBe('rejected');
  });

  it('원본 없는 되돌리기를 거절한다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ kind: 'reverse', originalOperationId: '없음' } as never),
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
  });

  it('되돌리기를 또 되돌리지 못한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const rev = 적용(a.state, 명령({ operationId: 'rev-1', kind: 'reverse', originalOperationId: 'in-1' } as never), {}, a.movement);
    const r = applyRawCommand({
      state: rev.state,
      command: 명령({ operationId: 'rev-2', kind: 'reverse', originalOperationId: 'rev-1' } as never),
      original: rev.movement as RawInventoryMovement,
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
  });
});
