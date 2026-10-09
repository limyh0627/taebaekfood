import type * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { cashOriginalHash } from './cashMutationReceipt';
type Row = Record<string, any>;
function fail(): never { throw new HttpsError('failed-precondition', '전표 원 발행과 변경 감사 사슬이 맞지 않습니다.'); }
/** 기존 수정 감사의 원문 사슬을 검증한다. 현재 전표를 되쓰지 않는다. */
export async function readStatementCreation(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
 companyId: string, statementId: string, current: Row, validatesCreation: (row: Row) => boolean): Promise<Row> {
 const history = await tx.get(db.collection('voucherMutationOperations').where('statementId', '==', statementId));
 const edits = history.docs.map(doc => doc.data()).filter(row => row.action === 'edit-statement')
  .sort((a, b) => a.expectedRevision - b.expectedRevision);
 if (!edits.length) { if ((current.mutationRevision ?? 0) !== 0 || !validatesCreation(current)) fail(); return current; }
 const original = edits[0].beforeSnapshot;
 if (!original || (original.mutationRevision ?? 0) !== 0 || !validatesCreation(original)) fail();
 for (let index = 0; index < edits.length; index++) {
  const row = edits[index], before = row.beforeSnapshot, next = edits[index + 1]?.beforeSnapshot ?? current;
  if (!before || row.companyId !== companyId || row.statementId !== statementId
   || row.kind !== 'issuedStatements' || row.status !== 'applied' || typeof row.uid !== 'string' || !row.uid
   || row.expectedRevision !== index || (before.mutationRevision ?? 0) !== index || row.revision !== index + 1
   || (before.companyId ?? 'taebaek') !== companyId || row.beforeHash !== cashOriginalHash(before)
   || row.afterHash !== cashOriginalHash(next)) fail();
 }
 if (current.mutationRevision !== edits.length) fail();
 return original;
}
