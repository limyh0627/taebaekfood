import { preserveInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { inventoryDocId } from './shared/rawInventoryCore';
import { isDeepStrictEqual } from 'node:util';
type Row = Record<string, any>;
export type OemCostInvalidationWrite = { ref: admin.firestore.DocumentReference; patch: Row };
/** 가공비 전표의 수정·삭제는 수량을 유지하고 원가 확정 근거만 같은 거래에서 무효화한다. */
export async function readOemCostInvalidation(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  companyId: string, statementId: string, reason: 'fee-changed' | 'fee-deleted'): Promise<OemCostInvalidationWrite[]> {
  if (!statementId.startsWith('OEMFEE-')) return [];
  const poId = statementId.slice('OEMFEE-'.length);
  if (!poId || poId.includes('/')) return [];
  const [linked, original] = await Promise.all([
    tx.get(db.collection('purchaseOrders').where('linkedStatementId', '==', statementId)),
    tx.get(db.collection('purchaseOrders').doc(poId)),
  ]);
  const candidates: admin.firestore.DocumentSnapshot[] = [...linked.docs];
  if (original.exists && !candidates.some(po => po.id === original.id)) candidates.push(original);
  const orders = candidates.filter(po => {
    const row = po.data()!;
    return row.companyId === companyId && row.poType === 'oem'
      && (row.oemBatchCost?.feeStatementId === statementId || row.oemBatchCost?.previousConfirmed?.feeStatementId === statementId);
  });
  const itemIds = [...new Set(orders.flatMap(po => {
    const cost = po.data()!.oemBatchCost as Row;
    const confirmed = cost.status === 'confirmed' ? cost : cost.previousConfirmed;
    return (confirmed?.allocations ?? []).map((row: Row) => row.itemId);
  }))] as string[];
  if (orders.length + itemIds.length > 400 || itemIds.some(id => typeof id !== 'string' || !id || id.includes('/'))) {
    throw new HttpsError('failed-precondition', 'OEM 원가 연결 품목을 확인해 주세요.');
  }
  const items = await Promise.all(itemIds.map(id => tx.get(db.collection('items').doc(id))));
  const bulkLinks = orders.flatMap(po => {
    const cost = po.data()!.oemBatchCost as Row;
    const confirmed = cost.status === 'confirmed' ? cost : cost.previousConfirmed;
    return (confirmed?.allocations ?? []).filter((row: Row) => row.kind === 'bulk').map((row: Row) => ({ po, allocation: row }));
  });
  const rawIds = [...new Set(bulkLinks.map(({ allocation }) => allocation.rawItemId))] as string[];
  if (rawIds.some(id => typeof id !== 'string' || !id || id.includes('/')) || orders.length + itemIds.length + rawIds.length > 400) {
    throw new HttpsError('failed-precondition', 'OEM 벌크 원가 연결 원료를 확인해 주세요.');
  }
  const states = await Promise.all(rawIds.map(id => tx.get(db.collection('rawInventories').doc(inventoryDocId(companyId as 'taebaek' | 'punghoe', id)))));
  for (const { po, allocation } of bulkLinks) {
    const item = items.find(item => item.id === allocation.rawItemId);
    const state = states.find(state => state.id === inventoryDocId(companyId as 'taebaek' | 'punghoe', allocation.rawItemId));
    const saved = po.data()!.oemReceivedBulk?.filter((row: Row) => row.rawItemId === allocation.rawItemId && row.lotId === allocation.lotId);
    if (allocation.itemId !== allocation.rawItemId || typeof allocation.lotId !== 'string' || !allocation.lotId
      || !saved || saved.length !== 1 || saved[0].kg !== allocation.kg || !item?.exists || !state?.exists
      || item.data()!.companyId !== companyId || state.data()!.companyId !== companyId || state.data()!.rawItemId !== allocation.rawItemId
      || !Array.isArray(item.data()!.lots) || !Array.isArray(state.data()!.activeLots) || !Array.isArray(state.data()!.recentDepletedLots)) {
      throw new HttpsError('failed-precondition', 'OEM 벌크 원가의 입고 원문과 원료 상태를 확인해 주세요.');
    }
    const itemLots = item.data()!.lots.filter((lot: Row) => lot.id === allocation.lotId);
    const stateLots = [...state.data()!.activeLots, ...state.data()!.recentDepletedLots].filter((lot: Row) => lot.id === allocation.lotId);
    if (itemLots.length !== stateLots.length || itemLots.length > 1 || !isDeepStrictEqual(itemLots, stateLots)
      || itemLots.some((lot: Row) => lot.poId !== po.id || lot.kgIn !== allocation.kg
        || lot.oemBatchCost && (lot.oemBatchCost.poId !== po.id || lot.oemBatchCost.feeStatementId !== statementId))
      || saved[0].appliedDeltaKg === 0 && itemLots.length > 0) {
      throw new HttpsError('failed-precondition', 'OEM 벌크 원가의 연결 로트 원문이 다릅니다.');
    }
  }
  const writes: OemCostInvalidationWrite[] = orders.map(po => {
    const cost = po.data()!.oemBatchCost as Row;
    return { ref: po.ref, patch: { oemBatchCost: { ...cost, status: 'blocked', reason,
      previousConfirmed: cost.status === 'confirmed' ? cost : cost.previousConfirmed } } };
  });
  const orderIds = new Set(orders.map(po => po.id));
  for (const item of items) {
    if (!item.exists || item.data()!.companyId !== companyId) {
      throw new HttpsError('failed-precondition', 'OEM 원가 연결 품목의 회사를 확인해 주세요.');
    }
    const lots = item.data()!.lots;
    if (!Array.isArray(lots)) continue;
    let changed = false;
    const next = lots.map((lot: Row) => {
      if (!lot.oemBatchCost || lot.oemBatchCost.feeStatementId !== statementId
        || !orderIds.has(lot.oemBatchCost.poId)) return lot;
      if (bulkLinks.some(({ allocation }) => allocation.rawItemId === item.id)
        && !bulkLinks.some(({ po, allocation }) => allocation.rawItemId === item.id && allocation.lotId === lot.id && po.id === lot.oemBatchCost.poId)) return lot;
      changed = true;
      const { oemBatchCost: _cost, ...rest } = lot;
      return rest;
    });
    if (changed) writes.push({ ref: item.ref, patch: preserveInventoryWriterProtocol(item.data(),{ lots: next }) });
  }
  for (const state of states) {
    const patch: Row = {};
    for (const field of ['activeLots', 'recentDepletedLots']) {
      let changed = false;
      const next = state.data()![field].map((lot: Row) => {
        if (!bulkLinks.some(({ po, allocation }) => allocation.rawItemId === state.data()!.rawItemId
          && allocation.lotId === lot.id && po.id === lot.oemBatchCost?.poId && lot.oemBatchCost?.feeStatementId === statementId)) return lot;
        changed = true;
        const { oemBatchCost: _cost, ...rest } = lot;
        return rest;
      });
      if (changed) patch[field] = next;
    }
    if (Object.keys(patch).length) writes.push({ ref: state.ref, patch: preserveInventoryWriterProtocol(state.data(), patch) });
  }
  return writes;
}
export function writeOemCostInvalidation(tx: admin.firestore.Transaction, writes: OemCostInvalidationWrite[]): void {
  for (const write of writes) tx.update(write.ref, write.patch);
}
