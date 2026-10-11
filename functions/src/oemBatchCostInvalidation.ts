import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
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
      changed = true;
      const { oemBatchCost: _cost, ...rest } = lot;
      return rest;
    });
    if (changed) writes.push({ ref: item.ref, patch: { lots: next } });
  }
  return writes;
}
export function writeOemCostInvalidation(tx: admin.firestore.Transaction, writes: OemCostInvalidationWrite[]): void {
  for (const write of writes) tx.update(write.ref, write.patch);
}
