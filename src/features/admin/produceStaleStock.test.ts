import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * **재고 판정은 화면 값이 아니라 DB 값으로 한다.**
 *
 * 2026-08 볶음참깨 낱개가 −33개, 시골향참기름 박스가 −15박스로 파인 사고의 재현.
 *   쓰기(applyStockDeltas)는 진작 트랜잭션으로 고쳤는데 **읽기가 남아 있었다.**
 *   `product.stock`은 엔진을 만들 때 클로저에 갇힌 화면 값이라, 앞 주문이 방금 깎아도 그대로다.
 *
 *   화면 낱개 30개 ─┬─ 훈장골 5개    → "30 있다" 생산 0, 출고 −5   DB 30→25
 *                  └─ 현대유통 30개 → "30 있다" 생산 0, 출고 −30  DB 25→ **−5**
 *
 *   재고만 음수가 아니다. 안 만들었으니 **원료도 안 빠진다**(rawConsumedLots 0건) — 이쪽이 더 크다.
 */

const dbx = vi.hoisted(() => ({
  stock: new Map<string, number>(),
  orders: new Map<string, any>(),
  ledger: new Map<string, any>(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  setDoc: async (ref: any, data: any) => { dbx.ledger.set(ref.id, data); },
  deleteDoc: async (ref: any) => { dbx.ledger.delete(ref.id); },
  //  items도 읽는다 — 재고 판정이 DB를 보게 됐으므로 진짜와 같게 흉내낸다.
  getDoc: async (ref: any) => (ref.col === 'items'
    ? { exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }
    : { exists: () => dbx.orders.has(ref.id), data: () => dbx.orders.get(ref.id) }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => fn({
    get: async (ref: any) => ({ exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }),
    update: (ref: any, data: any) => { if (data.stock !== undefined) dbx.stock.set(ref.id, data.stock); },
  }),
}));

const { createOrderStockEngine } = await import('./orderStockEngine');

/** 볶음참깨 낱개 1kg — 벌크에서 소분해 만든다 */
const 낱개 = (stock: number): Item => ({
  id: 'loose', name: '볶음참깨-낱개/1kg', type: 'product', subtype: '낱개', unit: '개', spec: '1kg', stock,
} as unknown as Item);
const 벌크 = (): Item => ({
  id: 'bulk', name: '볶음참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 1000,
  lots: [{ id: 'l1', lotNo: '260801-01', supplierName: '청정식품', receivedDate: '2026-08-01', kgIn: 1000, qtyIn: 0, kgRemaining: 1000, status: 'active' }],
} as unknown as Item);

const 주문 = (id: string, qty: number): Order => ({
  id, partnerName: id, status: OrderStatus.PENDING,
  items: [{ itemId: 'loose', name: '볶음참깨-낱개/1kg', quantity: qty } as any],
} as unknown as Order);

function harness(items: Item[], orders: Order[]) {
  for (const i of items) dbx.stock.set(i.id, i.stock ?? 0);
  for (const o of orders) dbx.orders.set(o.id, { ...o });
  const lotState = new Map<string, any[]>(items.map(i => [i.id, [...((i as any).lots ?? [])]]));
  const engine = createOrderStockEngine({
    //  allItems는 **일부러 갱신하지 않는다** — 앱에서 구독이 늦는 상황 그대로다.
    allItems: items, submaterials: [], partners: [], allOrders: orders, orders,
    db: {} as any,
    buildFormula: () => [{ raw: '볶음참깨', ratio: 1 }],
    createProductionRecordsForOrder: async () => {},
    mutateRawMaterialLots: async (id, transform, computeStock) => {
      const cur = lotState.get(id) ?? [];
      const next = transform(cur as any, dbx.stock.get(id) ?? 0);
      lotState.set(id, next as any);
      if (computeStock) dbx.stock.set(id, computeStock(next as any));
      return next;
    },
    updateItem: async (col, id, data: any) => {
      if (col === 'orders') {
        const o = orders.find(x => x.id === id);
        if (o) Object.assign(o, data);
        dbx.orders.set(id, { ...(dbx.orders.get(id) ?? {}), ...data });
      }
      //  items는 일부러 반영 안 한다(화면 값이 낡은 상태 유지)
      return undefined;
    },
    addItem: async () => undefined,
  });
  const lotKg = (id: string) => Math.round((lotState.get(id) ?? []).reduce((s, l: any) => s + Number(l.kgRemaining || 0), 0) * 1000) / 1000;
  return { engine, lotKg };
}

beforeEach(() => { dbx.stock.clear(); dbx.orders.clear(); dbx.ledger.clear(); });

describe('앞 주문이 깎은 재고를 뒤 주문이 다시 쓰지 못한다', () => {
  it('낱개 30개로 5개 + 30개를 내보내도 재고는 음수가 안 된다', async () => {
    const items = [낱개(30), 벌크()];
    const a = 주문('훈장골', 5), b = 주문('현대유통', 30);
    const { engine } = harness(items, [a, b]);

    await engine.reconcileOrderStock(a, OrderStatus.DELIVERED);
    await engine.reconcileOrderStock(b, OrderStatus.DELIVERED);

    //  예전엔 둘 다 "30 있다"로 보고 생산을 건너뛰어 30 − 5 − 30 = −5가 됐다.
    expect(dbx.stock.get('loose')).toBe(0);
    expect(dbx.stock.get('loose')).toBeGreaterThanOrEqual(0);
  });

  it('모자란 몫은 실제로 만들고 원료도 그만큼 빠진다', async () => {
    const items = [낱개(30), 벌크()];
    const a = 주문('훈장골', 5), b = 주문('현대유통', 30);
    const { engine, lotKg } = harness(items, [a, b]);

    await engine.reconcileOrderStock(a, OrderStatus.DELIVERED);
    await engine.reconcileOrderStock(b, OrderStatus.DELIVERED);

    //  35개 중 재고 30개로 충당하고 5개는 만들었어야 한다 → 벌크 5kg 소모.
    expect(b.producedUnits).toEqual([{ itemId: 'loose', qty: 5 }]);
    expect(lotKg('bulk')).toBe(995);
    //  예전엔 생산이 0이라 원료가 통째로 안 빠졌다(rawConsumedLots 0건).
    expect((b.rawConsumedLots ?? []).length).toBeGreaterThan(0);
  });
});
