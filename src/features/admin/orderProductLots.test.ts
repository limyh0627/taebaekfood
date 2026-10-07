import { describe, expect, it } from 'vitest';
import { OrderStatus, type Item, type Order, type RawMaterialLot } from '../../shared/types';
import { combineProductLotMutations, createOrderProductLotOperations, productionProductLots, reverseProductionProductLots } from './orderProductLots';

const product = { id: 'p1', name: '완제품', type: 'product', unit: '개' } as Item;
const order = {
  id: 'o1',
  status: OrderStatus.PENDING,
  items: [
    { itemId: 'p1', name: '완제품', quantity: 4 },
    { itemId: 'p1', name: '완제품', quantity: 4 },
  ],
} as Order;
const lots = (): RawMaterialLot[] => [{
  id: 'lot-1', material: '참기름', supplierName: '공장',
  qtyIn: 5, qtyRemaining: 5, unitKg: 1, kgIn: 5, kgRemaining: 5,
  receivedDate: '2026-09-01', status: 'active', createdAt: '2026-09-01T00:00:00.000Z',
}];

describe('주문 완제품 로트 계획', () => {
  it('생산에 쓴 구성 완제품도 로트에서 차감하고 재시도 추적을 중복하지 않는다', () => {
    const made = productionProductLots([product], new Map([['p1', -3]]), 'component');
    const consumed = made.mutations[0]!.apply(lots());
    expect(consumed.lots[0]!.qtyRemaining).toBe(2);
    expect(made.consumedLots.map(row => [row.lotId, row.qty])).toEqual([['lot-1', 3]]);
    made.mutations[0]!.apply(lots());
    expect(made.consumedLots).toHaveLength(1);
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const restored = operations.restoreProductLotsForOrder({ ...order, productConsumedLots: made.consumedLots })[0]!.apply(consumed.lots);
    expect(restored.lots[0]!.qtyRemaining).toBe(5);
  });
  it('8개와 15개 활성 로트를 합쳐 20개 출고하면 먼저8 다음12를 쓰고3이 남는다', () => {
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const shipment = operations.deductProductLotsForOrder({ ...order, items: [{ ...order.items[0]!, quantity: 20 }] })[0]!;
    const before = [
      { ...lots()[0]!, id: 'first', qtyIn: 8, qtyRemaining: 8, kgIn: 8, kgRemaining: 8, receivedDate: '2026-09-01' },
      { ...lots()[0]!, id: 'next', qtyIn: 15, qtyRemaining: 15, kgIn: 15, kgRemaining: 15, receivedDate: '2026-09-02' },
    ];
    const result = shipment.apply(before);
    expect(result.consumedLots.map(row => [row.lotId, row.qty])).toEqual([['first', 8], ['next', 12]]);
    expect(result.lots.map(row => row.qtyRemaining)).toEqual([0, 3]);
    expect(before.map(row => row.qtyRemaining)).toEqual([8, 15]);
  });
  it('생산 증가분과 출고를 한 변환에 결합하고 생산 취소는 해당 로트만 제거한다', () => {
    const made = productionProductLots([product], new Map([['p1', 8]]), 'operation');
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const completed = made.mutations[0]!.apply(lots(), 5);
    expect(completed.lots.map(lot => lot.qtyRemaining)).toEqual([5, 8]);
    const reversed = reverseProductionProductLots(made.traces)[0]!.apply(completed.lots);
    expect(reversed.lots.map(lot => lot.qtyRemaining)).toEqual([5, 0]);
    const shipped = combineProductLotMutations([...made.mutations, ...operations.deductProductLotsForOrder(order)])[0]!.apply(lots(), 5);
    expect(shipped.lots.reduce((sum, lot) => sum + Number(lot.qtyRemaining), 0)).toBe(5);
    expect(() => reverseProductionProductLots(made.traces)[0]!.apply(shipped.lots)).toThrow('이미 사용');
    expect(() => made.mutations[0]!.apply(completed.lots, 13)).toThrow('이미 반영');
  });
  it('같은 품목의 여러 줄을 합쳐 로트 부족이면 출고를 거절한다', () => {
    const operations = createOrderProductLotOperations({
      allItems: [product],
      shipQtyOf: row => row.quantity,
    });
    const [mutation] = operations.deductProductLotsForOrder(order);
    expect(() => mutation!.apply(lots())).toThrow('완제품 로트 재고가 부족합니다. 현재 5, 출고 8');
  });

  it('출고 취소는 FIFO를 다시 계산하지 않고 저장된 로트에 그대로 복원한다', () => {
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const shipped = operations.deductProductLotsForOrder({ ...order, items: [order.items[0]!] })[0]!.apply(lots());
    const restoreOrder = { ...order, productConsumedLots: shipped.consumedLots } as Order;
    const restored = operations.restoreProductLotsForOrder(restoreOrder)[0]!.apply(shipped.lots);

    expect(restored.lots.map(lot => [lot.id, lot.qtyRemaining])).toEqual([
      ['lot-1', 5],
    ]);
  });

  it('남은 로트 안에서만 출고하고 기존 음수 로트는 더 줄이지 않는다', () => {
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const shipment = operations.deductProductLotsForOrder({
      ...order, items: [{ ...order.items[0]!, quantity: 3 }],
    })[0]!;
    const result = shipment.apply([...lots(), { ...lots()[0]!, id: 'old-negative', qtyRemaining: -2 }]);

    expect(result.lots.map(lot => [lot.id, lot.qtyRemaining])).toEqual([
      ['lot-1', 2],
      ['old-negative', -2],
    ]);
    expect(result.consumedLots.map(trace => [trace.lotId, trace.qty])).toEqual([['lot-1', 3]]);
  });
});
