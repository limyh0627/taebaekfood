import type { Item, Order, OrderItem, RawMaterialLot } from '../../shared/types';
import { deductLotsByQty, restoreLotsByQty, type ProductLotTake } from '../../shared/lotUtils';
import { today } from '../../shared/day';

export interface OrderProductLotMutationResult {
  lots: RawMaterialLot[];
  consumedLots: NonNullable<Order['productConsumedLots']>;
}

export interface OrderProductLotMutation {
  itemId: string;
  apply: (lots: RawMaterialLot[]) => OrderProductLotMutationResult;
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

    const createdAt = new Date().toISOString();
    return [...quantityByItem].map(([itemId, qty]) => ({
      itemId,
      apply: (lots: RawMaterialLot[]) => {
        // 로트를 쓰기 시작한 품목만 추적한다. 로트가 전혀 없는 옛 품목에 출고만으로
        // 음수 이월 로트를 새로 만들면 기존 숫자 재고와 기준점이 맞지 않는다.
        if (!lots.some(lot => lot.qtyRemaining != null)) return { lots, consumedLots: [] };
        const result = deductLotsByQty(lots, qty, {
          // transaction 재시도마다 다른 이월 로트가 생기지 않도록 주문·품목으로 고정한다.
          id: `lot-carry-shipment-${order.id}-${itemId}`,
          createdAt,
          receivedDate: today(),
        });
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
