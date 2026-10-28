import type {OrderRawInventoryTrace} from './orderRawCommandPlan';
import type {OrderRawCalculationEvidence} from './orderProductionDomain';
import type {ProductConsumedLotTrace} from './orderProductLotPlan';
const safePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'item';

/** 옛 주문도 첫 품목 작업 때 줄 ID를 한 번만 확정한다. */
export function ensureOrderLineIds<T extends {itemId:string;lineId?:string}>(items: readonly T[]): T[] {
  const used = new Set<string>();
  return items.map((item, index) => {
    const base = item.lineId || `line-${index + 1}-${safePart(item.itemId)}`;
    let lineId = base;
    let suffix = 2;
    while (used.has(lineId)) lineId = `${base}-${suffix++}`;
    used.add(lineId);
    return item.lineId === lineId ? item : { ...item, lineId };
  });
}


export interface OrderRawEffectOrigin {protocol:'private-stock-full-v1';reference:{version:1;companyId:'taebaek'|'punghoe';orderId:string;requestId:string};owner:{uid:string;employeeId:string;companyId:'taebaek'|'punghoe'};lineId:string;attempt:number}
export interface OrderRawReversalOrigin extends OrderRawEffectOrigin {sourceReference:OrderRawEffectOrigin['reference']}
export interface OrderRawEffectReference extends OrderRawEffectOrigin {commandIndex:number;operationId:string;rawItemId:string;movementPath:string;source:{type:string;id:string};commandHash:string;movementHash:string}
export interface OrderItemInventoryState {
  version: 1;
  lineId: string;
  itemId: string;
  applied: boolean;
  attempt: number;
  completedAt?: string;
  reversedAt?: string;
  rawEffectOrigin?:OrderRawEffectOrigin;
  rawEffectReferences?:OrderRawEffectReference[];
  rawReversalOrigin?:OrderRawReversalOrigin;
  rawConsumedLots: OrderRawInventoryTrace[];
  autoBuilt: { itemId: string; qty: number }[];
  producedUnits: { itemId: string; qty: number }[];
  production: OrderInventorySnapshot;
}

export interface OrderInventoryAdjustment {
  itemId: string;
  delta: number;
}

export interface OrderInventorySnapshot {
  capturedAt: string;
  rawCalculationEvidence?: OrderRawCalculationEvidence[];
  stockDeltas: OrderInventoryAdjustment[];
  bomLines: { parentItemId: string; childItemId: string; quantity: number }[];
  rawConsumedLots?: OrderRawInventoryTrace[];
  productConsumedLots?: ProductConsumedLotTrace[];
  productProducedLots?: { itemId: string; lotId: string; qty: number }[];
  rawLedgerIds?: string[];
}

export interface OrderLineInventoryAggregate {producedAt?:string;rawLotsDeducted?:boolean;rawConsumedLots?:OrderRawInventoryTrace[];rawInventoryAttempt?:number;autoBuilt?:{itemId:string;qty:number}[];producedUnits?:{itemId:string;qty:number}[];inventorySnapshots?:{version:1;production?:OrderInventorySnapshot;shipment?:OrderInventorySnapshot}}
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
  order: {inventorySnapshots?: {version: 1; production?: OrderInventorySnapshot; shipment?: OrderInventorySnapshot}},
  states: Record<string, OrderItemInventoryState>,
): OrderLineInventoryAggregate {
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

  const completedTimes = active.map(state => state.completedAt || state.production.capturedAt).sort();
  const capturedAt = completedTimes[completedTimes.length - 1]!;
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


export const completedLineAllocation = <T extends {items: L[]}, L extends {lineId?:string}>(
    order: T,
    items: readonly L[],
    states: Record<string, Pick<OrderItemInventoryState, 'applied'>>,
    shipOrder: (order: T, deltas: Map<string, number>) => void,
  ) => {
    const completed = items.filter(item => !!item.lineId && states[item.lineId]?.applied);
    const shipment = new Map<string, number>();
    shipOrder({ ...order, items: completed }, shipment);
    return new Map([...shipment]
      .filter(([, delta]) => delta < 0)
      .map(([itemId, delta]) => [itemId, -delta]));
  };
