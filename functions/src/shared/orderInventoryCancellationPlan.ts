import {OrderStatus} from './orderCompletion';
import {companyOf} from './orderProductionRecordPlan';
import {liveItemInventoryReservations,type ItemInventoryReservation} from './orderStockReservationPlan';
import {restoreLotsByQty} from './orderProductLotPlan';
import {reverseProductionProductLots,type ProductConsumedLotTrace} from './orderProductLotPlan';
import type {OrderInventorySnapshot,OrderItemInventoryState} from './orderLineInventory';
import type {OrderRawInventoryTrace} from './orderRawCommandPlan';
import type {CompanyId,RawMaterialLot} from './rawLot';
export interface CancellationOrder {id:string;companyId?:CompanyId;status:string;shippedOut?:boolean;producedAt?:string;rawLotsDeducted?:boolean;rawConsumedLots?:OrderRawInventoryTrace[];producedUnits?:{itemId:string;qty:number}[];autoBuilt?:{itemId:string;qty:number}[];productConsumedLots?:ProductConsumedLotTrace[];inventoryOperation?:{id:string}|null;inventorySnapshots?:{version:1;production?:OrderInventorySnapshot;shipment?:OrderInventorySnapshot};itemInventory?:Record<string,OrderItemInventoryState>}
export interface CancellationItem {id:string;companyId?:CompanyId;stock?:number;inventoryReservations?:ItemInventoryReservation[];lots?:RawMaterialLot[]}
export interface CancellationClock {nowMs:()=>number;isoNow:()=>string}
export type CancellationAction = 'cancel-shipment' | 'delete';
export class CancellationBlocked extends Error {
  constructor(public code: string, public affectedItemIds: string[] = []) { super(code); }
}
export const block = (code: string, ids: string[] = []): never => { throw new CancellationBlocked(code, ids); };
/** 승인한 당시 근거가 바뀌면 화면 확인을 다시 받아야 하므로 표시명/BOM은 포함하지 않는다. */
export function validateAction(action: unknown): asserts action is CancellationAction {
  if (action !== 'cancel-shipment' && action !== 'delete') block('CANCELLATION_ACTION_INVALID');
}
export function planOrderCancellation(order: CancellationOrder, action: CancellationAction, reportingOnlySnapshotIndexes?:ReadonlySet<number>) {
  validateAction(action);
  if (action === 'cancel-shipment' && order.status !== OrderStatus.SHIPPED) block('SHIPMENT_STATUS_CHANGED');
  if (action === 'delete' && order.status === OrderStatus.SHIPPED) block('SHIPMENT_CANCEL_REQUIRED');
  // 배송완료 과거 기록은 재고를 되돌리지 않는 별도 정책이지만 승인·회사·완료표 경계는 공유한다.
  if (action === 'delete' && order.status === OrderStatus.DELIVERED) return {
    recordOnly: true, deltas: new Map<string, number>(), rawOriginals: new Map<string, string>(),
    lotTraces: [] as NonNullable<CancellationOrder['productConsumedLots']>, snapshots: [] as OrderInventorySnapshot[],
  };
  if (action === 'delete' && order.shippedOut) block('SHIPMENT_CANCEL_REQUIRED');
  const active = Object.values(order.itemInventory ?? {}).filter(state => state.applied);
  let snapshots: OrderInventorySnapshot[];
  if (action === 'cancel-shipment') {
    if (!order.shippedOut || !order.inventorySnapshots?.shipment) block('SHIPMENT_EVIDENCE_MISSING');
    snapshots = [order.inventorySnapshots!.shipment!];
  } else if (order.itemInventory && active.length) {
    snapshots = active.map(state => ({ ...state.production, rawConsumedLots: state.production.rawConsumedLots ?? state.rawConsumedLots }));
  } else {
    const hasInventory = !!order.producedAt || !!order.rawLotsDeducted || !!order.inventorySnapshots?.production
      || !!order.rawConsumedLots?.length || !!order.producedUnits?.length || !!order.autoBuilt?.length
      || !!order.productConsumedLots?.length || !!order.inventorySnapshots?.shipment?.stockDeltas.length;
    if (!hasInventory) snapshots = [];
    else {
      if (!order.inventorySnapshots?.production || !order.producedAt) block('PRODUCTION_EVIDENCE_MISSING');
      if (order.itemInventory && !active.length) block('PRODUCTION_EVIDENCE_MISMATCH');
      snapshots = [{ ...order.inventorySnapshots!.production!, rawConsumedLots: order.inventorySnapshots!.production!.rawConsumedLots ?? order.rawConsumedLots ?? [] }];
    }
  }
  const deltas = new Map<string, number>();
  const traces = snapshots.flatMap(snapshot => snapshot.rawConsumedLots ?? []);
  if (action === 'delete' && snapshots.some((snapshot,index) => (snapshot.rawLedgerIds?.length ?? 0) > 0 && !(snapshot.rawConsumedLots?.length) && !reportingOnlySnapshotIndexes?.has(index))) block('RAW_OPERATION_MISSING');
  for (const snapshot of snapshots) {
    if (!snapshot || !Array.isArray(snapshot.stockDeltas)) block('STOCK_EVIDENCE_MISSING');
    for (const row of snapshot.stockDeltas) {
      if (!row.itemId || !Number.isFinite(row.delta)) block('STOCK_EVIDENCE_INVALID');
      if (action === 'cancel-shipment' && row.delta > 0) block('SHIPMENT_EVIDENCE_INVALID', [row.itemId]);
      deltas.set(row.itemId, (deltas.get(row.itemId) ?? 0) - row.delta);
    }
  }
  const referenceTraces = action === 'delete' ? (active.length ? active.flatMap(state => state.rawConsumedLots) : order.rawConsumedLots ?? []) : [];
  if (referenceTraces.some(trace => !traces.some(saved => saved.operationId === trace.operationId && saved.rawItemId === trace.rawItemId))) block('RAW_TRACE_EVIDENCE_MISMATCH');
  const rawOriginals = new Map<string, string>();
  if (action === 'delete') for (const trace of traces) {
    if (!trace.operationId || !trace.rawItemId) block('RAW_OPERATION_MISSING');
    if (rawOriginals.has(trace.operationId!) && rawOriginals.get(trace.operationId!) !== trace.rawItemId) block('RAW_OPERATION_MISMATCH');
    rawOriginals.set(trace.operationId!, trace.rawItemId!);
  }
  const lotTraces = action === 'cancel-shipment'
    ? order.inventorySnapshots?.shipment?.productConsumedLots ?? order.productConsumedLots ?? [] : snapshots.flatMap(snapshot => snapshot.productConsumedLots ?? []);
  return { recordOnly: false, deltas, rawOriginals, lotTraces, snapshots };
}

/** 현재 수량에서 다른 주문 몫을 보존한다. 과거 동일 실물의 미소진을 증명하는 검사는 아니다. */
export function prepareCancelledItemCore(order: CancellationOrder, item: CancellationItem, delta: number,
  action: CancellationAction, traces: NonNullable<CancellationOrder['productConsumedLots']>, clock:CancellationClock) {
  if (companyOf(item) !== companyOf(order)) block('COMPANY_MISMATCH', [item.id]);
  const stock = Number(item.stock ?? 0);
  if (!Number.isFinite(stock)) block('STOCK_EVIDENCE_INVALID', [item.id]);
  const others = liveItemInventoryReservations(item.inventoryReservations,clock.nowMs()).filter(row => row.orderId !== order.id);
  const reserved = others.reduce((sum, row) => sum + row.qty, 0);
  const next = Math.round((stock + delta) * 1000) / 1000;
  if (delta < 0 && (next < 0 || next < reserved)) block('FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED', [item.id]);
  if (action === 'cancel-shipment' && next < reserved + Math.max(0, delta)) block('FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED', [item.id]);
  const reservations = action === 'cancel-shipment' && delta > 0
    ? [...others, { orderId: order.id, operationId: order.inventoryOperation?.id ?? 'shipment-cancel', qty: delta, state: 'allocated' as const, createdAt: clock.isoNow() }] : others;
  const patch: Record<string, unknown> = { ...(delta !== 0 ? { stock: next } : {}), inventoryReservations: reservations };
  if (action === 'delete' && delta < 0 && (item.lots?.length ?? 0) > 0) {
    const snapshots = order.itemInventory ? Object.values(order.itemInventory).filter(row => row.applied).map(row => row.production)
      : [order.inventorySnapshots?.production];
    const produced = snapshots.flatMap(snapshot => snapshot?.productProducedLots ?? []).filter(row => row.itemId === item.id);
    if (Math.abs(produced.reduce((sum, row) => sum + row.qty, 0) + delta) > 0.000001) block('PRODUCTION_LOT_EVIDENCE_MISSING', [item.id]);
    patch.lots = reverseProductionProductLots(produced)[0]?.apply(item.lots ?? []).lots;
  }
  const takes = traces.filter(trace => trace.itemId === item.id);
  if (action === 'cancel-shipment' || takes.length > 0) {
    if (delta > 0 && (item.lots?.length ?? 0) > 0 && Math.abs(takes.reduce((sum, trace) => sum + trace.qty, 0) - delta) > 0.000001) block('SHIPMENT_LOT_EVIDENCE_MISMATCH', [item.id]);
    for (const trace of takes) if (!trace.lotId || trace.qty <= 0 || !Number.isFinite(trace.qty)
      || !item.lots?.some(lot => lot.id === trace.lotId)) block('SHIPMENT_LOT_EVIDENCE_MISSING', [item.id]);
    if (takes.length) patch.lots = restoreLotsByQty(item.lots ?? [], takes.map(trace => ({ ...trace, lotId: trace.lotId!, supplierName: '' })));
  }
  return patch;
}
