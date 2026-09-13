import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Order } from '../../shared/types';
import type { OrderProductLotMutation } from './orderProductLots';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  transactionCount: 0,
}));

type Ref = { path: string };

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const snapshot = (ref: Ref) => {
    const data = memory.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const getDoc = async (ref: Ref) => snapshot(ref);
  const runTransaction = async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    memory.transactionCount += 1;
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      update: (ref: Ref, patch: Record<string, unknown>) => pending.push({
        path: ref.path,
        data: { ...(memory.docs.get(ref.path) ?? {}), ...patch },
      }),
    });
    for (const write of pending) memory.docs.set(write.path, write.data);
    return result;
  };
  return { doc, getDoc, runTransaction };
});

const { createOrderItemStockOperations } = await import('./orderItemStock');

const item = (id: string): Item => ({ id, name: id, stock: 0 } as Item);
const order = (ids: string[]): Pick<Order, 'items'> => ({
  items: ids.map(itemId => ({ itemId, quantity: 1 } as never)),
});
const reservableOrder = (id: string, itemIds: string[]): Pick<Order, 'id' | 'items'> => ({
  id,
  ...order(itemIds),
});

beforeEach(() => {
  memory.docs.clear();
  memory.transactionCount = 0;
});

describe('주문 품목 재고 DB 경계', () => {
  it('여러 품목 증감을 한 transaction에서 함께 반영한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    memory.docs.set('items/b', { stock: 20 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a'), item('b')] });

    await stock.applyItemStockDeltas(new Map([['a', -3], ['b', 5]]));

    expect(memory.transactionCount).toBe(1);
    expect(memory.docs.get('items/a')?.stock).toBe(7);
    expect(memory.docs.get('items/b')?.stock).toBe(25);
  });

  it('겹쳐 시작한 주문은 앞 주문 예약을 뺀 재고만 배정받는다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const useAtMostEight = (snapshot: ReadonlyMap<string, number>) =>
      new Map([['a', -Math.min(8, snapshot.get('a') ?? 0)]]);

    // A가 원료를 처리하는 동안 아직 숫자 재고는 10이지만, 8개는 A 몫으로 예약돼 있다.
    const a = await stock.reserveOrderStock(reservableOrder('order-a', ['a']), 'op-a', useAtMostEight);
    const b = await stock.reserveOrderStock(reservableOrder('order-b', ['a']), 'op-b', useAtMostEight);

    expect(a.stockSnapshot.get('a')).toBe(10);
    expect(b.stockSnapshot.get('a')).toBe(2);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'op-a', orderId: 'order-a', qty: 8 }),
      expect.objectContaining({ operationId: 'op-b', orderId: 'order-b', qty: 2 }),
    ]);

    await stock.applyItemStockDeltas(new Map([['a', -8]]), [], a);
    await stock.applyItemStockDeltas(new Map([['a', -2]]), [], b);

    expect(memory.docs.get('items/a')).toMatchObject({ stock: 0, inventoryReservations: [] });
  });

  it('원료 처리 중 실패하면 잡아 둔 재고 예약을 해제한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const reservation = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'op-a', () => new Map([['a', -7]]),
    );

    await stock.releaseOrderStockReservation(reservation);

    expect(memory.docs.get('items/a')?.stock).toBe(10);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([]);
  });

  it('작업완료한 주문 몫은 출고하거나 취소할 때까지 다음 주문에서 제외한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const first = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'produce-a', () => new Map([['a', -10]]),
    );
    // 기존 10개와 새로 만든 2개 모두 이 주문이 출고할 물량이다.
    first.allocationQuantities = new Map([['a', 12]]);
    await stock.applyItemStockDeltas(new Map([['a', 2]]), [], first);

    const second = await stock.reserveOrderStock(
      reservableOrder('order-b', ['a']), 'produce-b', snapshot =>
        new Map([['a', -Math.min(8, snapshot.get('a') ?? 0)]]),
    );

    expect(memory.docs.get('items/a')?.stock).toBe(12);
    expect(second.stockSnapshot.get('a')).toBe(0);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ orderId: 'order-a', qty: 12, state: 'allocated' }),
    ]);
  });

  it('출고 시도 실패는 작업완료 때의 확정 배정을 되살린다', async () => {
    memory.docs.set('items/a', {
      stock: 12,
      inventoryReservations: [{
        operationId: 'produce-a', orderId: 'order-a', qty: 12,
        createdAt: new Date().toISOString(), state: 'allocated',
      }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const shipment = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'ship-a', () => new Map([['a', -12]]),
    );

    await stock.releaseOrderStockReservation(shipment);

    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'produce-a', orderId: 'order-a', qty: 12, state: 'allocated' }),
    ]);
  });

  it('작업완료 취소는 재고 반영 transaction에서 확정 배정을 함께 지운다', async () => {
    memory.docs.set('items/a', {
      stock: 12,
      inventoryReservations: [{
        operationId: 'produce-a', orderId: 'order-a', qty: 12,
        createdAt: new Date().toISOString(), state: 'allocated',
      }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const cleanup = stock.orderStockReservationCleanup(reservableOrder('order-a', ['a']));

    await stock.applyItemStockDeltas(new Map(), [], cleanup);

    expect(memory.docs.get('items/a')).toMatchObject({ stock: 12, inventoryReservations: [] });
  });

  it('완제품 숫자 재고와 FIFO 로트를 같은 transaction에서 함께 반영한다', async () => {
    memory.docs.set('items/a', {
      stock: 10,
      lots: [{ id: 'lot-1', qtyRemaining: 10, kgRemaining: 10, status: 'active' }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({
        lots: lots.map(lot => ({ ...lot, qtyRemaining: 7, kgRemaining: 7 })),
        consumedLots: [{ itemId: 'a', lotId: 'lot-1', qty: 3 }],
      }),
    };

    const consumed = await stock.applyItemStockDeltas(new Map([['a', -3]]), [lotMutation]);

    expect(memory.transactionCount).toBe(1);
    expect(memory.docs.get('items/a')).toMatchObject({
      stock: 7,
      lots: [{ id: 'lot-1', qtyRemaining: 7, kgRemaining: 7 }],
    });
    expect(consumed).toEqual([{ itemId: 'a', lotId: 'lot-1', qty: 3 }]);
  });

  it('대상 문서 하나가 없으면 다른 품목도 전혀 쓰지 않는다', async () => {
    memory.docs.set('items/a', { stock: 10, lots: [{ id: 'lot-1', qtyRemaining: 10 }] });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a'), item('b')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({ lots: lots.map(lot => ({ ...lot, qtyRemaining: 7 })), consumedLots: [] }),
    };

    await expect(stock.applyItemStockDeltas(new Map([['a', -3], ['b', 5]]), [lotMutation]))
      .rejects.toThrow('품목 문서를 찾을 수 없습니다: b');
    expect(memory.docs.get('items/a')).toEqual({ stock: 10, lots: [{ id: 'lot-1', qtyRemaining: 10 }] });
    expect(memory.docs.has('items/b')).toBe(false);
  });
});
