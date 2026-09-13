import { describe, expect, it } from 'vitest';
import type { OrderItemInventoryState } from './types';
import { aggregateOrderLineInventory, ensureOrderLineIds } from './orderLineInventory';

const state = (lineId: string, applied: boolean, delta: number, attempt = 1): OrderItemInventoryState => ({
  version: 1, lineId, itemId: 'oil', applied, attempt,
  completedAt: `2026-09-13T00:00:0${attempt}.000Z`,
  rawConsumedLots: applied ? [{ material: '참깨', supplierName: '공급처', kg: attempt }] : [],
  autoBuilt: applied ? [{ itemId: 'bottle', qty: attempt }] : [],
  producedUnits: applied ? [{ itemId: 'oil', qty: attempt }] : [],
  production: {
    capturedAt: `2026-09-13T00:00:0${attempt}.000Z`,
    stockDeltas: [{ itemId: 'bottle', delta }],
    bomLines: [{ parentItemId: 'oil', childItemId: 'bottle', quantity: 1 }],
    rawLedgerIds: applied ? [`ledger-${lineId}`] : [],
  },
});

describe('주문 품목 재고 열쇠', () => {
  it('같은 품목이 두 줄이어도 서로 다른 ID를 만들고 이미 저장된 ID는 유지한다', () => {
    const rows = ensureOrderLineIds([
      { itemId: 'same', name: '같은 품목', quantity: 1, price: 0 },
      { itemId: 'same', name: '같은 품목', quantity: 2, price: 0 },
      { lineId: 'saved', itemId: 'other', name: '다른 품목', quantity: 1, price: 0 },
    ]);
    expect(rows.map(row => row.lineId)).toEqual(['line-1-same', 'line-2-same', 'saved']);
  });
});

describe('품목별 기록의 주문 호환 합계', () => {
  it('적용된 줄만 주문 단위 생산량과 실제 증감으로 합친다', () => {
    const aggregate = aggregateOrderLineInventory({}, {
      a: state('a', true, -2, 1),
      b: state('b', true, -3, 2),
      c: state('c', false, -99, 3),
    });

    expect(aggregate.producedUnits).toEqual([{ itemId: 'oil', qty: 3 }]);
    expect(aggregate.autoBuilt).toEqual([{ itemId: 'bottle', qty: 3 }]);
    expect(aggregate.inventorySnapshots?.production?.stockDeltas).toEqual([{ itemId: 'bottle', delta: -5 }]);
    expect(aggregate.inventorySnapshots?.production?.rawLedgerIds).toEqual(['ledger-a', 'ledger-b']);
    expect(aggregate.rawInventoryAttempt).toBe(3); // 취소된 줄의 회차도 재사용하지 않는다
  });

  it('모든 줄을 취소하면 생산 근거를 비우되 출고 스냅샷은 보존한다', () => {
    const shipment = { capturedAt: 'x', stockDeltas: [{ itemId: 'oil', delta: -1 }], bomLines: [] };
    const aggregate = aggregateOrderLineInventory({ inventorySnapshots: { version: 1, shipment } }, {
      a: state('a', false, -2, 4),
    });

    expect(aggregate.producedAt).toBe('');
    expect(aggregate.rawLotsDeducted).toBe(false);
    expect(aggregate.inventorySnapshots?.production).toBeUndefined();
    expect(aggregate.inventorySnapshots?.shipment).toEqual(shipment);
    expect(aggregate.rawInventoryAttempt).toBe(4);
  });
});

