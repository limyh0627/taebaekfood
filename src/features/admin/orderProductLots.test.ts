import { describe, expect, it } from 'vitest';
import { OrderStatus, type Item, type Order, type RawMaterialLot } from '../../shared/types';
import { createOrderProductLotOperations } from './orderProductLots';

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
  it('같은 품목의 여러 줄을 합쳐 FIFO로 빼고 초과 이월 ID를 재시도에도 고정한다', () => {
    const operations = createOrderProductLotOperations({
      allItems: [product],
      shipQtyOf: row => row.quantity,
    });
    const [mutation] = operations.deductProductLotsForOrder(order);

    const first = mutation!.apply(lots());
    const retried = mutation!.apply(lots());

    expect(first.lots.map(lot => [lot.id, lot.qtyRemaining])).toEqual([
      ['lot-1', 0],
      ['lot-carry-shipment-o1-p1', -3],
    ]);
    expect(retried.lots).toEqual(first.lots);
    expect(first.consumedLots.map(trace => [trace.lotId, trace.qty])).toEqual([
      ['lot-1', 5],
      ['lot-carry-shipment-o1-p1', 3],
    ]);
  });

  it('출고 취소는 FIFO를 다시 계산하지 않고 저장된 로트에 그대로 복원한다', () => {
    const operations = createOrderProductLotOperations({ allItems: [product], shipQtyOf: row => row.quantity });
    const shipped = operations.deductProductLotsForOrder(order)[0]!.apply(lots());
    const restoreOrder = { ...order, productConsumedLots: shipped.consumedLots } as Order;
    const restored = operations.restoreProductLotsForOrder(restoreOrder)[0]!.apply(shipped.lots);

    expect(restored.lots.map(lot => [lot.id, lot.qtyRemaining])).toEqual([
      ['lot-1', 5],
      ['lot-carry-shipment-o1-p1', 0],
    ]);
  });
});
