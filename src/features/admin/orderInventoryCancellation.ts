import { doc, getDoc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { readRawCommandInTransaction, prepareRawCommand, writePreparedRawCommand, normalizeRawMovement } from '../../shared/services/rawInventoryService';
import type { RawInventoryState } from '../../shared/rawInventoryCore';
import { cancellationRawCommands } from './orderRawInventory';
import { OrderStatus, companyOf, type Order, type OrderInventorySnapshot, type Item } from '../../shared/types';
import { liveItemInventoryReservations } from './orderItemStock';
import { restoreLotsByQty } from '../../shared/lotUtils';
import { reverseProductionProductLots } from './orderProductLots';

export type CancellationAction = 'cancel-shipment' | 'delete';
export class CancellationBlocked extends Error {
  constructor(public code: string, public affectedItemIds: string[] = []) { super(code); }
}
const block = (code: string, ids: string[] = []): never => { throw new CancellationBlocked(code, ids); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value;

/** 승인한 당시 근거가 바뀌면 화면 확인을 다시 받아야 하므로 표시명/BOM은 포함하지 않는다. */
function validateAction(action: unknown): asserts action is CancellationAction {
  if (action !== 'cancel-shipment' && action !== 'delete') block('CANCELLATION_ACTION_INVALID');
}
export function cancellationEvidence(order: Order, action: CancellationAction): string {
  validateAction(action);
  return JSON.stringify(canonical({ action, id: order.id, companyId: companyOf(order), status: order.status,
    producedAt: order.producedAt ?? '', shippedOut: !!order.shippedOut,
    items: (order.items ?? []).map(row => ({ lineId: row.lineId ?? '', itemId: row.itemId,
      quantity: row.quantity, isBoxUnit: !!row.isBoxUnit, boxQuantity: row.boxQuantity ?? null })),
    inventorySnapshots: order.inventorySnapshots ?? null, itemInventory: order.itemInventory ?? null,
    rawConsumedLots: order.rawConsumedLots ?? [], productConsumedLots: order.productConsumedLots ?? [],
  }));
}

export function planOrderCancellation(order: Order, action: CancellationAction) {
  validateAction(action);
  if (action === 'cancel-shipment' && order.status !== OrderStatus.SHIPPED) block('SHIPMENT_STATUS_CHANGED');
  if (action === 'delete' && order.status === OrderStatus.SHIPPED) block('SHIPMENT_CANCEL_REQUIRED');
  // 배송완료 과거 기록은 재고를 되돌리지 않는 별도 정책이지만 승인·회사·완료표 경계는 공유한다.
  if (action === 'delete' && order.status === OrderStatus.DELIVERED) return {
    recordOnly: true, deltas: new Map<string, number>(), rawOriginals: new Map<string, string>(),
    lotTraces: [] as NonNullable<Order['productConsumedLots']>, snapshots: [] as OrderInventorySnapshot[],
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
  if (action === 'delete' && snapshots.some(snapshot => (snapshot.rawLedgerIds?.length ?? 0) > 0 && !(snapshot.rawConsumedLots?.length))) block('RAW_OPERATION_MISSING');
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
export function prepareCancelledItem(order: Order, item: Item, delta: number,
  action: CancellationAction, traces: NonNullable<Order['productConsumedLots']>) {
  if (companyOf(item) !== companyOf(order)) block('COMPANY_MISMATCH', [item.id]);
  const stock = Number(item.stock ?? 0);
  if (!Number.isFinite(stock)) block('STOCK_EVIDENCE_INVALID', [item.id]);
  const others = liveItemInventoryReservations(item.inventoryReservations).filter(row => row.orderId !== order.id);
  const reserved = others.reduce((sum, row) => sum + row.qty, 0);
  const next = Math.round((stock + delta) * 1000) / 1000;
  if (delta < 0 && (next < 0 || next < reserved)) block('FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED', [item.id]);
  if (action === 'cancel-shipment' && next < reserved + Math.max(0, delta)) block('FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED', [item.id]);
  const reservations = action === 'cancel-shipment' && delta > 0
    ? [...others, { orderId: order.id, operationId: order.inventoryOperation?.id ?? 'shipment-cancel', qty: delta, state: 'allocated' as const, createdAt: new Date().toISOString() }] : others;
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


export interface CancellationTicket {
  orderId: string; companyId: ReturnType<typeof companyOf>; action: CancellationAction;
  evidence: string; operationId: string;
}
interface CancellationReceipt {
  id: string; companyId: ReturnType<typeof companyOf>; orderId: string; state: 'completed';
  cancellation: { action: CancellationAction; evidence: string; deleted: boolean };
}
export interface CancellationResult {
  status: 'completed' | 'blocked' | 'failed'; operationId: string; code?: string;
  affectedItemIds: string[]; inventoryApplied: 'none' | 'complete' | 'unknown'; retryable: boolean;
  deleted: boolean; nextStatus?: OrderStatus;
}
// 보안 토큰이 아니라 승인 근거 비교용 지문이다. 원본 품목/원료 정보를 감사문서에 복제하지 않는다.
async function fingerprint(text: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const receiptRef = (db: Firestore, ticket: CancellationTicket) => doc(db, 'orderStatusAudits', ticket.operationId);
const matchesReceipt = (value: any, ticket: CancellationTicket): value is CancellationReceipt => value?.state === 'completed'
  && value.id === ticket.operationId && value.orderId === ticket.orderId && value.companyId === ticket.companyId
  && value.cancellation?.action === ticket.action && value.cancellation?.evidence === ticket.evidence
  && value.cancellation?.deleted === (ticket.action === 'delete');
const completed = (ticket: CancellationTicket): CancellationResult => ({ status: 'completed', operationId: ticket.operationId,
  affectedItemIds: [], inventoryApplied: 'complete', retryable: false, deleted: ticket.action === 'delete',
  ...(ticket.action === 'cancel-shipment' ? { nextStatus: OrderStatus.DISPATCHED } : {}) });

export async function prepareOrderInventoryCancellation(db: Firestore, orderId: string,
  companyId: ReturnType<typeof companyOf>, action: CancellationAction) {
  validateAction(action);
  const snap = await getDoc(doc(db, 'orders', orderId));
  if (!snap.exists()) block('ORDER_NOT_FOUND');
  const order = { ...snap.data(), id: orderId } as Order;
  if (companyOf(order) !== companyId) block('COMPANY_MISMATCH');
  const plan = planOrderCancellation(order, action);
  const evidence = await fingerprint(cancellationEvidence(order, action));
  const ticket: CancellationTicket = { orderId, companyId, action, evidence,
    operationId: `order-cancellation-${action}-${orderId}-${evidence}` };
  return { order, ticket, recordOnly: plan.recordOnly, adjustments: [...plan.deltas].map(([itemId, delta]) => ({ itemId, delta })),
    rawOperationIds: [...plan.rawOriginals.keys()] };
}

/** 새로고침 뒤 저장한 ticket으로 완료 여부만 조회한다. 없는 주문을 성공으로 간주하지 않는다. */
export async function readOrderCancellationReceipt(db: Firestore, ticket: CancellationTicket): Promise<CancellationResult | null> {
  validateAction(ticket.action);
  const snap = await getDoc(receiptRef(db, ticket));
  if (!snap.exists()) return null;
  if (!matchesReceipt(snap.data(), ticket)) block('CANCELLATION_RECEIPT_MISMATCH');
  return completed(ticket);
}

async function recordCancellationFailure(db: Firestore, ticket: CancellationTicket, code: string) {
  try {
    await runTransaction(db, async tx => {
      const orderRef = doc(db, 'orders', ticket.orderId);
      const [audit, snap] = await Promise.all([tx.get(receiptRef(db, ticket)), tx.get(orderRef)]);
      if (audit.exists() || !snap.exists()) return;
      const order = snap.data() as Order;
      if (companyOf(order) !== ticket.companyId || order.inventoryOperation?.id !== ticket.operationId) return;
      tx.update(orderRef, { inventoryOperation: { ...order.inventoryOperation, state: 'failed', stage: 'final-stock', error: code } });
    });
  } catch { /* 실패 기록의 통신 장애가 최초 실패를 성공으로 바꾸면 안 된다. */ }
}

export async function executeOrderInventoryCancellation(db: Firestore, ticket: CancellationTicket, actorName = '미기록'): Promise<CancellationResult> {
  const orderRef = doc(db, 'orders', ticket.orderId);
  const auditRef = receiptRef(db, ticket);
  try {
    validateAction(ticket.action);
    if (!/^[a-f0-9]{64}$/.test(ticket.evidence) || ticket.operationId !== `order-cancellation-${ticket.action}-${ticket.orderId}-${ticket.evidence}`) block('CANCELLATION_TICKET_INVALID');
    // 일반 상태 변경의 기존 claim도 processing을 차단하므로 탭/기기 사이 충돌을 같은 문서로 막는다.
    const claim = await runTransaction(db, async tx => {
      const [audit, snap] = await Promise.all([tx.get(auditRef), tx.get(orderRef)]);
      if (audit.exists()) {
        if (!matchesReceipt(audit.data(), ticket)) block('CANCELLATION_RECEIPT_MISMATCH');
        return null;
      }
      if (!snap.exists()) block('ORDER_NOT_FOUND');
      const order = { ...snap.data(), id: ticket.orderId } as Order;
      if (companyOf(order) !== ticket.companyId) block('COMPANY_MISMATCH');
      if (await fingerprint(cancellationEvidence(order, ticket.action)) !== ticket.evidence) block('APPROVAL_EVIDENCE_CHANGED');
      planOrderCancellation(order, ticket.action);
      const previous = order.inventoryOperation;
      if (previous && previous.id !== ticket.operationId) block('OTHER_INVENTORY_OPERATION');
      if (previous && previous.targetStatus !== (ticket.action === 'delete' ? OrderStatus.PENDING : OrderStatus.DISPATCHED)) block('OPERATION_MISMATCH');
      if (previous) return previous;
      const operation: NonNullable<Order['inventoryOperation']> = {
        id: ticket.operationId, kind: 'status', targetStatus: ticket.action === 'delete' ? OrderStatus.PENDING : OrderStatus.DISPATCHED,
        state: 'processing', startedAt: new Date().toISOString(), actor: actorName,
      };
      tx.update(orderRef, { inventoryOperation: operation });
      return operation;
    });
    if (!claim) return completed(ticket);

    return await runTransaction(db, async tx => {
      const reads = new Map<string, Promise<any>>();
      const readTx = { get: (ref: any) => {
        if (!reads.has(ref.path)) reads.set(ref.path, tx.get(ref));
        return reads.get(ref.path)!;
      } } as Transaction;
      const [audit, snap] = await Promise.all([readTx.get(auditRef), readTx.get(orderRef)]);
      if (audit.exists()) {
        if (!matchesReceipt(audit.data(), ticket)) block('CANCELLATION_RECEIPT_MISMATCH');
        return completed(ticket);
      }
      if (!snap.exists()) block('ORDER_NOT_FOUND');
      const order = { ...snap.data(), id: ticket.orderId } as Order;
      if (companyOf(order) !== ticket.companyId) block('COMPANY_MISMATCH');
      if (order.inventoryOperation?.id !== ticket.operationId) block('OTHER_INVENTORY_OPERATION');
      if (await fingerprint(cancellationEvidence(order, ticket.action)) !== ticket.evidence) block('APPROVAL_EVIDENCE_CHANGED');
      const plan = planOrderCancellation(order, ticket.action);
      const draftOnly = plan.snapshots.length === 0;
      const ids = plan.recordOnly ? [] : [...new Set([...plan.deltas.keys(), ...plan.lotTraces.map(trace => trace.itemId),
        ...(ticket.action === 'delete' ? order.items.map(line => line.itemId) : [])])];
      const commands = cancellationRawCommands(order, plan.rawOriginals, claim.startedAt, claim.actor);
      // SDK/서버 상한을 뜻하지 않는 앱의 보수적 작업량 예산이다. 분할 취소로 우회하지 않는다.
      if (ids.length + commands.length * 4 + 2 > 200) block('CANCELLATION_TRANSACTION_BUDGET');
      const [items, rawReads] = await Promise.all([
        Promise.all(ids.map(id => readTx.get(doc(db, 'items', id)))),
        Promise.all(commands.map(command => readRawCommandInTransaction(readTx, db, command))),
      ]);
      const patches = new Map<string, Record<string, unknown>>();
      ids.forEach((id, index) => {
        if (!items[index].exists()) { if (draftOnly) return; block('ITEM_NOT_FOUND', [id]); }
        const item = { ...items[index].data(), id } as Item;
        if (draftOnly) {
          if (companyOf(item) !== ticket.companyId) block('COMPANY_MISMATCH', [id]);
          if (liveItemInventoryReservations(item.inventoryReservations).some(row => row.orderId === order.id)) block('RESERVATION_WITHOUT_EVIDENCE', [id]);
          return;
        }
        patches.set(id, prepareCancelledItem(order, item, plan.deltas.get(id) ?? 0, ticket.action, plan.lotTraces));
      });
      const originals = rawReads.map((read, index) => {
        const originalSnap = read.originalSnap?.exists() ? read.originalSnap : read.oldOriginalSnap;
        if (!originalSnap?.exists()) block('RAW_ORIGINAL_NOT_FOUND', [commands[index].rawItemId]);
        const original = normalizeRawMovement(originalSnap!.data()!);
        if (original.source.id !== order.id || !['consume', 'consume-lot', 'ledger-consume'].includes(original.kind)
          || original.companyId !== ticket.companyId || original.rawItemId !== commands[index].rawItemId) block('RAW_ORIGINAL_MISMATCH', [commands[index].rawItemId]);
        const traces = plan.snapshots.flatMap(snapshot => snapshot.rawConsumedLots ?? []).filter(trace => trace.operationId === original.operationId);
        if (Math.abs(traces.reduce((sum, trace) => sum + trace.kg, 0) + original.reportedDeltaKg) > 0.001
          || traces.some(trace => !!trace.ledgerOnly !== (original.kind === 'ledger-consume'))) block('RAW_TRACE_EVIDENCE_MISMATCH', [original.rawItemId]);
        if ((plan.deltas.get(original.rawItemId) ?? 0) !== 0) block('RAW_ITEM_STOCK_OVERLAP', [original.rawItemId]);
        return { read, command: commands[index], original };
      }).sort((a, b) => b.original.sequence - a.original.sequence);
      const virtual = new Map<string, { state: RawInventoryState; itemData: Record<string, any> }>();
      const rawPrepared = originals.map(({ read, command, original }) => {
        const result = prepareRawCommand(command, read, { now: claim.startedAt }, virtual.get(command.rawItemId));
        // 완료receipt 없이 이미 취소된 원본은 기존 부분 처리인지 알 수 없어 자동 복원에 섞지 않는다.
        if (result.status !== 'applied') block(result.status === 'rejected' ? result.code : 'RAW_OPERATION_ALREADY_APPLIED_OR_CONFLICT', [command.rawItemId]);
        if (result.status !== 'applied') throw new Error('도달 불가');
        const itemData = { ...(virtual.get(command.rawItemId)?.itemData ?? read.itemSnap.data()) };
        if (original.kind !== 'ledger-consume') Object.assign(itemData, {
          stock: result.state.stockKg, lots: [...result.state.activeLots, ...result.state.recentDepletedLots],
        });
        virtual.set(command.rawItemId, { state: result.state, itemData });
        return { read, command, result };
      });
      const writes = new Map<string, { ref: any; data?: Record<string, unknown>; method: 'set' | 'update' | 'delete' }>();
      const buffer = {
        set: (ref: any, data: any) => writes.set(ref.path, { ref, data, method: 'set' }),
        update: (ref: any, data: any) => {
          const previous = writes.get(ref.path);
          writes.set(ref.path, { ref, method: previous?.method === 'set' ? 'set' : 'update', data: { ...previous?.data, ...data } });
        },
      } as unknown as Transaction;
      for (const row of rawPrepared) writePreparedRawCommand(buffer, row.command, row.read, row.result, { legacy: { type: 'auto', orderId: order.id, addedBy: claim.actor } });
      for (const [id, patch] of patches) buffer.update(doc(db, 'items', id), patch);
      const now = new Date().toISOString();
      const auditData = { id: ticket.operationId, companyId: ticket.companyId, orderId: order.id, partnerName: order.partnerName ?? '',
        previousStatus: order.status, nextStatus: ticket.action === 'delete' ? OrderStatus.PENDING : OrderStatus.DISPATCHED,
        approvedBy: claim.actor, approvedAt: claim.startedAt, completedAt: now, state: 'completed', legacyEvidenceWarning: false,
        stockAdjustments: [...plan.deltas].map(([itemId, delta]) => ({ itemId, delta, name: itemId, unit: '' })),
        cancellation: { action: ticket.action, evidence: ticket.evidence, deleted: ticket.action === 'delete' },
      };
      buffer.set(auditRef, auditData);
      if (ticket.action === 'delete') writes.set(orderRef.path, { ref: orderRef, method: 'delete' });
      else buffer.update(orderRef, { status: OrderStatus.DISPATCHED, shippedOut: false, productConsumedLots: [], shipmentConfirmedBy: null, shipmentConfirmedAt: null,
        inventorySnapshots: { ...order.inventorySnapshots, shipment: { ...order.inventorySnapshots!.shipment!, stockDeltas: [], productConsumedLots: [] } }, inventoryOperation: null });
      const bytes = new TextEncoder().encode(JSON.stringify([...writes.values()].map(write => ({ path: write.ref.path, data: write.data })))).byteLength;
      const oversizedDocument = [...writes.values()].some(write => write.data && new TextEncoder().encode(JSON.stringify(write.data)).byteLength > 512 * 1024);
      if (writes.size > 200 || bytes > 4 * 1024 * 1024 || oversizedDocument) block('CANCELLATION_TRANSACTION_BUDGET');
      // 모든 검증·읽기·계산이 끝나기 전에는 실제 tx에 write하지 않는다.
      for (const write of writes.values()) {
        if (write.method === 'delete') tx.delete(write.ref);
        else if (write.method === 'set') tx.set(write.ref, write.data!);
        else tx.update(write.ref, write.data! as Record<string, any>);
      }
      return completed(ticket);
    });
  } catch (error) {
    if (error instanceof CancellationBlocked) {
      // 다른 기기의 커밋 사이에 주문 없음이 보일 수 있으므로 완료표를 먼저 다시 확인한다.
      if (error.code !== 'CANCELLATION_RECEIPT_MISMATCH') {
        try { const receipt = await readOrderCancellationReceipt(db, ticket); if (receipt) return receipt; }
        catch (receiptError) {
          if (!(receiptError instanceof CancellationBlocked)) return { status: 'failed', operationId: ticket.operationId,
            code: 'CANCELLATION_RESULT_UNKNOWN', affectedItemIds: [], inventoryApplied: 'unknown', retryable: true, deleted: false };
          error = receiptError;
        }
      }
      const blocked = error as CancellationBlocked;
      await recordCancellationFailure(db, ticket, blocked.code);
      return { status: 'blocked', operationId: ticket.operationId, code: blocked.code, affectedItemIds: blocked.affectedItemIds,
        inventoryApplied: 'none', retryable: blocked.code === 'OTHER_INVENTORY_OPERATION', deleted: false };
    }
    // commit 응답만 잃은 경우 먼저 완료표를 확인한다. 조회마저 실패하면 반영 여부는 unknown이다.
    try { const receipt = await readOrderCancellationReceipt(db, ticket); if (receipt) return receipt; }
    catch { return { status: 'failed', operationId: ticket.operationId, code: 'CANCELLATION_RESULT_UNKNOWN',
      affectedItemIds: [], inventoryApplied: 'unknown', retryable: true, deleted: false }; }
    await recordCancellationFailure(db, ticket, 'CANCELLATION_TRANSACTION_FAILED');
    return { status: 'failed', operationId: ticket.operationId, code: 'CANCELLATION_TRANSACTION_FAILED',
      affectedItemIds: [], inventoryApplied: 'unknown', retryable: true, deleted: false };
  }
}
