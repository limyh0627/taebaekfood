import { describe, it, expect } from 'vitest';
import {
  applyRawCommand, emptyRawInventory, operationDocId, inventoryDocId, commandHash,
  type RawInventoryState, type RawInventoryCommand, type RawInventoryMovement, type ReversalGuard,
} from './rawInventoryCore';

/**
 * 설계 §16 이 "반드시 잠그라"고 한 것 중 **순수 계산으로 잡을 수 있는 것들**.
 * 트랜잭션이 실제로 셋을 같이 쓰는지는 서비스 시험에서 잠근다(에뮬레이터).
 *
 * 이 시험들이 지키는 한 줄: **같은 명령을 두 번 보내면 한 번만 먹고, 내용이 달라지면 conflict.**
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
  effectiveAt: '2026-09-09T09:00:00.000Z',
  source: { type: 'manual', id: 'm1' },
  kind: 'receive',
  kg: 100,
  lot: { supplierName: '청정' },
  ...o,
} as RawInventoryCommand);

/** 적용해서 다음 상태를 얻는다 — 안 되면 이유를 그대로 터뜨린다. */
const 적용 = (
  state: RawInventoryState | null, command: RawInventoryCommand,
  det: Record<string, string> = {}, original?: RawInventoryMovement, guard?: ReversalGuard,
) => {
  const r = applyRawCommand({
    state, command, original, guard,
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

  it('소진된 로트는 활성에서 빠지고 보존 배열로 물러난다 (화면 캐시)', () => {
    const a = 적용(상태(), 명령({ kg: 50 }));
    const b = 적용(a.state, 명령({ operationId: 'op-2', kind: 'consume', kg: 50 } as never));
    expect(b.state.activeLots).toHaveLength(0);
    expect(b.state.recentDepletedLots.map(l => l.id)).toContain('L1');
    expect(b.state.stockKg).toBe(0);
  });
});

describe('revision 규칙 (설계 §4)', () => {
  it('applied 에서만 +1 · 언제나 최신 sequence 와 같다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    expect(a.state.revision).toBe(1);
    expect(a.movement.sequence).toBe(1);

    const b = 적용(a.state, 명령({ operationId: 'in-2', kg: 10 } as never), { newLotId: 'L2' });
    expect(b.state.revision).toBe(2);
    expect(b.movement.sequence).toBe(2);
  });

  it('duplicate 는 revision 을 안 올린다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const 두번째 = applyRawCommand({
      state: a.state, command: 명령({ operationId: 'in-1', kg: 100 }),
      existing: a.movement, det: { now: NOW, newLotId: 'L1' },
    });
    expect(두번째.status).toBe('duplicate');
    expect(a.state.revision).toBe(1);   // 안 오른다
  });

  it('conflict 도 revision 을 안 올린다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const 다른내용 = applyRawCommand({
      state: a.state, command: 명령({ operationId: 'in-1', kg: 200 }),
      existing: a.movement, det: { now: NOW, newLotId: 'L1' },
    });
    expect(다른내용.status).toBe('conflict');
    expect(a.state.revision).toBe(1);
  });

  it('rejected 도 안 올린다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ kg: 0 }), det: { now: NOW, newLotId: 'L1' },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('INVALID_QUANTITY');
  });

  it('**수량 0인 소급 이력도 revision 은 오른다** — 이력이 적용된 것이라(설계 §10)', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    //  실사 앵커
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 100,
      effectiveAt: '2026-08-20T12:00:00.000Z',
    } as never));
    //  앵커보다 앞선 시각의 사용
    const back = 적용(s.state, 명령({
      operationId: 'use-old', kind: 'consume', kg: 30,
      effectiveAt: '2026-08-17T09:00:00.000Z',
    } as never));
    expect(back.movement.appliedDeltaKg).toBe(0);
    expect(back.movement.backdatedBeforeStocktake).toBe(true);
    //  세 명령 다 적용 → revision 은 3
    expect(back.state.revision).toBe(3);
    expect(back.movement.sequence).toBe(3);
    //  잔량은 그대로
    expect(back.state.stockKg).toBe(100);
  });
});

describe('같은 id + 다른 내용 = conflict (설계 §6)', () => {
  it('예전엔 같은 id 면 무조건 duplicate 였다 — 이제 hash 를 견줘 다르면 막는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const 수량바꿈 = applyRawCommand({
      state: a.state, command: 명령({ operationId: 'in-1', kg: 999 }),
      existing: a.movement, det: { now: NOW, newLotId: 'L2' },
    });
    expect(수량바꿈.status).toBe('conflict');
    //  아무것도 안 움직인다
    expect(a.state.stockKg).toBe(100);
  });

  it('actorName 같은 판정용 필드가 달라도 duplicate 다 — 내용이 아니다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100, actorName: '갑' }));
    const 을이재시도 = applyRawCommand({
      state: a.state, command: 명령({ operationId: 'in-1', kg: 100, actorName: '을' }),
      existing: a.movement, det: { now: NOW, newLotId: 'L2' },
    });
    expect(을이재시도.status).toBe('duplicate');
  });
});

describe('문서 id 는 해시 기반이다 (설계 §7)', () => {
  it('치환 시 겹쳤을 자리가 겹치지 않는다', () => {
    //  예전엔 `/` 를 `_` 로 바꿔서 `po1/x` 와 `po1_x` 가 한 문서였다.
    expect(operationDocId('po1/x')).not.toBe(operationDocId('po1_x'));
  });

  it('아주 긴 두 작업 id 가 앞이 같아도 다른 문서가 된다', () => {
    const a = 'purchase:po-1:line-1:raw-깨분:' + 'x'.repeat(500);
    const b = 'purchase:po-1:line-1:raw-깨분:' + 'y'.repeat(500);
    expect(operationDocId(a)).not.toBe(operationDocId(b));
  });

  it('Firestore 가 막는 문자를 안 남긴다', () => {
    for (const bad of ['a/b', 'a.b', 'a#b', 'a$b', 'a[b]']) {
      expect(operationDocId(bad)).not.toMatch(/[/\\.#$[\]]/);
    }
  });

  it('원본 operationId 는 문서 안 필드로 그대로 남는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'purchase:po-1:line-1:raw-깨분' }));
    expect(a.movement.operationId).toBe('purchase:po-1:line-1:raw-깨분');
  });
});

describe('commandHash', () => {
  it('키 순서·공백에 흔들리지 않는다', () => {
    const a = 명령({ operationId: 'x', kg: 100, lot: { supplierName: '청정', packageKg: 16.5 } });
    const b = 명령({ operationId: 'x', kg: 100, lot: { packageKg: 16.5, supplierName: '청정' } });
    expect(commandHash(a)).toBe(commandHash(b));
  });

  it('수량이 다르면 다르다', () => {
    expect(commandHash(명령({ kg: 100 })))
      .not.toBe(commandHash(명령({ kg: 101 })));
  });

  it('actorName은 hash 대상이 아니지만 결과를 바꾸는 backdatedIntent는 대상이다', () => {
    const a = 명령({ actorName: '갑' });
    const b = 명령({ actorName: '을' });
    expect(commandHash(a)).toBe(commandHash(b));
    expect(commandHash(a)).not.toBe(commandHash(명령({ backdatedIntent: 'before' })));
  });
});

describe('회사 경계', () => {
  it('풍회 명령이 태백 상태를 못 건드린다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ companyId: 'punghoe' }),
      det: { now: NOW, newLotId: 'L1' },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('COMPANY_MISMATCH');
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
    //  되살리면서 guard 도 만든다
    expect(rev.guard?.originalOperationId).toBe('use-1');
  });

  it('이미 사용된 입고는 취소하지 못한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const used = 적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 80 } as never));
    const r = applyRawCommand({
      state: used.state,
      command: 명령({ operationId: 'reverse_in-1', kind: 'reverse', originalOperationId: 'in-1' } as never),
      original: a.movement, det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('RECEIPT_CONSUMED');
  });

  it('사용되지 않은 입고를 취소하면 0kg 로트가 활성 목록에 남지 않는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const rev = 적용(a.state, 명령({
      operationId: 'rev-in-1', kind: 'reverse', originalOperationId: 'in-1',
    } as never), {}, a.movement);
    expect(rev.state.activeLots).toHaveLength(0);
    expect(rev.state.recentDepletedLots.map(l => l.id)).toContain('L1');
    expect(rev.state.stockKg).toBe(0);
  });

  it('요청한 원본 ID와 읽은 movement가 다르면 거절한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const r = applyRawCommand({
      state: a.state,
      command: 명령({ operationId: 'rev-x', kind: 'reverse', originalOperationId: '다른-id' } as never),
      original: a.movement,
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('ORIGINAL_MISMATCH');
  });

  it('원본 이력은 되돌려도 그대로 남는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const before = JSON.stringify(a.movement);
    적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 10 } as never));
    expect(JSON.stringify(a.movement)).toBe(before);
  });
});

describe('되돌리기는 이력의 lotSnapshot 으로 한다 (설계 §9)', () => {
  it('**40개 캐시에서 밀려나도 되살아난다** — 상태의 recentDepletedLots 를 쓰지 않는다', () => {
    const 입고 = 적용(상태(), 명령({ operationId: 'in-1', kg: 60 }), { newLotId: 'L1' });
    const 사용 = 적용(입고.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 60 } as never));
    expect(사용.state.activeLots).toHaveLength(0);
    expect(사용.movement.lotChanges[0].lotSnapshot).toBeTruthy();

    //  L1 이 캐시에서 이미 빠져버린 상태를 흉내낸다 — 그래도 이력의 스냅샷으로 되살려야 한다.
    const 캐시비움: RawInventoryState = { ...사용.state, recentDepletedLots: [] };
    const rev = 적용(캐시비움, 명령({
      operationId: 'reverse_use-1', kind: 'reverse', originalOperationId: 'use-1',
    } as never), {}, 사용.movement);
    const byId = new Map(rev.state.activeLots.map(l => [l.id, l.kgRemaining]));
    expect(byId.get('L1')).toBe(60);
    expect(rev.state.stockKg).toBe(60);
  });
});

describe('ReversalGuard — 같은 원본을 두 번 취소 못한다 (설계 §9)', () => {
  it('id 를 바꿔 두 번째 취소를 보내도 거절된다', () => {
    const 입고 = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const 사용 = 적용(입고.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 30 } as never));
    const 첫취소 = 적용(사용.state, 명령({
      operationId: 'rev-A', kind: 'reverse', originalOperationId: 'use-1',
    } as never), {}, 사용.movement);
    expect(첫취소.guard).toBeTruthy();
    const guard = 첫취소.guard!;

    //  같은 원본을 다른 id 로 다시 취소하려 한다 — 서비스가 guard 를 읽어 넘기고, 계산은 거절한다.
    const 다른id = applyRawCommand({
      state: 첫취소.state,
      command: 명령({ operationId: 'rev-B', kind: 'reverse', originalOperationId: 'use-1' } as never),
      original: 사용.movement, guard,
      det: { now: NOW },
    });
    expect(다른id.status).toBe('rejected');
    if (다른id.status === 'rejected') expect(다른id.code).toBe('ALREADY_REVERSED');
  });

  it('같은 취소 id 를 재시도하는 것은 통과한다 — duplicate 로 걸린다', () => {
    const 입고 = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const 사용 = 적용(입고.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 30 } as never));
    const 첫취소 = 적용(사용.state, 명령({
      operationId: 'rev-A', kind: 'reverse', originalOperationId: 'use-1',
    } as never), {}, 사용.movement);
    const guard = 첫취소.guard!;

    //  같은 rev-A 를 다시 → existing 으로 걸려 duplicate. guard 가 있어도 통과한다(자기 자신).
    const 재시도 = applyRawCommand({
      state: 첫취소.state,
      command: 명령({ operationId: 'rev-A', kind: 'reverse', originalOperationId: 'use-1' } as never),
      existing: 첫취소.movement, original: 사용.movement, guard,
      det: { now: NOW },
    });
    expect(재시도.status).toBe('duplicate');
  });
});

describe('실사와 소급 입력 (설계 §10)', () => {
  it('실사는 목표량으로 맞추고 stocktakeAnchor 를 남긴다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 80,
      effectiveAt: '2026-09-08T14:30:00.000Z',
    } as never));
    expect(s.state.stockKg).toBe(80);
    expect(s.state.stocktakeAnchor).toEqual({
      effectiveAt: '2026-09-08T14:30:00.000Z',
      operationId: 'st-1',
      sequence: 2,
    });
    expect(s.movement.targetKg).toBe(80);
  });

  it('실사보다 앞선 시각의 사용은 재고를 안 움직인다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 100,
      effectiveAt: '2026-08-20T12:00:00.000Z',
    } as never));
    const back = 적용(s.state, 명령({
      operationId: 'use-old', kind: 'consume', kg: 30,
      effectiveAt: '2026-08-17T09:00:00.000Z',
    } as never));

    expect(back.state.stockKg).toBe(100);
    expect(back.movement.appliedDeltaKg).toBe(0);
    expect(back.movement.reportedDeltaKg).toBe(-30);
    expect(back.movement.backdatedBeforeStocktake).toBe(true);
    expect(back.movement.lotChanges).toEqual([]);
  });

  it('**같은 시각은 소급이 아니다** — 실사 뒤로 본다', () => {
    //  실사 당일 같은 시각의 사용이 재고에 잡히지 않으면 그날 것을 그날 넣는 게 통째로 무시된다.
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 100,
      effectiveAt: '2026-09-10T13:00:00.000Z',
    } as never));
    const 같은시각 = 적용(s.state, 명령({
      operationId: 'use-same', kind: 'consume', kg: 20,
      effectiveAt: '2026-09-10T13:00:00.000Z',
    } as never));
    expect(같은시각.state.stockKg).toBe(80);   // 정상 반영
    expect(같은시각.movement.appliedDeltaKg).toBe(-20);
    expect(같은시각.movement.backdatedBeforeStocktake).toBeFalsy();
  });

  it('화면이 backdatedIntent="before" 를 명시하면 같은 시각이어도 소급 처리한다', () => {
    //  날짜만 아는 과거 입력을 사람이 "실사 전"이라고 확정한 경우.
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 100,
      effectiveAt: '2026-09-10T13:00:00.000Z',
    } as never));
    const 확정소급 = 적용(s.state, 명령({
      operationId: 'use-past', kind: 'consume', kg: 20,
      effectiveAt: '2026-09-10T13:00:00.000Z',
      backdatedIntent: 'before',
    } as never));
    expect(확정소급.state.stockKg).toBe(100);
    expect(확정소급.movement.appliedDeltaKg).toBe(0);
    expect(확정소급.movement.backdatedBeforeStocktake).toBe(true);
  });

  it('소급으로 적힌 줄을 되돌려도 재고가 안 움직인다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const s = 적용(a.state, 명령({ operationId: 'st-1', kind: 'stocktake', targetKg: 100, effectiveAt: '2026-08-20T12:00:00.000Z' } as never));
    const back = 적용(s.state, 명령({ operationId: 'use-old', kind: 'consume', kg: 30, effectiveAt: '2026-08-17T09:00:00.000Z' } as never));
    const rev = applyRawCommand({
      state: back.state,
      command: 명령({ operationId: 'reverse_use-old', kind: 'reverse', originalOperationId: 'use-old', effectiveAt: '2026-09-09T09:00:00.000Z' } as never),
      original: back.movement, det: { now: NOW },
    });
    expect(rev.status).toBe('applied');
    if (rev.status === 'applied') {
      expect(rev.state.stockKg).toBe(100);
      expect(rev.guard?.originalOperationId).toBe('use-old');
    }
  });

  it('가장 최근 실사는 취소하면 직전 앵커와 수량으로 돌아간다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const first = 적용(a.state, 명령({
      operationId: 'st-1', kind: 'stocktake', targetKg: 90,
      effectiveAt: '2026-09-09T08:00:00.000Z',
    } as never));
    const second = 적용(first.state, 명령({
      operationId: 'st-2', kind: 'stocktake', targetKg: 70,
      effectiveAt: '2026-09-09T10:00:00.000Z',
    } as never));
    const rev = 적용(second.state, 명령({
      operationId: 'rev-st-2', kind: 'reverse', originalOperationId: 'st-2',
    } as never), {}, second.movement);
    expect(rev.state.stockKg).toBe(90);
    expect(rev.state.stocktakeAnchor).toEqual(first.state.stocktakeAnchor);
  });

  it('실사 뒤에 다른 movement가 쌓였으면 실사를 취소하지 못한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const st = 적용(a.state, 명령({ operationId: 'st-1', kind: 'stocktake', targetKg: 90 } as never));
    const used = 적용(st.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 10 } as never));
    const r = applyRawCommand({
      state: used.state,
      command: 명령({ operationId: 'rev-st-1', kind: 'reverse', originalOperationId: 'st-1' } as never),
      original: st.movement,
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('STOCKTAKE_HAS_FOLLOWING_MOVEMENT');
  });
});

describe('로트 소진(deplete-lot) — 지우지 않고 소진 처리 (설계 §9)', () => {
  it('남은 양만큼 빠지고 이력이 남는다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const d = 적용(a.state, 명령({ operationId: 'del-L1', kind: 'deplete-lot', lotId: 'L1' } as never));
    expect(d.state.stockKg).toBe(0);
    expect(d.movement.lotChanges).toEqual([
      expect.objectContaining({ lotId: 'L1', deltaKg: -100, beforeKg: 100, afterKg: 0 }),
    ]);
    //  스냅샷도 남는다 — 나중에 되돌릴 근거
    expect(d.movement.lotChanges[0].lotSnapshot).toBeTruthy();
    //  기록은 남는다 — hard delete 가 아니다.
    expect(d.state.recentDepletedLots.map(l => l.id)).toContain('L1');
  });

  it('없는 로트는 거절한다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ operationId: 'del-x', kind: 'deplete-lot', lotId: '없음' } as never),
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('LOT_NOT_FOUND');
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
    if (r.status === 'rejected') expect(r.code).toBe('MISSING_LOT_ID');
  });
});

describe('이력이 셈의 근거를 남긴다', () => {
  it('commandHash 를 실어 저장한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    expect(a.movement.commandHash).toBeTruthy();
    expect(a.movement.commandHash).toBe(commandHash(명령({ operationId: 'in-1', kg: 100 })));
  });

  it('사용 이력이 어느 로트에서 얼마가 빠졌는지 + 전후 잔량 + 스냅샷을 남긴다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const u = 적용(a.state, 명령({ operationId: 'use-1', kind: 'consume', kg: 30 } as never));
    expect(u.movement.lotChanges).toEqual([
      expect.objectContaining({ lotId: 'L1', deltaKg: -30, beforeKg: 100, afterKg: 70 }),
    ]);
    expect(u.movement.lotChanges[0].lotSnapshot.kgRemaining).toBe(100);   // 직전 모습
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
    if (r.status === 'rejected') expect(r.code).toBe('INVALID_QUANTITY');
  });

  it('원본 없는 되돌리기를 거절한다', () => {
    const r = applyRawCommand({
      state: 상태(), command: 명령({ kind: 'reverse', originalOperationId: '없음' } as never),
      det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('ORIGINAL_NOT_FOUND');
  });

  it('되돌리기를 또 되돌리지 못한다', () => {
    const a = 적용(상태(), 명령({ operationId: 'in-1', kg: 100 }));
    const rev = 적용(a.state, 명령({ operationId: 'rev-1', kind: 'reverse', originalOperationId: 'in-1' } as never), {}, a.movement);
    const r = applyRawCommand({
      state: rev.state,
      command: 명령({ operationId: 'rev-2', kind: 'reverse', originalOperationId: 'rev-1' } as never),
      original: rev.movement as RawInventoryMovement, det: { now: NOW },
    });
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('CANNOT_REVERSE_REVERSAL');
  });
});
