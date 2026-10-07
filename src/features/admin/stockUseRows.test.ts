import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { buildBomIndex, getBomIndex, setBomIndex } from '../../shared/bomIndex';
import { buildPackIndex } from '../../shared/packIndex';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import { createOrderStockEngine } from './orderStockEngine';
import { buildStockUseRows, resolveStockUse, toStockUsePlan } from './stockUseRows';
const sdk = vi.hoisted(() => ({ getDoc: vi.fn() }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(), doc: vi.fn(() => ({})), getDoc: sdk.getDoc }));
const previous = getBomIndex();
afterEach(() => { setBomIndex(previous); vi.clearAllMocks(); });
const items = [
  { id: 'box-a', companyId: 'taebaek', name: '20개입 박스', type: 'product', unit: '박스', stock: 2 },
  { id: 'loose-a', companyId: 'taebaek', name: '낱개', type: 'product', unit: '개', stock: 30 },
] as Item[];
const inputs = { bom: buildBomIndex(items, [{ parent_id: 'box-a', child_id: 'loose-a', quantity: 20 }]), pack: buildPackIndex() };
const order = { id: 'order-a', companyId: 'taebaek', status: OrderStatus.PROCESSING, items: [{ itemId: 'box-a', name: '박스', quantity: 100, boxQuantity: 5 }] } as Order;

describe('재고 사용 확인창 명시 입력', () => {
  it('실제 최신 주문 조회 대기 중 전역 회사 색인이 바뀌어도 A 확인 수량을 유지한다', async () => {
    let finish!: (snapshot: { exists: () => boolean; data: () => Order }) => void;
    sdk.getDoc.mockReturnValueOnce(new Promise(done => { finish = done; }));
    const updateItem = vi.fn(), addItem = vi.fn();
    const engine = createOrderStockEngine({ allItems: items, submaterials: [], partners: [], allOrders: [order], orders: [order], db: {} as Firestore,
      orderUnitInputs: inputs, buildFormula: () => [], createProductionRecordsForOrder: vi.fn(), updateItem, addItem });
    // AdminApp requestOrderStatus와 같은 실제 prepare await → 확인창 계산 순서.
    const prepareRows = async () => {
      const prepared = await engine.prepareOrderStatusChange(order.id, OrderStatus.DISPATCHED);
      return buildStockUseRows(prepared!.order, items, inputs);
    };
    setBomIndex(inputs.bom);
    const pending = prepareRows();
    const foreign = buildBomIndex([], []); setBomIndex(foreign);
    finish({ exists: () => true, data: () => order });
    const rows = await pending;
    expect(rows[0]).toMatchObject({ ordered: 5, unitLabel: '박스', stock: 2, loose: { count: 20, stock: 30 } });
    expect(toStockUsePlan(resolveStockUse(rows))).toEqual({ 0: { own: 2, loose: 30 } });
    expect(getBomIndex()).toBe(foreign); expect(updateItem).not.toHaveBeenCalled(); expect(addItem).not.toHaveBeenCalled();
  });
  it('명시 A/B 입력을 번갈아 읽어도 서로의 박스 개입수와 입력은 바뀌지 않는다', () => {
    const otherItems = items.map(item => ({ ...item, companyId: 'punghoe' as const, id: item.id.replace('-a', '-b') }));
    const otherInputs = { bom: buildBomIndex(otherItems, [{ parent_id: 'box-b', child_id: 'loose-b', quantity: 12 }]), pack: buildPackIndex() };
    const otherOrder = { items: [{ itemId: 'box-b', name: '풍회 박스', quantity: 36, boxQuantity: 3 }] } as Pick<Order, 'items'>;
    const original = structuredClone({ items, otherItems, order, otherOrder });
    setBomIndex(buildBomIndex([], []));
    expect(buildStockUseRows(order, items, inputs)[0].loose?.count).toBe(20);
    expect(buildStockUseRows(otherOrder, otherItems, otherInputs)[0]).toMatchObject({ ordered: 3, loose: { count: 12 } });
    expect(buildStockUseRows(order, items, inputs)[0].ordered).toBe(5);
    expect({ items, otherItems, order, otherOrder }).toEqual(original);
  });
  it('선택 입력이 없는 옛 호출은 전역 BOM을 그대로 사용한다', () => {
    setBomIndex(inputs.bom);
    expect(buildStockUseRows(order, items)[0]).toMatchObject({ ordered: 5, loose: { count: 20 } });
  });
  it('생산하지 않는 완사입 품목은 명시 입력에서도 제외한다', () => {
    expect(buildStockUseRows(order, items.map(item => ({ ...item, procureType: '완사입' })), inputs)).toEqual([]);
  });
});
