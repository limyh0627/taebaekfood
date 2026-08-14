import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import { buildStockUseRows, resolveStockUse, toStockUsePlan } from './stockUseRows';

/**
 * 박스/낱개 재고 차감 — **이미 있는 재고를 먼저 쓰고 부족분만 생산한다.**
 *
 * 전에는 작업완료가 주문량 전량을 생산(+N)하고 출고가 −N을 해서 서로 상쇄됐다.
 * 박스 재고 32개가 있어도 한 개도 안 줄고, 대신 낱개를 새로 만들며 원료까지 나갔다.
 * 지금은 생산량 = 주문량 − 재고사용분이라 순변화가 딱 '쓴 재고'만큼이다.
 *
 * 실물 구조:
 *   볶음참깨/1kg (10개입)  재고 32박스  BOM: 볶음참깨-낱개/1kg ×10
 *   볶음참깨-낱개/1kg      재고  2개    BOM: 볶음참깨(벌크) ×1
 */

const ledger = vi.hoisted(() => ({ entries: [] as any[] }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  setDoc: async (_ref: unknown, data: any) => { ledger.entries.push(data); },
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => false }),
}));

// 엔진은 firebase/firestore를 모듈 최상단에서 읽으므로 mock 뒤에 가져온다.
const { createOrderStockEngine } = await import('./orderStockEngine');

const mk = (o: Partial<Item> & { id: string }) =>
  ({ name: o.id, unit: '개', stock: 0, spec: '', minStock: 0, price: 0, image: '', submaterials: [], ...o }) as unknown as Item;

const 벌크 = () => mk({ id: 'bulk', name: '볶음참깨', category: 'wip', subtype2: '벌크', unit: 'kg', stock: 500 });
const 낱개 = (stock: number) => mk({
  id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', unit: '개', spec: '1kg', stock,
  submaterials: [{ id: 'bulk', name: '볶음참깨', category: 'wip', stock: 1 }] as any,
});
const 박스10 = (stock: number) => mk({
  id: 'box10', name: '볶음참깨/1kg (10개입)', category: 'product', unit: '박스', spec: '10kg', stock,
  submaterials: [{ id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', stock: 10 }] as any,
});

/** 엔진을 실제로 돌린다. updateItem이 items·order를 그 자리에서 고쳐 앱의 리렌더를 흉내낸다. */
function harness(items: Item[], order: Order) {
  const rawUsed: Record<string, number> = {};
  const engine = createOrderStockEngine({
    allItems: items, shippingRules: [], submaterials: [], partners: [], allOrders: [order], orders: [order],
    db: {} as any,
    buildFormula: () => [],                       // 원료식 폴백은 이 테스트의 관심사가 아니다(BOM 경로만 본다)
    createProductionRecordsForOrder: async () => {},
    mutateRawMaterialLots: async (rawItemId, transform) => { transform([], 0); rawUsed[rawItemId] = (rawUsed[rawItemId] ?? 0) + 1; return []; },
    updateItem: async (col, id, data: any) => {
      if (col === 'items') { const it = items.find(i => i.id === id); if (it) it.stock = data.stock; }
      if (col === 'orders') Object.assign(order, data);
      return undefined;
    },
    addItem: async () => undefined,
  });
  const stockOf = (id: string) => items.find(i => i.id === id)!.stock;
  return { engine, stockOf, rawUsed, ledger: ledger.entries };
}

const 주문 = (boxes: number): Order => ({
  id: 'o1', partnerName: '테스트', status: OrderStatus.PENDING,
  items: [{ itemId: 'box10', name: '볶음참깨/1kg (10개입)', quantity: boxes * 10, isBoxUnit: true, boxQuantity: boxes } as any],
} as unknown as Order);

beforeEach(() => { ledger.entries.length = 0; });

describe('박스 재고가 있으면 그걸 먼저 쓴다', () => {
  it('박스 32 · 1박스 주문 → 박스 31, 낱개 그대로, 원료 안 나감', async () => {
    const items = [벌크(), 낱개(2), 박스10(32)];
    const order = 주문(1);
    const { engine, stockOf, rawUsed } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);

    expect(stockOf('box10')).toBe(31);      // 전에는 32 그대로였다
    expect(stockOf('loose')).toBe(2);       // 전에는 0이 되고 8개를 새로 만들었다
    expect(rawUsed).toEqual({});            // 원료 로트를 건드리지 않는다
    expect(order.producedUnits).toEqual([]); // 생산량 0
  });

  it('박스 32 · 40박스 주문 → 부족한 8박스만 생산(낱개 2 사용 + 78 신규)', async () => {
    const items = [벌크(), 낱개(2), 박스10(32)];
    const order = 주문(40);
    const { engine, stockOf, rawUsed } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);

    expect(stockOf('box10')).toBe(0);       // 32 + 8(생산) − 40(출고)
    expect(stockOf('loose')).toBe(0);       // 낱개 재고 2 소진
    expect(order.producedUnits).toEqual([{ itemId: 'box10', qty: 8 }]);
    expect(order.autoBuilt).toEqual([{ itemId: 'loose', qty: 78 }]);   // 80 필요 − 2 보유
    expect(rawUsed.bulk).toBe(1);           // 78개분 원료는 실제로 나간다
  });

  it('박스 재고가 없으면 전량 생산 — 예전과 같다', async () => {
    const items = [벌크(), 낱개(0), 박스10(0)];
    const order = 주문(3);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);

    expect(stockOf('box10')).toBe(0);
    expect(order.producedUnits).toEqual([{ itemId: 'box10', qty: 3 }]);
    expect(order.autoBuilt).toEqual([{ itemId: 'loose', qty: 30 }]);
  });
});

describe('사용자가 고른 사용량을 따른다', () => {
  it("'사용안함'(own 0)이면 전량 생산 — 박스 재고는 그대로 남는다", async () => {
    const items = [벌크(), 낱개(0), 박스10(32)];
    const order = 주문(1);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED, { 0: { own: 0 } });

    expect(stockOf('box10')).toBe(32);      // +1 생산 −1 출고
    expect(order.producedUnits).toEqual([{ itemId: 'box10', qty: 1 }]);
  });

  it('일부만 사용 — 박스 5개 중 2개만 재고로, 3개는 생산', async () => {
    const items = [벌크(), 낱개(0), 박스10(32)];
    const order = 주문(5);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED, { 0: { own: 2 } });

    expect(stockOf('box10')).toBe(30);      // 32 + 3(생산) − 5(출고)
    expect(order.producedUnits).toEqual([{ itemId: 'box10', qty: 3 }]);
    expect(order.autoBuilt).toEqual([{ itemId: 'loose', qty: 30 }]);
  });

  it('낱개 사용안함 — 부족 박스를 낱개 재고 없이 전부 새로 만든다', async () => {
    const items = [벌크(), 낱개(50), 박스10(0)];
    const order = 주문(2);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED, { 0: { own: 0, loose: 0 } });

    expect(stockOf('loose')).toBe(50);      // 낱개 재고 그대로
    expect(order.autoBuilt).toEqual([{ itemId: 'loose', qty: 20 }]);
  });

  it('낱개 일부만 사용 — 20개 필요한데 5개만 쓰면 15개를 만든다', async () => {
    const items = [벌크(), 낱개(50), 박스10(0)];
    const order = 주문(2);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED, { 0: { own: 0, loose: 5 } });

    expect(stockOf('loose')).toBe(45);      // 5개만 소진
    expect(order.autoBuilt).toEqual([{ itemId: 'loose', qty: 15 }]);
  });
});

describe('되돌리기는 실제 생산분만 되돌린다', () => {
  it('박스 32 · 40박스 주문을 PENDING으로 되돌리면 원래 재고로 복귀', async () => {
    const items = [벌크(), 낱개(2), 박스10(32)];
    const order = 주문(40);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);
    expect(stockOf('box10')).toBe(0);

    await engine.reconcileOrderStock(order, OrderStatus.PENDING);
    expect(stockOf('box10')).toBe(32);
    expect(stockOf('loose')).toBe(2);
  });

  it('재고로 전부 충당한 주문도 정확히 복귀', async () => {
    const items = [벌크(), 낱개(2), 박스10(32)];
    const order = 주문(1);
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);
    expect(stockOf('box10')).toBe(31);

    await engine.reconcileOrderStock(order, OrderStatus.PENDING);
    expect(stockOf('box10')).toBe(32);
    expect(stockOf('loose')).toBe(2);
  });

  it('producedUnits가 없는 옛 주문은 주문량 전량을 생산한 것으로 보고 되돌린다', async () => {
    const items = [벌크(), 낱개(0), 박스10(32)];
    // 옛 엔진이 처리해 둔 주문 — 박스 +1/−1 상쇄, 낱개 10개를 만들어 썼다
    const order = {
      ...주문(1), status: OrderStatus.SHIPPED, producedAt: '2026-08-01T00:00:00.000Z',
      shippedOut: true, autoBuilt: [{ itemId: 'loose', qty: 10 }], rawConsumedLots: [],
    } as unknown as Order;
    const { engine, stockOf } = harness(items, order);

    await engine.reconcileOrderStock(order, OrderStatus.PENDING);

    expect(stockOf('box10')).toBe(32);      // +1(출고취소) −1(생산취소)
    expect(stockOf('loose')).toBe(0);       // +10(BOM 복원) −10(먼저 만든 것 취소)
  });
});

describe('모달 행 계산 (stockUseRows)', () => {
  const items = [벌크(), 낱개(2), 박스10(32)];

  it('재고가 있는 라인만 묻는다 — 기본값은 min(주문량, 재고)', () => {
    const rows = buildStockUseRows(주문(5), items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idx: 0, itemId: 'box10', ordered: 5, stock: 32, unitLabel: '박스' });

    const [s] = resolveStockUse(rows);
    expect(s.own).toBe(5);          // 재고가 더 많으면 주문량만큼
    expect(s.shortUnits).toBe(0);
    expect(s.loose).toBeUndefined(); // 부족분이 없으면 낱개는 안 묻는다
  });

  it('박스로 다 못 채우면 낱개 행이 따라 나온다', () => {
    const [s] = resolveStockUse(buildStockUseRows(주문(40), items));
    expect(s.own).toBe(32);                 // 주문량 ≥ 재고 → 재고 전량
    expect(s.shortUnits).toBe(8);
    expect(s.loose).toMatchObject({ need: 80, value: 2, short: 78 });
  });

  it('박스 사용량을 줄이면 낱개 행이 그때 나타난다', () => {
    const rows = buildStockUseRows(주문(5), items);
    const [s] = resolveStockUse(rows, { 0: 2 });
    expect(s.shortUnits).toBe(3);
    expect(s.loose).toMatchObject({ need: 30, value: 2, short: 28 });
  });

  it('재고가 하나도 없으면 아무것도 안 묻는다', () => {
    expect(buildStockUseRows(주문(5), [벌크(), 낱개(0), 박스10(0)])).toEqual([]);
  });

  it('같은 낱개를 노리는 두 라인이 재고를 나눠 쓴다', () => {
    const 박스20 = mk({
      id: 'box20', name: '볶음참깨/1kg (20개입)', category: 'product', unit: '박스', stock: 0,
      submaterials: [{ id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', stock: 20 }] as any,
    });
    const order = {
      ...주문(1),
      items: [
        { itemId: 'box10', quantity: 10, isBoxUnit: true, boxQuantity: 1 },
        { itemId: 'box20', quantity: 20, isBoxUnit: true, boxQuantity: 1 },
      ],
    } as unknown as Order;
    const rows = buildStockUseRows(order, [벌크(), 낱개(5), 박스10(0), 박스20]);
    const states = resolveStockUse(rows);

    expect(states[0].loose!.value).toBe(5);   // 첫 줄이 5개를 다 가져가고
    expect(states[1].loose!.value).toBe(0);   // 둘째 줄엔 남은 게 없다
    expect(states[1].loose!.short).toBe(20);
    expect(toStockUsePlan(states)).toEqual({ 0: { own: 0, loose: 5 }, 1: { own: 0, loose: 0 } });
  });
});
