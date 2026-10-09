import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { cashOriginalHash, cashMutationHash } from './cashMutationReceipt';
import { planTaxIssue, type TaxIssueScope } from './shared/taxIssue';
type Row = Record<string, any>;
export type TaxIssueInput = { companyId: 'taebaek' | 'punghoe'; operationId: string; statements: Row[]; scope: TaxIssueScope; issuedAt: string };
function fail(message: string): never { throw new HttpsError('failed-precondition', message); }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
// 기존 과거조회 화면의 빈 기본 필드만 맞춘다. 감사에는 실제 저장 원문을 보존한다.
const snapshotHash = (row: Row) => cashOriginalHash({ ...row, items: row.items ?? [], tradeDate: row.tradeDate ?? '', issuedAt: row.issuedAt ?? '' });
/** 외부 신고를 수행하지 않고 발행 확인 표시와 두 서류 기록만 함께 저장한다. */
export async function recordTaxIssue(db: admin.firestore.Firestore, companyId: string, actorId: string, input: TaxIssueInput) {
 if (!actorId || !input || input.companyId !== companyId || !['taebaek', 'punghoe'].includes(companyId)
  || !validId(input.operationId) || !Array.isArray(input.statements) || !input.statements.length || input.statements.length > 100
  || !['all', 'taxable', 'exempt'].includes(input.scope) || typeof input.issuedAt !== 'string' || !Number.isFinite(Date.parse(input.issuedAt))
  || input.statements.some(row => !row || !validId(row.id)) || new Set(input.statements.map(row => row.id)).size !== input.statements.length)
  throw new HttpsError('invalid-argument', '발행 확인 회사·전표·시각을 확인해주세요.');
 const requestHash = cashMutationHash(input), operationRef = db.collection('taxIssueOperations').doc(input.operationId);
 const outcome = await db.runTransaction(async tx => {
  const prior = await tx.get(operationRef);
  if (prior.exists) {
   const receipt = prior.data()!;
   if (receipt.companyId !== companyId || receipt.actorId !== actorId || receipt.operationId !== input.operationId
    || receipt.requestHash !== requestHash || !receipt.command || cashMutationHash(receipt.command) !== requestHash) fail('이전 발행 확인 요청과 원문이 다릅니다.');
   if (receipt.status === 'rejected') {
    if (receipt.failureCode !== 'failed-precondition' || typeof receipt.failureMessage !== 'string' || !receipt.failureMessage) fail('발행 확인 거절 근거가 다릅니다.');
    return { status: 'rejected' as const, failureMessage: receipt.failureMessage };
   }
   if (receipt.status !== 'applied' || !Array.isArray(receipt.statementPatches)) fail('발행 확인 저장 근거가 다릅니다.');
   const expected = planTaxIssue({ ...input, statements: input.statements as any, actorId });
   const expectedPatches = expected.statementPatches.map(patch => ({ ...patch, data: { ...patch.data,
    mutationRevision: (input.statements.find(row => row.id === patch.id)!.mutationRevision ?? 0) + 1 } }));
   if (cashOriginalHash({ patches: receipt.statementPatches }) !== cashOriginalHash({ patches: expectedPatches })) fail('발행 확인 결과 원문이 다릅니다.');
   const records = expected.writes.filter(write => write.collection === 'taxIssueRecords');
   const stored = await Promise.all(records.map(write => tx.get(db.collection(write.collection).doc(write.id))));
   const edits = await Promise.all(expected.statementPatches.map((_, index) => tx.get(db.collection('voucherMutationOperations').doc(`${input.operationId}_tax_${index}`))));
   if (stored.some((row, index) => !row.exists || cashOriginalHash(row.data()!) !== cashOriginalHash(records[index].data))
    || edits.some((row, index) => { const proof = row.data(), original = input.statements.find(statement => statement.id === expected.statementPatches[index].id)!;
     const { id: _id, ...before } = original;
     return !proof || proof.companyId !== companyId || proof.uid !== actorId || proof.taxIssueOperationId !== input.operationId
      || proof.statementId !== original.id || proof.action !== 'edit-statement' || proof.status !== 'applied' || proof.kind !== 'issuedStatements'
      || !proof.beforeSnapshot || snapshotHash(proof.beforeSnapshot) !== snapshotHash(before) || proof.requestHash !== requestHash || proof.expectedRevision !== (before.mutationRevision ?? 0)
      || proof.revision !== proof.expectedRevision + 1 || cashOriginalHash(proof.beforeSnapshot ?? {}) !== proof.beforeHash
      || proof.afterHash !== cashOriginalHash({ ...proof.beforeSnapshot, ...expected.statementPatches[index].data, mutationRevision: proof.revision });
    })) fail('발행 확인 기록과 수정 근거가 다릅니다.');
   return { status: 'duplicate' as const, operationId: input.operationId, companyId, actorId, requestHash, statementPatches: receipt.statementPatches };
  }
  let writesStarted = false;
  try {
   const snapshots = await Promise.all(input.statements.map(row => tx.get(db.collection('issuedStatements').doc(row.id))));
   const fresh = snapshots.map((snapshot, index) => {
    const original = input.statements[index], row = snapshot.data();
    if (!snapshot.exists || !row || (row.companyId ?? 'taebaek') !== companyId || row.type !== '매출'
     || snapshotHash(row) !== snapshotHash(original)) fail('선택한 전표 원문이 변경되었습니다. 다시 확인해주세요.');
    if (!Array.isArray(row.items) || !row.items.length || row.items.some((line: Row) => !Number.isFinite(line.supply) || !Number.isFinite(line.tax))) fail('전표 공급가·세액을 확인해주세요.');
    return { ...row, id: snapshot.id } as Row & { id: string; items: { supply: number; tax: number; isTaxExempt?: boolean }[] };
   });
   const plan = planTaxIssue({ ...input, companyId: input.companyId, statements: fresh, actorId });
   const records = plan.writes.filter(write => write.collection === 'taxIssueRecords');
   if (!records.length) fail('선택한 종류의 발행 품목이 없습니다.');
   if (records.some(write => ![write.data.supply, write.data.tax, write.data.amount].every(value => typeof value === 'number' && Number.isFinite(value)))) fail('전표 공급가·세액 합계를 확인해주세요.');
   const recordSnapshots = await Promise.all(records.map(write => tx.get(db.collection(write.collection).doc(write.id))));
   const editRefs = plan.statementPatches.map((patch, index) => db.collection('voucherMutationOperations').doc(`${input.operationId}_tax_${index}`));
   const editSnapshots = await Promise.all(editRefs.map(ref => tx.get(ref)));
   if (recordSnapshots.some(row => row.exists) || editSnapshots.some(row => row.exists)) fail('기존 발행 기록이 있어 원문 확인이 필요합니다.');
   const edits = plan.statementPatches.map((patch, index) => {
    const before = snapshots.find(row => row.id === patch.id)!.data()!, revision = before.mutationRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1)) fail('전표 수정 버전을 확인해주세요.');
    const after = { ...before, ...patch.data, mutationRevision: revision + 1 };
    return { ref: editRefs[index], statementRef: db.collection('issuedStatements').doc(patch.id), patch: { ...patch.data, mutationRevision: revision + 1 },
     receipt: { statementId: patch.id, uid: actorId, companyId, requestHash, revision: revision + 1, action: 'edit-statement', kind: 'issuedStatements', status: 'applied', expectedRevision: revision,
      beforeSnapshot: before, beforeHash: cashOriginalHash(before), afterHash: cashOriginalHash(after), taxIssueOperationId: input.operationId, createdAt: input.issuedAt } };
   });
   const statementPatches = edits.map(edit => ({ id: edit.statementRef.id, data: edit.patch }));
   writesStarted = true;
   for (const record of records) tx.create(db.collection(record.collection).doc(record.id), record.data);
   for (const edit of edits) { tx.update(edit.statementRef, edit.patch); tx.create(edit.ref, edit.receipt); }
   tx.create(operationRef, { companyId, operationId: input.operationId, actorId, requestHash, command: input, status: 'applied', statementPatches, createdAt: input.issuedAt });
   return { status: 'applied' as const, operationId: input.operationId, companyId, actorId, requestHash, statementPatches };
  } catch (error) {
   if (writesStarted || !(error instanceof HttpsError) || error.code !== 'failed-precondition') throw error;
   tx.create(operationRef, { companyId, operationId: input.operationId, actorId, requestHash, command: input, status: 'rejected', failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString() });
   return { status: 'rejected' as const, failureMessage: error.message };
  }
 });
 if (outcome.status === 'rejected') throw new HttpsError('failed-precondition', outcome.failureMessage, { version: 1, operationStatus: 'rejected', terminalConfirmed: true, financialWrites: false, companyId, operationId: input.operationId, actorId, requestHash });
 return outcome;
}
export const recordTaxIssueCommand = onCall({ region: 'asia-northeast3' }, async request => {
 const companyId = request.auth?.token.companyId;
 if (!request.auth || request.auth.token.isAdmin !== true || typeof request.auth.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(companyId))) throw new HttpsError('permission-denied', '현재 회사 관리자만 발행 확인을 저장할 수 있습니다.');
 return recordTaxIssue(admin.firestore(), String(companyId), request.auth.uid, request.data as TaxIssueInput);
});
