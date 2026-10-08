import type * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
type Row = Record<string, any>;
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value.toMillis === 'function') return { timestampMillis: value.toMillis() };
  if (value instanceof Date) return { dateISO: value.toISOString() };
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
export const cashMutationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const cashOriginalHash = (row: Row) => cashMutationHash(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')));
function fail(): never { throw new HttpsError('failed-precondition', '원 발행 증거와 현금 변경 감사 사슬이 맞지 않습니다.'); }
/** Validates every revision. A committed mutation never authorizes re-creating its deleted cash. */
export async function readCashCreationMutation(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  companyId: string, cashId: string, current: admin.firestore.DocumentSnapshot,
  validatesCreation: (row: Row) => boolean): Promise<Row | null> {
  const rows = await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds', 'array-contains', cashId));
  if (!rows.docs.length) return null;
  const history = rows.docs.map(doc => {
    const receipt = doc.data();
    const before = receipt.transferOperationId ? receipt.transferBeforeSnapshots?.[cashId] : receipt.beforeSnapshot;
    const afterHash = receipt.transferOperationId ? receipt.transferAfterHashes?.[cashId] ?? null : receipt.afterHash;
    if (receipt.transferOperationId) {
      const snapshots = receipt.transferBeforeSnapshots;
      const ids = receipt.cashEntryIds;
      if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2 || !ids.includes(cashId)
        || !snapshots || Object.keys(snapshots).length !== 2
        || new Set(ids.map((id: string) => snapshots[id]?.companyId)).size !== 2
        || ids.some((id: string) => !['taebaek', 'punghoe'].includes(snapshots[id]?.companyId)
          || snapshots[id]?.transferOperationId !== receipt.transferOperationId
          || !Number.isSafeInteger(snapshots[id]?.mutationRevision ?? 0)
          || (snapshots[id]?.mutationRevision ?? 0) < 0
          || (receipt.action === 'edit' ? !/^[a-f0-9]{64}$/.test(receipt.transferAfterHashes?.[id] ?? '')
            : receipt.transferAfterHashes?.[id] !== null))) fail();
    }
    if (receipt.kind !== 'cashEntries' || receipt.status !== 'applied' || !['edit', 'delete'].includes(receipt.action)
      || typeof receipt.createdBy !== 'string' || !receipt.createdBy || !before || (before.companyId ?? 'taebaek') !== companyId
      || !Number.isSafeInteger(before.mutationRevision ?? 0) || (before.mutationRevision ?? 0) < 0
      || (!receipt.transferOperationId && (receipt.companyId !== companyId || receipt.voucherId !== cashId
        || receipt.expectedRevision !== (before.mutationRevision ?? 0) || receipt.beforeHash !== cashOriginalHash(before)))
      || (receipt.action === 'edit' ? typeof afterHash !== 'string' || !/^[a-f0-9]{64}$/.test(afterHash) : afterHash !== null)) fail();
    return { receipt, before, afterHash, revision: before.mutationRevision ?? 0 };
  }).sort((a, b) => a.revision - b.revision);
  const original = history[0].before;
  if (history[0].revision !== 0 || !validatesCreation(original)) fail();
  for (let index = 1; index < history.length; index++) {
    if (history[index - 1].receipt.action === 'delete' || history[index].revision !== history[index - 1].revision + 1
      || cashOriginalHash(history[index].before) !== history[index - 1].afterHash) fail();
  }
  const last = history[history.length - 1];
  if (last.receipt.action === 'delete') { if (current.exists) fail(); }
  else if (!current.exists || (current.data()?.mutationRevision ?? 0) !== last.revision + 1
    || cashOriginalHash(current.data()!) !== last.afterHash) fail();
  return original;
}
