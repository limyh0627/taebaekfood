import { describe, it, expect } from 'vitest';
import { toLedgerDoc } from './rawInventoryService';
import type { RawInventoryMovement } from '../rawInventoryCore';

/**
 * 이관 5단계 — 새 명령이 쓴 원장 줄을 **옛 화면이 그대로 읽을 수 있어야** 한다.
 *
 * 이력 문서는 `reportedDeltaKg` 같은 새 이름으로 적는데, 원료수불부·입출고 기록은 아직
 * `received`/`used`/`note`/`type` 을 읽는다. 한 문서에 둘 다 담는다(설계 §2 "이관 기간").
 * 이걸 빠뜨리면 **입고를 넣어도 화면이 빈칸으로 보인다.**
 */

const 이력 = (o: Partial<RawInventoryMovement> = {}): RawInventoryMovement => ({
  id: 'op-1', operationId: 'op-1',
  companyId: 'taebaek', rawItemId: 'raw-참깨', materialSnapshot: '참깨',
  effectiveDate: '2026-09-10', recordedAt: '2026-09-10T00:00:00.000Z',
  sequence: 1, kind: 'receive',
  reportedDeltaKg: 100, appliedDeltaKg: 100, balanceAfterKg: 100,
  lotChanges: [], source: { type: 'purchase', id: 'po-1' },
  ...o,
} as RawInventoryMovement);

describe('옛 원장 화면이 읽는 칸을 같이 채운다', () => {
  it('입고는 received 에 들어간다', () => {
    const d = toLedgerDoc(이력({ reportedDeltaKg: 100 }));
    expect(d.received).toBe(100);
    expect(d.used).toBe(0);
  });

  it('사용은 used 에 **양수로** 들어간다 — 화면이 그렇게 읽는다', () => {
    const d = toLedgerDoc(이력({ kind: 'consume', reportedDeltaKg: -30 }));
    expect(d.received).toBe(0);
    expect(d.used).toBe(30);
  });

  it('날짜와 원료명도 옛 이름으로 같이 적는다', () => {
    const d = toLedgerDoc(이력());
    expect(d.date).toBe('2026-09-10');
    expect(d.material).toBe('참깨');
    expect(d.unit).toBe('kg');
  });

  it('**실사는 입고·사용을 안 건드린다** — 잔량만 targetKg 로 다시 잡는 앵커다', () => {
    //  여기서 used 에 값이 들어가면 그 달 사용량 합계가 통째로 틀어진다.
    const d = toLedgerDoc(이력({ kind: 'stocktake', reportedDeltaKg: -560, targetKg: 188 }));
    expect(d.received).toBe(0);
    expect(d.used).toBe(0);
    expect(d.targetKg).toBe(188);
  });

  it('비고·작성자·단위입고 표시가 그대로 실린다', () => {
    const d = toLedgerDoc(이력(), {
      note: '청정식품 입고', type: 'manual', addedBy: '이은경',
      canSize: 16.5, canCount: 68, canSizeTag: '캔',
      originalAmount: 68, originalUnit: 'kg',
    });
    expect(d.note).toBe('청정식품 입고');
    expect(d.type).toBe('manual');
    expect(d.addedBy).toBe('이은경');
    expect(d.canSize).toBe(16.5);
    expect(d.canCount).toBe(68);
  });

  it('새 칸도 그대로 남는다 — 옛 칸을 얹는 것이지 바꿔치는 게 아니다', () => {
    const d = toLedgerDoc(이력());
    expect(d.operationId).toBe('op-1');
    expect(d.rawItemId).toBe('raw-참깨');
    expect(d.companyId).toBe('taebaek');
    expect(d.sequence).toBe(1);
    expect(d.appliedDeltaKg).toBe(100);
  });

  it('열쇠가 언제나 실린다 — 이름으로 되짚지 않는다', () => {
    for (const kind of ['receive', 'consume', 'stocktake', 'delete-lot', 'reverse', 'opening'] as const) {
      const d = toLedgerDoc(이력({ kind }));
      expect(d.rawItemId, kind).toBe('raw-참깨');
      expect(d.companyId, kind).toBe('taebaek');
    }
  });
});
