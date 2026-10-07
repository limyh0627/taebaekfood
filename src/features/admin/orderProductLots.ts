import type { Item, Order, OrderItem, RawMaterialLot } from '../../shared/types';
import { buildProductLot, deductLotsByQty, restoreLotsByQty, withCarryOverProductLot, type ProductLotTake } from '../../shared/lotUtils';
import { holdsUnitStock, isGoodsItem, isBulkItem } from '../../shared/itemTaxonomy';
import { kgPerStockUnit, type OrderUnitInputs } from '../../shared/orderUnits';

export interface OrderProductLotMutationResult {
  lots: RawMaterialLot[];
  consumedLots: NonNullable<Order['productConsumedLots']>;
}

export interface OrderProductLotMutation {
  itemId: string;
  apply: (lots: RawMaterialLot[], stock?: number) => OrderProductLotMutationResult;
}

export class OrderInventoryPreconditionError extends Error {
  inventoryUnchanged = true;
}

/** 재고 증가와 같은 transaction에 전달한다. 기존 로트 부족은 과거 생산으로 단정해 보충하지 않는다. */
export function productionProductLots(allItems: Item[], deltas: ReadonlyMap<string, number>, operationId: string, inputs?: OrderUnitInputs) {
  const traces: { itemId: string; lotId: string; qty: number }[] = [];
  const mutations: OrderProductLotMutation[] = [];
  const consumedLots: NonNullable<Order['productConsumedLots']> = [];
  for (const [itemId, qty] of deltas) {
    const item = allItems.find(row => row.id === itemId);
    if (!item || !qty || isBulkItem(item)) continue;
    if (qty < 0) {
      const take = createOrderProductLotOperations({ allItems, shipQtyOf: row => row.quantity })
        .deductProductLotsForOrder({ items: [{ itemId, quantity: -qty }] } as Order)[0]!;
      mutations.push({ itemId, apply: lots => {
        const result = take.apply(lots);
        // transaction 재시도에서 앞선 시도의 추적 수량을 중복 누적하지 않는다.
        consumedLots.splice(0, consumedLots.length, ...consumedLots.filter(row => row.itemId !== itemId), ...result.consumedLots);
        return { lots: result.lots, consumedLots: [] };
      } });
      continue;
    }
    if (!holdsUnitStock(item) || isGoodsItem(item)) continue;
    const unitKg = kgPerStockUnit(item, id => allItems.find(row => row.id === id), inputs) ?? 0;
    const lot = buildProductLot({ itemId, material: item.name, supplierName: '자체 생산', qtyIn: qty, unitKg });
    lot.id = `production-${operationId}-${itemId}`;
    lot.poId = operationId;
    traces.push({ itemId, lotId: lot.id, qty });
    mutations.push({ itemId, apply: (lots, stock = 0) => {
      if (lots.some(row => row.id === lot.id)) throw new Error('이미 반영된 생산 로트입니다. 주문 생산 기록을 확인해 주세요.');
      return { lots: [...withCarryOverProductLot(lots, stock, item.name, unitKg, { id: `carry-${lot.id}`, createdAt: lot.createdAt, receivedDate: lot.receivedDate }), lot], consumedLots: [] };
    } });
  }
  return { traces, mutations, consumedLots };
}

export function reverseProductionProductLots(traces: { itemId: string; lotId: string; qty: number }[] = []): OrderProductLotMutation[] {
  const grouped = new Map<string, typeof traces>();
  for (const trace of traces) grouped.set(trace.itemId, [...(grouped.get(trace.itemId) ?? []), trace]);
  return [...grouped].map(([itemId, rows]) => ({ itemId, apply: lots => {
    for (const row of rows) {
      const lot = lots.find(candidate => candidate.id === row.lotId);
      if (!lot || Number(lot.qtyRemaining ?? 0) < row.qty) throw new Error('생산 로트가 이미 사용되어 생산을 취소할 수 없습니다.');
    }
    return { lots: lots.map(lot => {
      const qty = rows.filter(row => row.lotId === lot.id).reduce((sum, row) => sum + row.qty, 0);
      return qty ? { ...lot, qtyRemaining: Math.round((Number(lot.qtyRemaining) - qty) * 1000) / 1000, kgRemaining: Math.round((Number(lot.qtyRemaining) - qty) * Number(lot.unitKg ?? 0) * 1000) / 1000 } : lot;
    }), consumedLots: [] };
  } }));
}

export function combineProductLotMutations(mutations: readonly OrderProductLotMutation[]): OrderProductLotMutation[] {
  const grouped = new Map<string, OrderProductLotMutation[]>();
  for (const mutation of mutations) grouped.set(mutation.itemId, [...(grouped.get(mutation.itemId) ?? []), mutation]);
  return [...grouped].map(([itemId, steps]) => ({ itemId, apply: (lots, stock) => {
    let result: OrderProductLotMutationResult = { lots, consumedLots: [] };
    for (const step of steps) { const next = step.apply(result.lots, stock); result = { lots: next.lots, consumedLots: [...result.consumedLots, ...next.consumedLots] }; }
    return result;
  } }));
}

export interface OrderProductLotDeps {
  allItems: Item[];
  shipQtyOf: (item: OrderItem, product: Item) => number;
}

/**
 * 주문 출고와 완제품 로트 추적의 계산 경계.
 *
 * 여기서는 DB를 쓰지 않고 품목별 로트 변환만 만든다. 숫자 재고와 로트를 각각 저장하면
 * 둘 중 하나만 성공할 수 있으므로, 실제 쓰기는 orderItemStock의 한 transaction에 넘긴다.
 */
export function createOrderProductLotOperations(deps: OrderProductLotDeps) {
  const { allItems, shipQtyOf } = deps;

  const deductProductLotsForOrder = (order: Order): OrderProductLotMutation[] => {
    const quantityByItem = new Map<string, number>();
    for (const row of order.items) {
      const product = allItems.find(item => item.id === row.itemId);
      if (!product) throw new Error(`완제품 로트 출고 중 품목 기준정보를 찾을 수 없습니다: ${row.itemId}`);
      const qty = shipQtyOf(row, product);
      if (qty > 0) quantityByItem.set(product.id, (quantityByItem.get(product.id) ?? 0) + qty);
    }

    return [...quantityByItem].map(([itemId, qty]) => ({
      itemId,
      apply: (lots: RawMaterialLot[]) => {
        // 로트를 쓰기 시작한 품목만 추적한다. 로트가 전혀 없는 옛 품목에 출고만으로
        // 음수 이월 로트를 새로 만들면 기존 숫자 재고와 기준점이 맞지 않는다.
        if (!lots.some(lot => lot.qtyRemaining != null)) return { lots, consumedLots: [] };
        const result = deductLotsByQty(lots, qty);
        if (result.shortageQty > 0) {
          const product = allItems.find(item => item.id === itemId);
          const available = Math.round((qty - result.shortageQty) * 1000) / 1000;
          throw new OrderInventoryPreconditionError(`${product?.name ?? itemId} 로트 재고가 부족합니다. 현재 ${available}, 출고 ${qty}`);
        }
        const consumedLots = result.distribution.map(trace => ({
          itemId,
          material: result.lots.find(lot => lot.id === trace.lotId)?.material,
          lotId: trace.lotId,
          lotNo: trace.lotNo,
          receivedDate: trace.receivedDate,
          qty: trace.qty,
        }));
        return { lots: result.lots, consumedLots };
      },
    }));
  };

  const restoreProductLotsForOrder = (order: Order): OrderProductLotMutation[] => {
    const byItem = new Map<string, ProductLotTake[]>();
    for (const trace of order.productConsumedLots ?? []) {
      const current = byItem.get(trace.itemId) ?? [];
      current.push({
        lotId: trace.lotId,
        lotNo: trace.lotNo,
        receivedDate: trace.receivedDate,
        supplierName: '',
        qty: trace.qty,
      });
      byItem.set(trace.itemId, current);
    }
    return [...byItem].map(([itemId, traces]) => ({
      itemId,
      apply: (lots: RawMaterialLot[]) => ({
        lots: restoreLotsByQty(lots, traces),
        consumedLots: [],
      }),
    }));
  };

  return { deductProductLotsForOrder, restoreProductLotsForOrder };
}
