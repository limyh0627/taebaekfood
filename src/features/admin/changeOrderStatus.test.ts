import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * **주문 상태를 바꾸는 유일한 문 — `changeOrderStatus`.**
 *
 * 645줄짜리 엔진에서 이 진입점만 통째로 안 덮여 있었다(2026-09-02 커버리지).
 * 안에 든 게 전부 **한 번 물린 적 있는 자리**다.
 *
 *   ① 같은 틱 이중 호출 막기 — 품목 체크가 연달아 들어오면 작업완료가 여러 번 불렸고,
 *      producedAt 판정이 React 상태 기준이라 다 통과해 수입들기름이 3배로 빠졌다.
 *   ② DB에서 다시 읽기 — React 상태는 같은 틱에 안 갱신돼 직전 호출을 못 본다.
 *   ③ 이미 배송완료면 재고를 다시 안 만진다.
 *   ④ 배송완료일 없이 완료로 가면 **알림을 남긴다** — 서류 네 종의 유일한 기준일이라,
 *      비어 있으면 그 주문이 원료수불부·판매기록부에서 통째로 조용히 빠진다.
 */

const dbx = vi.hoisted(() => ({
  stock: new Map<string, number>(),
  orders: new Map<string, any>(),
  /** 재고를 만진 횟수 — `reconcileOrderStock` 은 클로저 안 함수라 스파이가 안 물린다.
   *  트랜잭션이 돌았는지로 센다. 그게 곧 "재고를 건드렸나"다. */
  조정: 0,
  /** getDoc 을 느리게 — 겹쳐 들어오는 호출을 만들려면 안에서 시간이 흘러야 한다 */
  느린읽기: false,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  getDoc: async (ref: any) => {
    if (dbx.느린읽기) await new Promise(r => setTimeout(r, 10));
    return { exists: () => dbx.orders.has(ref.id), data: () => dbx.orders.get(ref.id) };
  },
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => (dbx.조정++, fn)({
    get: async (ref: any) => ({ exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }),
    update: (ref: any, data: any) => { if (data.stock !== undefined) dbx.stock.set(ref.id, data.stock); },
  }),
}));

const { createOrderStockEngine } = await import('./orderStockEngine');

const 상품 = (): Item =>
  ({ id: 'p1', name: '참기름/180ml', type: 'product', unit: '개', spec: '180ml', stock: 100, submaterials: [] } as unknown as Item);

const 주문 = (over: Partial<Order> = {}): Order =>
  ({
    id: 'o1', partnerName: '해피유통', status: OrderStatus.PENDING,
    items: [{ itemId: 'p1', name: '참기름/180ml', quantity: 10 } as any],
    ...over,
  } as unknown as Order);

/** 엔진 한 벌 — 재고 조정은 부르는지만 세고, 실제 셈은 다른 테스트가 본다 */
function harness(items: Item[], order: Order) {
  for (const i of items) dbx.stock.set(i.id, i.stock ?? 0);
  dbx.orders.set(order.id, { ...order });
  const 알림: any[] = [];
  const 주문쓰기: any[] = [];
  const engine = createOrderStockEngine({
    allItems: items, submaterials: [], partners: [], allOrders: [order], orders: [order],
    db: {} as any,
    buildFormula: () => [],
    createProductionRecordsForOrder: async () => {},
    mutateRawMaterialLots: async () => [],
    updateItem: async (col, id, data: any) => {
      if (col === 'orders') {
        주문쓰기.push(data);
        Object.assign(order, data);
        dbx.orders.set(id, { ...(dbx.orders.get(id) ?? {}), ...data });
      }
      return undefined;
    },
    addItem: async (col, data) => { if (col === 'notifications') 알림.push(data); return undefined; },
  });
  //  문을 지난 횟수 = 상태를 쓴 횟수. 막힌 호출은 아무것도 안 쓰고 돌아간다.
  const 상태쓴수 = (st: OrderStatus) => 주문쓰기.filter(w => w.status === st).length;
  return { engine, 알림, 주문쓰기, 조정: () => dbx.조정, 상태쓴수 };
}

beforeEach(() => { dbx.stock.clear(); dbx.orders.clear(); dbx.조정 = 0; dbx.느린읽기 = false; });

describe('①② 같은 주문이 겹쳐 들어오면 한 번만 통과시킨다', () => {
  it('**끝나기 전에 또 들어온 호출은 그냥 돌려보낸다** — 수입들기름 3배가 이렇게 났다', async () => {
    const order = 주문();
    const { engine, 상태쓴수 } = harness([상품()], order);
    dbx.느린읽기 = true;

    //  await 하지 않고 연달아 — 화면에서 체크를 다다닥 누른 것과 같다
    await Promise.all([
      engine.changeOrderStatus('o1', OrderStatus.DELIVERED),
      engine.changeOrderStatus('o1', OrderStatus.DELIVERED),
      engine.changeOrderStatus('o1', OrderStatus.DELIVERED),
    ]);

    //  셋이 들어왔는데 안쪽은 한 번만 돌았다
    expect(상태쓴수(OrderStatus.DELIVERED)).toBe(1);
  });

  it('앞엣것이 끝난 뒤에는 다시 받는다 — 막는 게 아니라 겹치는 것만 막는다', async () => {
    const order = 주문();
    const { engine, 상태쓴수 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DISPATCHED);
    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(상태쓴수(OrderStatus.DISPATCHED)).toBe(1);
    expect(상태쓴수(OrderStatus.DELIVERED)).toBe(1);
  });

  it('**화면이 아니라 DB에 있는 상태를 본다** — 같은 틱엔 React 상태가 안 갱신된다', async () => {
    //  화면 객체는 아직 PENDING인데 DB엔 이미 DELIVERED 로 들어가 있다
    const order = 주문({ status: OrderStatus.PENDING });
    const { engine, 조정 } = harness([상품()], order);
    dbx.orders.set('o1', { ...order, status: OrderStatus.DELIVERED, deliveredAt: '2026-09-01' });

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    //  이미 이력이면 재고를 다시 만지지 않는다
    expect(조정()).toBe(0);
  });
});

describe('③ 이미 배송완료된 주문은 재고를 다시 안 만진다', () => {
  it('DELIVERED → DELIVERED 는 조정 없이 상태만 쓴다', async () => {
    const order = 주문({ status: OrderStatus.DELIVERED, deliveredAt: '2026-09-01' } as never);
    const { engine, 조정, 주문쓰기 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(조정()).toBe(0);
    expect(주문쓰기).toContainEqual({ status: OrderStatus.DELIVERED });
  });

  it('아직 배송완료가 아니면 조정한다', async () => {
    const order = 주문({ status: OrderStatus.DISPATCHED } as never);
    const { engine, 조정 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(조정()).toBe(1);
  });
});

describe('④ 배송완료일이 없으면 드러낸다 — 서류에서 조용히 빠지는 걸 막는다', () => {
  it('**배송완료일 없이 완료로 가면 알림을 남긴다**', async () => {
    const order = 주문({ status: OrderStatus.DISPATCHED } as never);
    const { engine, 알림 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(알림).toHaveLength(1);
    expect(알림[0].title).toBe('배송완료일 없는 주문');
    expect(알림[0].linkedId).toBe('o1');
    //  누구 주문인지 적혀 있어야 찾는다
    expect(알림[0].body).toContain('해피유통');
  });

  it('배송완료일이 있으면 조용하다', async () => {
    const order = 주문({ status: OrderStatus.DISPATCHED, deliveredAt: '2026-09-02' } as never);
    const { engine, 알림 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(알림).toHaveLength(0);
  });

  it('**배송완료가 아닌 상태로 바꿀 땐 안 따진다** — 날짜는 완료 시점에만 필요하다', async () => {
    const order = 주문();
    const { engine, 알림 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DISPATCHED);

    expect(알림).toHaveLength(0);
  });

  it('배송완료일은 여기서 만들어 넣지 않는다 — 새벽 처리분이 다음 날짜로 새면 서류가 갈린다', async () => {
    const order = 주문({ status: OrderStatus.DISPATCHED } as never);
    const { engine, 주문쓰기 } = harness([상품()], order);

    await engine.changeOrderStatus('o1', OrderStatus.DELIVERED);

    expect(주문쓰기.some(w => 'deliveredAt' in w)).toBe(false);
  });
});

describe('없는 주문', () => {
  it('주문을 못 찾아도 상태는 쓴다 — 조용히 삼키면 화면이 멈춘 것처럼 보인다', async () => {
    const order = 주문();
    const { engine, 조정, 주문쓰기 } = harness([상품()], order);

    await engine.changeOrderStatus('없는주문', OrderStatus.DELIVERED);

    expect(조정()).toBe(0);
    expect(주문쓰기).toContainEqual({ status: OrderStatus.DELIVERED });
  });
});
