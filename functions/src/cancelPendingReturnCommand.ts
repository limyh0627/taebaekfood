import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { cashOriginalHash } from './cashMutationReceipt';
type Row = Record<string, any>;
type Actor = { uid: string; token: Row } | undefined;
export type PendingReturnCancellationInput = { companyId: 'taebaek' | 'punghoe'; requestId: string;
  operationId: string; expectedRequest: Row; reason?: string };
export type PendingReturnCancellationResult = { status: 'cancelled' | 'duplicate'; requestId: string; operationId: string; requestHash: string };
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
function fail(message: string): never { throw new HttpsError('failed-precondition', message); }
const cancellationBody = (row: Row) => { const {cancellationOperations: _ops, ...body} = row; return body; };
const withoutCancellation = (row: Row) => {
  const { cancelledAt: _at, cancelledBy: _by, cancellationReceipt: _receipt, ...original } = row;
  return cancellationBody(original);
};

/** 접수와 수량 이력을 보존한다. 재고·분개·번호·원전표는 변경하지 않는다. */
export async function cancelPendingReturn(db: admin.firestore.Firestore, actor: Actor,
  input: PendingReturnCancellationInput): Promise<PendingReturnCancellationResult> {
  if (!actor?.uid || actor.token.isAdmin !== true || typeof actor.token.employeeId !== 'string'
      || !['taebaek', 'punghoe'].includes(actor.token.companyId) || actor.token.companyId !== input?.companyId)
    throw new HttpsError('permission-denied', '현재 회사 관리자만 반품 접수를 취소할 수 있습니다.');
  if (!input || Object.keys(input).some(key => !['companyId', 'requestId', 'operationId', 'expectedRequest', 'reason'].includes(key))
      || !validId(input.requestId) || !validId(input.operationId) || !input.expectedRequest
      || Array.isArray(input.expectedRequest) || typeof input.expectedRequest !== 'object'
      || (input.reason !== undefined && typeof input.reason !== 'string')) fail('반품 취소 원문을 확인해주세요.');
  const requestHash = cashOriginalHash(input), ref = db.collection('returnRequests').doc(input.requestId);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.companyId !== input.companyId) fail('반품 접수의 회사를 확인해주세요.');
    const current = snap.data()!, receipt = current.submissionReceipt;
    const audit = (await tx.get(db.collection('returnSubmissionOperations').doc(input.requestId))).data();
    if (!receipt || !audit || receipt.version !== 1 || audit.status !== 'accepted'
        || audit.companyId !== input.companyId || audit.requestId !== input.requestId || receipt.requestId !== input.requestId
        || typeof receipt.actorId !== 'string' || !receipt.actorId || receipt.actorId !== audit.actorId
        || !receipt.request || !audit.request || receipt.requestHash !== audit.requestHash
        || cashOriginalHash(receipt.request) !== receipt.requestHash || cashOriginalHash(audit.request) !== receipt.requestHash)
      fail('원접수 증명이 없는 반품은 처리 내역을 먼저 확인해주세요.');
    if (current.cancellationOperations !== undefined && (!current.cancellationOperations || Array.isArray(current.cancellationOperations) || typeof current.cancellationOperations !== 'object')) fail('반품 취소 이력을 확인해주세요.');
    const rejected = current.cancellationOperations?.[input.operationId];
    if (rejected) {
      if (rejected.status !== 'rejected' || rejected.actorId !== actor.uid || rejected.companyId !== input.companyId || rejected.requestHash !== requestHash || !rejected.command || cashOriginalHash(rejected.command) !== requestHash || typeof rejected.message !== 'string' || !rejected.message) fail('기존 반품 취소 요청의 원문이 다릅니다.');
      return {status: 'rejected' as const, message: rejected.message};
    }
    const prior = current.cancellationReceipt;
    if (prior !== undefined || current.cancelledAt !== undefined || current.cancelledBy !== undefined) {
      const proofBody=withoutCancellation(current), originalQuantities=prior?.command?.expectedRequest?.quantityOperations;
      if (proofBody.quantityOperations !== undefined) {
        if (!proofBody.quantityOperations || Array.isArray(proofBody.quantityOperations) || typeof proofBody.quantityOperations !== 'object') fail('기존 반품 취소와 원문이 다릅니다.');
        for (const [id, value] of Object.entries(proofBody.quantityOperations) as Array<[string,Row]>) {
          if (originalQuantities?.[id] !== undefined) continue;
          if (!value || value.status !== 'rejected' || value.companyId !== input.companyId || typeof value.actorId !== 'string' || !value.actorId
              || value.message !== '취소된 반품 접수는 수량을 수정할 수 없습니다.' || !value.command
              || value.command.companyId !== input.companyId || value.command.requestId !== input.requestId || value.command.operationId !== id
              || cashOriginalHash(value.command) !== value.requestHash) fail('기존 반품 취소와 원문이 다릅니다.');
        }
        proofBody.quantityOperations=Object.fromEntries(Object.entries(proofBody.quantityOperations).filter(([id])=>originalQuantities?.[id]!==undefined));
        if (originalQuantities === undefined) delete proofBody.quantityOperations;
      }
      if (!prior || prior.version !== 1 || prior.status !== 'cancelled'
          || prior.companyId !== input.companyId || prior.requestId !== input.requestId || !validId(prior.operationId)
          || typeof prior.actorId !== 'string' || !prior.actorId || !prior.command
          || prior.command.companyId !== input.companyId || prior.command.requestId !== input.requestId
          || prior.command.operationId !== prior.operationId || !prior.command.expectedRequest
          || cashOriginalHash(prior.command) !== prior.requestHash
          || typeof current.cancelledAt !== 'string' || current.cancelledAt !== prior.createdAt || current.cancelledBy !== prior.actorId
          || prior.beforeHash !== cashOriginalHash(proofBody)
          || prior.beforeHash !== cashOriginalHash(cancellationBody(prior.command.expectedRequest))) fail('기존 반품 취소와 원문이 다릅니다.');
      if (prior.operationId !== input.operationId) {
        const message='이미 취소된 반품 접수입니다.';
        tx.update(ref,{cancellationOperations:{...(current.cancellationOperations??{}),[input.operationId]:{status:'rejected',companyId:input.companyId,actorId:actor.uid,requestHash,command:input,message,createdAt:new Date().toISOString()}}});
        return {status:'rejected' as const,message};
      }
      if (prior.actorId !== actor.uid || prior.requestHash !== requestHash) fail('기존 반품 취소와 원문이 다릅니다.');
      return { status: 'duplicate' as const, requestId: input.requestId, operationId: input.operationId, requestHash };
    }
    try {
    if (current.status !== 'pending' || ['processedAt', 'processedBy', 'returnJournalId', 'returnApplicationId'].some(key => current[key] !== undefined))
      fail('처리 대기 반품만 취소할 수 있습니다.');
    if (cashOriginalHash(cancellationBody(current)) !== cashOriginalHash(cancellationBody(input.expectedRequest))) fail('반품 내용이 변경됐습니다. 다시 확인해주세요.');
    const operations = await tx.get(db.collection('returnOperations').where('companyId', '==', input.companyId).where('returnRequestId', '==', input.requestId));
    const applications = await tx.get(db.collection('returnApplications').where('companyId', '==', input.companyId).where('returnRequestId', '==', input.requestId));
    if (applications.docs.length || operations.docs.some(row => {
      const op = row.data();
      return op.status !== 'rejected' || op.operationId !== row.id || !op.command
        || op.command.returnRequestId !== input.requestId || cashOriginalHash(op.command) !== op.requestHash
        || !['invalid-argument', 'failed-precondition'].includes(op.failureCode)
        || typeof op.createdBy !== 'string' || !op.createdBy || typeof op.failureMessage !== 'string' || !op.failureMessage;
    })) fail('반품 처리 기록이 있어 취소할 수 없습니다.');
    } catch (error) {
      if (!(error instanceof HttpsError) || error.code !== 'failed-precondition') throw error;
      tx.update(ref, {cancellationOperations: {...(current.cancellationOperations ?? {}), [input.operationId]: {status: 'rejected', companyId: input.companyId, actorId: actor.uid, requestHash, command: input, message: error.message, createdAt: new Date().toISOString()}}});
      return {status: 'rejected' as const, message: error.message};
    }
    const createdAt = new Date().toISOString();
    tx.update(ref, { cancelledAt: createdAt, cancelledBy: actor.uid,
      cancellationReceipt: { version: 1, status: 'cancelled', companyId: input.companyId, requestId: input.requestId,
        operationId: input.operationId, actorId: actor.uid, requestHash, command: input,
        beforeHash: cashOriginalHash(cancellationBody(current)), createdAt } });
    return { status: 'cancelled' as const, requestId: input.requestId, operationId: input.operationId, requestHash };
  });
  if (result.status === 'rejected') throw new HttpsError('failed-precondition', result.message, {cancellationRejected: {version: 1, companyId: input.companyId, actorId: actor.uid, requestId: input.requestId, operationId: input.operationId, requestHash, command: input, status: 'rejected', terminalConfirmed: true}});
  return result;
}
export const cancelPendingReturnCommand = onCall({ region: 'asia-northeast3' }, request =>
  cancelPendingReturn(admin.firestore(), request.auth ? { uid: request.auth.uid, token: request.auth.token } : undefined,
    request.data as PendingReturnCancellationInput));
