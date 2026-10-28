import type { Order, OrderInventoryAdjustment, OrderItemInventoryState } from './types';

export {ensureOrderLineIds} from '../../functions/src/shared/orderLineInventory';

const sumRows = (rows: readonly OrderInventoryAdjustment[]) => {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.itemId, (sums.get(row.itemId) ?? 0) + row.delta);
  return [...sums]
    .map(([itemId, delta]) => ({ itemId, delta: Math.round(delta * 1000) / 1000 }))
    .filter(row => row.delta !== 0);
};

const sumQuantities = (rows: readonly { itemId: string; qty: number }[]) => {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.itemId, (sums.get(row.itemId) ?? 0) + row.qty);
  return [...sums]
    .map(([itemId, qty]) => ({ itemId, qty: Math.round(qty * 1000) / 1000 }))
    .filter(row => row.qty !== 0);
};

/**
 * 품목별 스냅샷을 기존 주문 단위 칸으로 합친다.
 * 원장·통계·되돌리기 코드를 한 번에 갈아엎지 않아도 새 주문은 같은 숫자를 읽게 한다.
 */
export function aggregateOrderLineInventory(
  order: Pick<Order, 'inventorySnapshots'>,
  states: Record<string, OrderItemInventoryState>,
): Pick<Order, 'producedAt' | 'rawLotsDeducted' | 'rawConsumedLots' | 'rawInventoryAttempt' | 'autoBuilt' | 'producedUnits' | 'inventorySnapshots'> {
  const active = Object.values(states).filter(state => state.applied);
  const rawConsumedLots = active.flatMap(state => state.rawConsumedLots);
  const autoBuilt = sumQuantities(active.flatMap(state => state.autoBuilt));
  const producedUnits = sumQuantities(active.flatMap(state => state.producedUnits));
  const latestAttempt = Math.max(0, ...Object.values(states).map(state => state.attempt));
  const shipment = order.inventorySnapshots?.shipment;

  if (active.length === 0) {
    return {
      producedAt: '', rawLotsDeducted: false, rawConsumedLots: [], rawInventoryAttempt: latestAttempt,
      autoBuilt: [], producedUnits: [],
      inventorySnapshots: { version: 1, ...(shipment ? { shipment } : {}) },
    };
  }

  const capturedAt = active.map(state => state.completedAt || state.production.capturedAt).sort().at(-1)!;
  const bomLines = [...new Map(active.flatMap(state => state.production.bomLines)
    .map(line => [`${line.parentItemId}\u0000${line.childItemId}`, line])).values()];
  const production = {
    capturedAt,
    stockDeltas: sumRows(active.flatMap(state => state.production.stockDeltas)),
    bomLines,
    rawConsumedLots,
    rawLedgerIds: [...new Set(active.flatMap(state => state.production.rawLedgerIds ?? []))],
    productProducedLots: active.flatMap(state => state.production.productProducedLots ?? []),
    productConsumedLots: active.flatMap(state => state.production.productConsumedLots ?? []),
  };
  return {
    producedAt: active.map(state => state.completedAt || state.production.capturedAt).sort()[0],
    rawLotsDeducted: true,
    rawConsumedLots,
    rawInventoryAttempt: latestAttempt,
    autoBuilt,
    producedUnits,
    inventorySnapshots: { version: 1, production, ...(shipment ? { shipment } : {}) },
  };
}

