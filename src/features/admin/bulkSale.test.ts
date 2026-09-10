import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import { rawInventoryJobTestDouble } from '../../test/rawInventoryJobTestDouble';

/**
 * **벌크를 그대로 파는 주문** — 볶음참깨 20kg 자루 같은 것.
 *
 * 주문 화면이 완제품(type='product')만 띄우던 시절엔 들어올 일이 없어서 엔진이 통째로
 * 건너뛰었다. "연결된 품목이면 다 뜬다"로 바꾸면서 길이 열렸고, 안 막으면
 * **팔아도 재고·로트·원장이 하나도 안 움직인다.**
 */
const dbx = vi.hoisted(() => ({ stock: new Map<string, number>(), orders: new Map<string, any>(), ledger: new Map<string, any>() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  setDoc: async (ref: any, data: any) => { dbx.ledger.set(ref.id, data); },
  deleteDoc: async (ref: any) => { dbx.ledger.delete(ref.id); },
  getDoc: async (ref: any) => (ref.col === 'items'
    ? { exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }
    : { exists: () => dbx.orders.has(ref.id), data: () => dbx.orders.get(ref.id) }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => fn({
    get: async (ref: any) => ({ exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }),
    update: (ref: any, data: any) => { if (data.stock !== undefined) dbx.stock.set(ref.id, data.stock); },
  }),
}));
const { createOrderStockEngine } = await import('./orderStockEngine');

/** 볶음참깨 — lotsAreTotal(로트합=통합재고, stock=벌크만) */
const 볶음참깨 = (): Item => ({
  id: 'bok', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 161, lotsAreTotal: true,
  lots: [{ id: 'l1', lotNo: '260801-01', supplierName: '청정식품', receivedDate: '2026-08-01', kgIn: 500, qtyIn: 0, kgRemaining: 500, status: 'active' }],
} as unknown as Item);

const 주문 = (qty: number): Order => ({
  id: 'o-bulk', partnerName: '새봄푸드', status: OrderStatus.PENDING,
  items: [{ itemId: 'bok', name: '볶음참깨', quantity: qty } as never],
} as unknown as Order);

function harness(items: Item[], order: Order) {
  for (const i of items) dbx.stock.set(i.id, i.stock ?? 0);
  dbx.orders.set(order.id, { ...order });
  const lotState = new Map<string, any[]>(items.map(i => [i.id, [...((i as any).lots ?? [])]]));
  const runRawJob = rawInventoryJobTestDouble({ items, lots: lotState, stock: dbx.stock, ledger: dbx.ledger });
  const engine = createOrderStockEngine({
    allItems: items, submaterials: [], partners: [], allOrders: [order], orders: [order], db: {} as any,
    buildFormula: () => [],
    createProductionRecordsForOrder: async () => {},
    mutateRawMaterialLots: async (id, transform, computeStock) => {
      const next = transform((lotState.get(id) ?? []) as any, dbx.stock.get(id) ?? 0);
      lotState.set(id, next as any);
      //  진짜와 같게 — lotsAreTotal이면 stock을 로트합으로 안 덮는다
      const it = items.find(x => x.id === id);
      if (computeStock && !(it as any)?.lotsAreTotal) dbx.stock.set(id, computeStock(next as any));
      return next;
    },
    runRawInventoryJob: runRawJob,
    updateItem: async (col, id, data: any) => {
      if (col === 'orders') { Object.assign(order, data); dbx.orders.set(id, { ...(dbx.orders.get(id) ?? {}), ...data }); }
      return undefined;
    },
    addItem: async () => undefined,
  });
  const lotKg = (id: string) => Math.round((lotState.get(id) ?? []).reduce((s, l: any) => s + Number(l.kgRemaining || 0), 0) * 1000) / 1000;
  return { engine, lotKg };
}

beforeEach(() => { dbx.stock.clear(); dbx.orders.clear(); dbx.ledger.clear(); });

/** 부자재(비닐 등)도 팔 수 있다 — 완제품이 아니라고 재고가 안 빠지면 안 된다. */
const 비닐 = (): Item => ({ id: 'vinyl', name: '1KG-볶음참깨', type: 'submaterial', unit: '개', stock: 500 } as unknown as Item);

describe('타입을 안 가리고 판 만큼 뺀다', () => {
  it('부자재를 팔면 재고가 빠진다 — 예전엔 완제품·상품만 뺐다', async () => {
    const items = [비닐()];
    const order = { id: 'o-sub', partnerName: '새봄푸드', status: OrderStatus.PENDING,
      items: [{ itemId: 'vinyl', name: '1KG-볶음참깨', quantity: 30 } as never] } as unknown as Order;
    const { engine } = harness(items, order);
    await engine.reconcileOrderStock(order, OrderStatus.DELIVERED);
    expect(dbx.stock.get('vinyl')).toBe(470);
  });

  it('출고를 취소하면 그대로 돌아온다', async () => {
    const items = [비닐()];
    const order = { id: 'o-sub2', partnerName: '새봄푸드', status: OrderStatus.PENDING,
      items: [{ itemId: 'vinyl', name: '1KG-볶음참깨', quantity: 30 } as never] } as unknown as Order;
    const { engine } = harness(items, order);
    await engine.reconcileOrderStock(order, OrderStatus.DELIVERED);
    await engine.reconcileOrderStock(order, OrderStatus.PENDING);
    expect(dbx.stock.get('vinyl')).toBe(500);
  });
});

describe('벌크를 그대로 파는 주문', () => {
  it('로트에서 빠지고 원장에 남는다 — 예전엔 아무것도 안 움직였다', async () => {
    const items = [볶음참깨()];
    const order = 주문(40);   // 20kg 자루 2개 = 40kg
    const { engine, lotKg } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.DELIVERED);

    expect(lotKg('bok')).toBe(460);                                  // 500 − 40
    const rows = [...dbx.ledger.values()].filter(e => e.material === '볶음참깨');
    expect(rows).toHaveLength(1);
    expect(rows[0].used).toBe(40);
  });

  it('lotsAreTotal이면 벌크 재고(stock)에서도 빠진다 — 로트합은 통합재고라 stock을 안 덮는다', async () => {
    const items = [볶음참깨()];
    const order = 주문(40);
    const { engine } = harness(items, order);
    await engine.reconcileOrderStock(order, OrderStatus.DELIVERED);
    expect(dbx.stock.get('bok')).toBe(121);                          // 161 − 40
  });

  it('출고까지 가도 두 번 빠지지 않는다 — 벌크는 완제품 출고 경로를 안 탄다', async () => {
    const items = [볶음참깨()];
    const order = 주문(40);
    const { engine, lotKg } = harness(items, order);
    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    await engine.reconcileOrderStock(order, OrderStatus.DELIVERED);
    expect(lotKg('bok')).toBe(460);
    expect(dbx.stock.get('bok')).toBe(121);
  });
});
