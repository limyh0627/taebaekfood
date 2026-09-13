import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import { buildStockUseRows, resolveStockUse, toStockUsePlan } from './stockUseRows';
import { rawInventoryJobTestDouble } from '../../test/rawInventoryJobTestDouble';

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
/**
 * 재고는 **DB에서 읽어 더한다**(트랜잭션) — 화면 상태에 더해 덮어쓰면 앞선 쓰기가 날아간다.
 * 그래서 여기 가짜 DB도 진짜처럼 자기가 들고 있는 값을 읽어 준다.
 */
const store = vi.hoisted(() => ({ stock: new Map<string, number>(), orders: new Map<string, any>() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  setDoc: async (_ref: unknown, data: any) => { ledger.entries.push(data); },
  deleteDoc: async () => {},
  getDoc: async (ref: any) => ref.col === 'items'
    ? { exists: () => store.stock.has(ref.id), data: () => ({ stock: store.stock.get(ref.id) }) }
    : { exists: () => store.orders.has(ref.id), data: () => store.orders.get(ref.id) },
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => fn({
    get: async (ref: any) => ref.col === 'items' ? ({
      exists: () => store.stock.has(ref.id), data: () => ({ stock: store.stock.get(ref.id) }),
    }) : ({ exists: () => store.orders.has(ref.id), data: () => store.orders.get(ref.id) }),
    update: (ref: any, data: any) => {
      if (ref.col === 'items' && data.stock !== undefined) store.stock.set(ref.id, data.stock);
      if (ref.col === 'orders') store.orders.set(ref.id, { ...(store.orders.get(ref.id) ?? {}), ...data });
    },
  }),
}));

// 엔진은 firebase/firestore를 모듈 최상단에서 읽으므로 mock 뒤에 가져온다.
const { setBomIndex, buildBomIndex } = await import('../../shared/bomIndex');
const { createOrderStockEngine } = await import('./orderStockEngine');

const mk = (o: Partial<Item> & { id: string }) =>
  ({ name: o.id, unit: '개', stock: 0, spec: '', minStock: 0, price: 0, image: '', ...o }) as unknown as Item;

const 벌크 = () => mk({ id: 'bulk', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 500 });
const 낱개 = (stock: number) => mk({
  id: 'loose', name: '볶음참깨-낱개/1kg', type: 'product', unit: '개', spec: '1kg', stock,
});
const 박스10 = (stock: number) => mk({
  id: 'box10', name: '볶음참깨/1kg (10개입)', type: 'product', unit: '박스', spec: '10kg', stock,
});
const 박스20 = (stock: number) => mk({
  id: 'box20', name: '볶음참깨/1kg (20개입)', type: 'product', unit: '박스', spec: '20kg', stock,
});

/**
 * 구성은 item_bom이 유일 원천이다 — 품목에 붙이던 submaterials는 없앴다.
 *   낱개  ← 벌크 ×1(kg)
 *   박스10 ← 낱개 ×10
 *   박스20 ← 낱개 ×20
 */
const bom = (parent: string, child: string, quantity: number) => ({ parent_id: parent, child_id: child, quantity });
const BOMS = [bom('loose', 'bulk', 1), bom('box10', 'loose', 10), bom('box20', 'loose', 20)];

/** 엔진을 실제로 돌린다. updateItem이 items·order를 그 자리에서 고쳐 앱의 리렌더를 흉내낸다. */
function harness(
  items: Item[], order: Order,
  buildFormula: (key: string) => { raw: string; ratio: number }[] = () => [],
  claimOrderOperation?: () => Promise<Order>,
) {
  const rawUsed: Record<string, number> = {};
  const 주문쓰기: Array<{ id: string; data: unknown }> = [];
  setBomIndex(buildBomIndex(items, BOMS));
  // 가짜 DB에 지금 재고를 실어 둔다 — 엔진이 트랜잭션으로 여기서 읽고 여기에 쓴다
  store.stock.clear();
  store.orders.clear();
  store.orders.set(order.id, { ...order });
  for (const i of items) store.stock.set(i.id, i.stock ?? 0);
  const lotState = new Map<string, any[]>(items.map(i => [i.id, [...((i as any).lots ?? [])]]));
  const rawLedger = new Map<string, Record<string, any>>();
  const runRawJob = rawInventoryJobTestDouble({ items, lots: lotState, stock: store.stock, ledger: rawLedger });
  const engine = createOrderStockEngine({
    allItems: items, submaterials: [], partners: [], allOrders: [order], orders: [order],
    db: {} as any,
    buildFormula,
    createProductionRecordsForOrder: async () => {},
    ...(claimOrderOperation ? { claimOrderOperation } : {}),
    runRawInventoryJob: async input => {
      const result = await runRawJob(input);
      for (const r of result.results) {
        if (r.result.status === 'applied' && r.input.command.kind === 'consume') {
          const id = r.input.command.rawItemId;
          rawUsed[id] = (rawUsed[id] ?? 0) + 1;
        }
      }
      return result;
    },
    updateItem: async (col, id, data: any) => {
      if (col === 'items') { const it = items.find(i => i.id === id); if (it) it.stock = data.stock; }
      if (col === 'orders') {
        주문쓰기.push({ id, data });
        Object.assign(order, data);
        store.orders.set(id, { ...(store.orders.get(id) ?? {}), ...data });
      }
      return undefined;
    },
    addItem: async () => undefined,
  });
  // 재고는 이제 트랜잭션으로 DB(가짜 store)에 쓰인다 — 앱 리렌더를 흉내내 items에도 되비춘다
  const stockOf = (id: string) => {
    const v = store.stock.get(id);
    const it = items.find(i => i.id === id)!;
    if (v !== undefined) it.stock = v;
    return it.stock;
  };
  const savedOrder = () => store.orders.get(order.id) as Order;
  return { engine, stockOf, rawUsed, ledger: ledger.entries, rawLedger, savedOrder, 주문쓰기 };
}

const 주문 = (boxes: number): Order => ({
  id: 'o1', partnerName: '테스트', status: OrderStatus.PENDING,
  items: [{ itemId: 'box10', name: '볶음참깨/1kg (10개입)', quantity: boxes * 10, isBoxUnit: true, boxQuantity: boxes } as any],
} as unknown as Order);

beforeEach(() => {
  ledger.entries.length = 0;
  // BOM 색인은 모듈 전역이다. 앞 시험이 다른 품목의 색인을 심어도 다음 시험까지 새면 안 된다.
  setBomIndex(buildBomIndex([벌크(), 낱개(0), 박스10(0), 박스20(0)], BOMS));
});

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
    expect(order.inventorySnapshots?.production?.stockDeltas.length).toBeGreaterThan(0);
    expect(order.inventorySnapshots?.production?.bomLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentItemId: 'box10', childItemId: 'loose', quantity: 10 }),
    ]));
    expect(order.inventorySnapshots?.shipment?.stockDeltas).toEqual([{ itemId: 'box10', delta: -40 }]);

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

describe('품목 체크 한 줄마다 BOM을 반영한다', () => {
  it('첫 줄만 완료하면 그 줄 구성품만 빠지고, 체크를 풀면 그 줄 스냅샷만 원복한다', async () => {
    const bottle = mk({ id: 'bottle', name: '180ml 병', type: 'submaterial', stock: 100 });
    const product = mk({ id: 'oil', name: '참기름 180ml', type: 'product', stock: 0 });
    const items = [bottle, product];
    const order = {
      id: 'line-order', partnerName: '품목별 거래처', status: OrderStatus.PENDING,
      items: [
        { lineId: 'line-a', itemId: 'oil', name: '참기름 180ml', quantity: 10, checked: false },
        { lineId: 'line-b', itemId: 'oil', name: '참기름 180ml', quantity: 20, checked: false },
      ],
    } as unknown as Order;
    const { engine, stockOf, savedOrder } = harness(items, order);
    setBomIndex(buildBomIndex(items, [bom('oil', 'bottle', 1)]));

    const firstDone = order.items.map((item, index) => index === 0 ? { ...item, checked: true } : item);
    await engine.changeOrderItemCompletion(order.id, 0, firstDone, OrderStatus.PROCESSING);

    expect(stockOf('bottle')).toBe(90);
    expect(stockOf('oil')).toBe(10);
    expect(savedOrder().itemInventory?.['line-a']).toMatchObject({ applied: true, itemId: 'oil' });
    expect(savedOrder().itemInventory?.['line-b']).toBeUndefined();
    expect(savedOrder().status).toBe(OrderStatus.PROCESSING);

    const firstUndone = savedOrder().items.map((item, index) => index === 0 ? { ...item, checked: false } : item);
    await engine.changeOrderItemCompletion(order.id, 0, firstUndone, OrderStatus.PENDING);

    expect(stockOf('bottle')).toBe(100);
    expect(stockOf('oil')).toBe(0);
    expect(savedOrder().itemInventory?.['line-a']).toMatchObject({ applied: false, attempt: 1 });
    expect(savedOrder().producedAt).toBe('');
  });
});

describe('임가공 판매의 원료수불부 기록', () => {
  it('원료 로트는 그대로 두고 사용 이력을 남기며 생산 취소는 그 이력만 역분개한다', async () => {
    const raw = mk({
      id: 'raw-oem', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 500,
      lots: [{
        id: 'raw-lot', supplierName: '기존', receivedDate: '2026-09-01',
        qtyIn: 0, kgIn: 500, kgRemaining: 500, status: 'active', createdAt: '',
      }],
    });
    const product = mk({
      id: 'oem-product', name: '임가공 볶음참깨', type: 'product',
      procureType: '임가공', spec: '1kg', stock: 10,
    });
    const order = {
      id: 'oem-order', partnerName: '임가공 거래처', status: OrderStatus.PENDING,
      items: [{ itemId: product.id, name: product.name, quantity: 3 }],
    } as unknown as Order;
    setBomIndex(buildBomIndex([raw, product], []));
    const { engine, stockOf, rawLedger } = harness(
      [raw, product], order,
      () => [{ raw: '볶음참깨', ratio: 1 }],
    );

    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);

    const operationId = 'production-ledger:oem-order:a1:raw-oem';
    expect(stockOf('raw-oem')).toBe(500);
    expect(rawLedger.get(operationId)).toMatchObject({
      kind: 'ledger-consume', used: 3, appliedDeltaKg: 0, lotChanges: [],
    });
    expect(order.rawConsumedLots).toEqual([expect.objectContaining({
      material: '볶음참깨', rawItemId: 'raw-oem', operationId, kg: 3, ledgerOnly: true,
    })]);

    await engine.reconcileOrderStock(order, OrderStatus.PENDING);

    expect(stockOf('raw-oem')).toBe(500);
    expect(rawLedger.get(`reverse:${operationId}`)).toMatchObject({
      kind: 'reverse', received: 3, appliedDeltaKg: 0, reversalOf: operationId,
    });
  });

  it('품목별 원료 명령은 주문·줄·회차를 모두 넣어 다른 줄과 겹치지 않는다', async () => {
    const raw = mk({ id: 'raw-oem', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 500 });
    const product = mk({
      id: 'oem-product', name: '임가공 볶음참깨', type: 'product', procureType: '임가공', spec: '1kg', stock: 10,
    });
    const order = {
      id: 'oem-line', partnerName: '임가공 거래처', status: OrderStatus.PENDING,
      items: [{ lineId: 'line-a', itemId: product.id, name: product.name, quantity: 3, checked: false }],
    } as unknown as Order;
    const { engine, rawLedger } = harness([raw, product], order, () => [{ raw: '볶음참깨', ratio: 1 }]);
    setBomIndex(buildBomIndex([raw, product], []));

    await engine.changeOrderItemCompletion(
      order.id, 0, [{ ...order.items[0]!, checked: true }], OrderStatus.DISPATCHED,
    );

    const operationId = 'production-ledger:oem-line:line-a:a1:raw-oem';
    expect(rawLedger.get(operationId)).toMatchObject({ kind: 'ledger-consume', used: 3 });

    const saved = store.orders.get(order.id) as Order;
    await engine.changeOrderItemCompletion(
      order.id, 0, [{ ...saved.items[0]!, checked: false }], OrderStatus.PENDING,
    );
    expect(rawLedger.get(`reverse:${operationId}`)).toMatchObject({ kind: 'reverse', reversalOf: operationId });
  });
});

describe('모달 행 계산 (stockUseRows)', () => {
  const items = [벌크(), 낱개(2), 박스10(32)];

  it('생산 품목을 보여 준다 — 기본값은 min(주문량, 재고)', () => {
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

  it('재고가 하나도 없어도 전량 생산 행을 보여 준다', () => {
    const rows = buildStockUseRows(주문(5), [벌크(), 낱개(0), 박스10(0)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'box10', ordered: 5, stock: 0 });
    expect(resolveStockUse(rows)[0]).toMatchObject({ own: 0, shortUnits: 5 });
  });

  it('앞 품목이나 다른 주문이 배정한 재고는 사용 가능 수량에서 뺀다', () => {
    const box = 박스10(10);
    box.inventoryReservations = [{
      operationId: '앞품목', orderId: '다른주문', qty: 7,
      createdAt: new Date().toISOString(), state: 'allocated',
    }];
    const rows = buildStockUseRows(주문(5), [벌크(), 낱개(0), box]);
    expect(rows[0]).toMatchObject({ stock: 3, ordered: 5 });
    expect(resolveStockUse(rows)[0]).toMatchObject({ own: 3, shortUnits: 2 });
  });

  it('같은 낱개를 노리는 두 라인이 재고를 나눠 쓴다', () => {
    const 박스20 = mk({
      id: 'box20', name: '볶음참깨/1kg (20개입)', type: 'product', unit: '박스', stock: 0,
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

describe('품목 완료 실패 사유 보존', () => {
  it('이미 실패한 주문의 재시도 오류가 최초 실패 사유를 덮어쓰지 않는다', async () => {
    const originalFailure = {
      id: 'first-failure', targetStatus: OrderStatus.PROCESSING, state: 'failed' as const,
      startedAt: '2026-09-14T01:00:00.000Z', actor: '태백식품', error: 'BOM 품목 SK가 없습니다.',
    };
    const order = 주문(1);
    order.inventoryOperation = originalFailure;
    const { engine, 주문쓰기 } = harness(
      [벌크(), 낱개(0), 박스10(0)],
      order,
      () => [],
      async () => { throw new Error('이 주문의 이전 재고 작업이 실패 상태입니다.'); },
    );

    await expect(engine.changeOrderItemCompletion(
      order.id, 0, [{ ...order.items[0]!, checked: true }], OrderStatus.PROCESSING,
    )).rejects.toThrow('이전 재고 작업');

    expect(주문쓰기).toHaveLength(0);
    expect(order.inventoryOperation).toEqual(originalFailure);
  });
});

describe('작업완료와 출고를 따로 눌러도 재고가 안 날아간다', () => {
  /**
   * **실제로 재고를 마이너스로 판 버그.**
   *
   * 재고를 화면 상태(allItems)의 stock에 더해 덮어썼다. allItems는 엔진을 만들 때
   * 클로저에 갇혀 함수가 도는 동안 안 바뀌고, 구독이 갱신되기 전에 다음 쓰기가 들어오면
   * 앞선 쓰기가 통째로 날아간다.
   *
   *   작업완료  0 + 100 = 100  → DB에 100
   *   출고      allItems.stock이 아직 0 → 0 − 100 = −100  → DB에 −100
   *
   * 서래농산 8/10 주문에서 시골향볶음통들깨/4kg이 딱 이 모양으로 −100이 됐다
   * (주문 수량과 같은 값). 이제 DB에서 읽어 더하므로 화면이 낡아도 맞는다.
   */
  it('사이에 화면 상태가 안 갱신돼도 순변화는 쓴 재고만큼', async () => {
    const items = [벌크(), 낱개(0), 박스10(0)];
    const order = 주문(10);
    const { engine, stockOf } = harness(items, order);

    // 작업완료 — 재고가 없으니 10박스를 새로 만든다
    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    expect(stockOf('box10')).toBe(10);

    // 화면 상태를 일부러 옛 값으로 되돌린다 — 구독이 아직 안 온 상태
    items.find(i => i.id === 'box10')!.stock = 0;

    await engine.reconcileOrderStock(order, OrderStatus.SHIPPED);
    expect(stockOf('box10')).toBe(0);       // 전에는 −10이 됐다
  });

  it('같은 품목이 든 주문을 연달아 처리해도 안 겹친다', async () => {
    const items = [벌크(), 낱개(0), 박스10(5)];
    const o1 = { ...주문(2), id: 'o1' } as Order;
    const { engine, stockOf } = harness(items, o1);

    await engine.reconcileOrderStock(o1, OrderStatus.SHIPPED);
    expect(stockOf('box10')).toBe(3);

    // 두 번째 주문 — 화면 상태는 아직 5인 채로 들어온다
    items.find(i => i.id === 'box10')!.stock = 5;
    const o2 = { ...주문(2), id: 'o2' } as Order;
    await engine.reconcileOrderStock(o2, OrderStatus.SHIPPED);
    expect(stockOf('box10')).toBe(1);       // 3 − 2. 전에는 5 − 2 = 3으로 덮어썼다
  });
});
