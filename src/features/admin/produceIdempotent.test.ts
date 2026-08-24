import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * **같은 주문은 원료를 한 번만 뺀다.**
 *
 * 2026-08 생들기름이 775.98kg 증발한 사고의 재현.
 *   원장 줄은 id가 `rm-auto-{주문}-{원료}`로 고정이라 두 번째 처리 때 **덮어써지고**,
 *   로트는 mutateRawMaterialLots가 부를 때마다 **또 깎여서** 한쪽만 이중이 됐다.
 *   (8/04 277.2 + 8/05 249.48 + 8/14 249.3 세 건이 각각 두 번씩 빠졌다)
 *
 * 두 번 처리되는 이유는 바깥 가드(`wantProduced && !order.producedAt`)가 **화면 상태**라서다.
 * 다른 탭에서 이미 처리했거나 버튼을 두 번 누르면 그 값이 낡은 채로 통과한다.
 * → produceOrder가 DB에서 주문을 다시 읽어, 이미 빼둔 몫이 있으면 되돌리고 새로 뺀다.
 */

// ── 가짜 Firestore ────────────────────────────────────────────────────────────
const dbx = vi.hoisted(() => ({
  stock: new Map<string, number>(),   // items.stock — 트랜잭션이 읽고 쓴다
  orders: new Map<string, any>(),     // orders — getDoc이 읽는다(화면 상태가 아니라 DB)
  ledger: new Map<string, any>(),     // rawMaterialLedger — id가 같으면 덮어써진다(진짜와 같게)
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  setDoc: async (ref: any, data: any) => { dbx.ledger.set(ref.id, data); },
  deleteDoc: async (ref: any) => { dbx.ledger.delete(ref.id); },
  getDoc: async (ref: any) => ({
    exists: () => dbx.orders.has(ref.id),
    data: () => dbx.orders.get(ref.id),
  }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => fn({
    get: async (ref: any) => ({ exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }),
    update: (ref: any, data: any) => { if (data.stock !== undefined) dbx.stock.set(ref.id, data.stock); },
  }),
}));

const { createOrderStockEngine } = await import('./orderStockEngine');

const LOT_IN = 5189.184;   // 실제 8/03 생들기름 로트
const 기름 = (): Item => ({
  id: 'oil', name: '생들기름', type: 'wip', subtype: '벌크', unit: 'L', stock: LOT_IN,
  lots: [{ id: 'lot1', lotNo: '260803-01', supplierName: '실사조정', receivedDate: '2026-08-03', kgIn: LOT_IN, qtyIn: 0, kgRemaining: LOT_IN, status: 'active' }],
} as unknown as Item);
// 300ml 병 — toKg('300ml','생들기름',n) = 0.3 × 0.924 × n
const 병 = (): Item => ({
  id: 'bottle', name: '생들기름/병/해피유통/300ml', type: 'product', unit: '개', spec: '300ml',
  stock: 0, submaterials: [],
} as unknown as Item);

const 주문 = (qty: number): Order => ({
  id: 'o1', partnerName: '해피유통(포천)', status: OrderStatus.PENDING,
  items: [{ itemId: 'bottle', name: '생들기름/병/해피유통/300ml', quantity: qty } as any],
} as unknown as Order);

/** 엔진 한 벌. items·order는 앱의 리렌더를 흉내내 그 자리에서 고쳐진다. */
function harness(items: Item[], order: Order) {
  for (const i of items) dbx.stock.set(i.id, i.stock ?? 0);
  dbx.orders.set(order.id, { ...order });
  const lotState = new Map<string, any[]>(items.map(i => [i.id, [...((i as any).lots ?? [])]]));
  const engine = createOrderStockEngine({
    allItems: items, submaterials: [], partners: [], allOrders: [order], orders: [order],
    db: {} as any,
    buildFormula: () => [{ raw: '생들기름', ratio: 1 }],
    createProductionRecordsForOrder: async () => {},
    // 진짜 로트 배열을 들고 있다가 transform 결과를 그대로 저장 — deductFromLots가 실제로 돈다
    mutateRawMaterialLots: async (id, transform, computeStock) => {
      const cur = lotState.get(id) ?? [];
      const next = transform(cur as any, dbx.stock.get(id) ?? 0);
      lotState.set(id, next as any);
      if (computeStock) dbx.stock.set(id, computeStock(next as any));
      return next;
    },
    updateItem: async (col, id, data: any) => {
      if (col === 'items') { const it = items.find(i => i.id === id); if (it) it.stock = data.stock; }
      if (col === 'orders') {
        Object.assign(order, data);
        dbx.orders.set(id, { ...(dbx.orders.get(id) ?? {}), ...data });   // DB에도 반영
      }
      return undefined;
    },
    addItem: async () => undefined,
  });
  const lotKg = (id: string) => Math.round((lotState.get(id) ?? []).reduce((s, l: any) => s + Number(l.kgRemaining || 0), 0) * 1000) / 1000;
  return { engine, lotKg, lots: lotState };
}

beforeEach(() => { dbx.stock.clear(); dbx.orders.clear(); dbx.ledger.clear(); });

const 원장줄 = () => [...dbx.ledger.values()].filter(e => e.material === '생들기름');

describe('같은 주문을 두 번 생산 처리해도 원료는 한 번만 빠진다', () => {
  it('1000병(277.2kg) 주문을 두 번 처리 — 로트는 277.2만 빠진다', async () => {
    const items = [기름(), 병()];
    const order = 주문(1000);
    const { engine, lotKg } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    expect(lotKg('oil')).toBe(Math.round((LOT_IN - 277.2) * 1000) / 1000);

    // 화면 상태가 낡은 상황 — producedAt을 못 본 주문 객체로 다시 들어온다
    const stale = { ...order, producedAt: '', rawConsumedLots: [], producedUnits: [] } as Order;
    await engine.reconcileOrderStock(stale, OrderStatus.DISPATCHED);

    // 예전엔 여기서 554.4가 빠져 4,634.784가 됐다
    expect(lotKg('oil')).toBe(Math.round((LOT_IN - 277.2) * 1000) / 1000);
  });

  it('원장도 한 줄, 사용량도 277.2 — 로트와 원장이 안 갈린다', async () => {
    const items = [기름(), 병()];
    const order = 주문(1000);
    const { engine, lotKg } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    await engine.reconcileOrderStock({ ...order, producedAt: '' } as Order, OrderStatus.DISPATCHED);

    const rows = 원장줄();
    expect(rows).toHaveLength(1);
    expect(rows[0].used).toBe(277.2);
    // 로트에서 빠진 양 = 원장 사용량. 이 둘이 갈리는 게 사고의 본체였다.
    expect(Math.round((LOT_IN - lotKg('oil')) * 1000) / 1000).toBe(rows[0].used);
  });

  it('수량을 고쳐 재처리하면 새 수량으로 맞는다 (되돌린 뒤 다시 뺀다)', async () => {
    const items = [기름(), 병()];
    const order = 주문(1000);
    const { engine, lotKg } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    expect(lotKg('oil')).toBe(Math.round((LOT_IN - 277.2) * 1000) / 1000);

    // 900병으로 고쳐서 다시 처리 → 249.48kg만 나가야 한다 (277.2가 남아 있으면 안 된다)
    const fixed = { ...order, producedAt: '', items: [{ itemId: 'bottle', name: '생들기름/병/해피유통/300ml', quantity: 900 }] } as unknown as Order;
    await engine.reconcileOrderStock(fixed, OrderStatus.DISPATCHED);

    expect(lotKg('oil')).toBe(Math.round((LOT_IN - 249.48) * 1000) / 1000);
    expect(원장줄()[0].used).toBe(249.48);
  });

  it('세 번을 눌러도 한 번과 같다', async () => {
    const items = [기름(), 병()];
    const order = 주문(1000);
    const { engine, lotKg } = harness(items, order);
    for (let i = 0; i < 3; i++) {
      await engine.reconcileOrderStock({ ...order, producedAt: '' } as Order, OrderStatus.DISPATCHED);
    }
    expect(lotKg('oil')).toBe(Math.round((LOT_IN - 277.2) * 1000) / 1000);
    expect(원장줄()).toHaveLength(1);
  });
});
