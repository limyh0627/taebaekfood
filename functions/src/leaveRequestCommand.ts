import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  LEAVE_BATCH_OPERATIONS, normalizeLeaveBatchReference, normalizeLeaveBatchRequest,
  normalizeLeaveBatchResult, serializeLeaveBatchRequest, leaveRequestExpected, leaveRequestBusinessIds,
  type LeaveBatchCommand, type LeaveBatchReference, type LeaveBatchRequest, type LeaveBatchResult,
} from './shared/leaveRequestCommand';
import { cleanupValidId } from './shared/partnerItemCleanup';
import {canCancel,leaveStatusPatch} from './shared/leaveStatus';

type Actor = { uid: string; token: Record<string, unknown> };
type Scope = LeaveBatchReference & { actorUid: string };
type Receipt = LeaveBatchResult & { version: 1; requestText: string | null; createdAt: string };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const leaveBatchReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));

function authorize(actor: Actor | undefined): Actor {
  if (!actor) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (!actor.uid || !cleanupValidId(actor.token.employeeId) || !['taebaek','punghoe'].includes(String(actor.token.companyId))) throw new HttpsError('permission-denied', '현재 회사 직원으로 로그인해 주세요.');
  return actor;
}
function result(scope: Scope, status: LeaveBatchResult['status'], requestHash: string | null, requestIds: string[], message: string): LeaveBatchResult {
  return {companyId:scope.companyId,actorUid:scope.actorUid,planId:scope.planId,status,requestHash,requestIds:[...requestIds],message};
}
function receiptResult(snapshot: admin.firestore.DocumentSnapshot, scope: Scope, expectedHash?: string): LeaveBatchResult | null {
  if (!snapshot.exists) return null;
  const receipt = snapshot.data() as Receipt;
  try {
    if (receipt.version !== 1 || !['applied','rejected','cancelled'].includes(receipt.status)) throw Error();
    const response = normalizeLeaveBatchResult({companyId:receipt.companyId,actorUid:receipt.actorUid,planId:receipt.planId,status:receipt.status,requestHash:receipt.requestHash,requestIds:receipt.requestIds,message:receipt.message},scope,scope.actorUid);
    if (receipt.requestHash === null) {
      if (receipt.status !== 'cancelled' || receipt.requestText !== null) throw Error();
    } else {
      if (typeof receipt.requestText !== 'string' || sha(receipt.requestText) !== receipt.requestHash) throw Error();
      const request = normalizeLeaveBatchRequest(JSON.parse(receipt.requestText));
      if (serializeLeaveBatchRequest(request) !== receipt.requestText || request.companyId !== scope.companyId || request.planId !== scope.planId || JSON.stringify(leaveRequestBusinessIds(request)) !== JSON.stringify(receipt.requestIds)) throw Error();
    }
    if (expectedHash !== undefined && receipt.requestHash !== null && receipt.requestHash !== expectedHash) throw new HttpsError('already-exists', '같은 휴가 작업 번호의 최초 내용이 다릅니다. 보관된 요청을 확인해 주세요.');
    return response;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('failed-precondition', '휴가 처리 근거를 확인하지 못했습니다. 최초 요청을 보존해 주세요.');
  }
}

/** 개인 신청과 관리자 단체 부여는 같은 영수증으로 묶어 늦은 재전송도 중복 생성하지 않는다. */
export async function executeLeaveRequestCommand(db: admin.firestore.Firestore, rawActor: Actor | undefined, input: LeaveBatchCommand): Promise<LeaveBatchResult> {
  const actor = authorize(rawActor);
  let request: LeaveBatchRequest | undefined;
  let reference: LeaveBatchReference;
  let text: string | null = null;
  let requestHash: string | undefined;
  try {
    if (!input || typeof input !== 'object' || !['apply','inspect','cancel'].includes(input.mode)) throw Error('휴가 처리 종류를 확인해 주세요.');
    const keys = input.mode === 'apply' ? ['mode','request'] : ['mode','reference','requestHash'];
    if (Object.keys(input).some(key=>!keys.includes(key))) throw Error('휴가 명령 형식을 확인해 주세요.');
    if (input.mode === 'apply') {
      request = normalizeLeaveBatchRequest(input.request);
      reference = {companyId:request.companyId,planId:request.planId};
      text = serializeLeaveBatchRequest(request);
      requestHash = sha(text);
    } else {
      reference = normalizeLeaveBatchReference(input.reference);
      requestHash = input.requestHash;
      if (requestHash !== undefined && (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash))) throw Error('최초 휴가 요청의 해시를 확인해 주세요.');
    }
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '휴가 요청을 확인해 주세요.');
  }
  if (reference.companyId !== actor.token.companyId) throw new HttpsError('permission-denied', '다른 회사의 휴가는 처리할 수 없습니다.');
  if (request?.version === 1 && actor.token.isAdmin !== true && (request.rows.length !== 1 || request.rows[0].status !== 'pending' || request.rows[0].employeeId !== actor.token.employeeId)) throw new HttpsError('permission-denied', '본인의 개인 휴가 신청만 등록할 수 있습니다.');
  if (request?.version === 2 && actor.token.isAdmin !== true && !['request-cancel','request-modify'].includes(request.action)) throw new HttpsError('permission-denied','휴가 결재는 관리자만 처리할 수 있습니다.');
  const scope: Scope = {...reference,actorUid:actor.uid};
  const operationRef = db.collection(LEAVE_BATCH_OPERATIONS).doc(leaveBatchReceiptId(reference.companyId,actor.uid,reference.planId));
  return db.runTransaction(async tx => {
    const existing = receiptResult(await tx.get(operationRef), scope, requestHash);
    if (existing) {
      if (input.mode === 'apply') {
        if (existing.status === 'applied') return {...existing,status:'duplicate' as const};
        if (existing.status === 'cancelled') return {...existing,status:'cancelled' as const,message:'중단한 휴가 요청은 다시 등록하지 않습니다. 새로 작성해 주세요.'};
      }
      return existing;
    }
    if (input.mode === 'inspect') return result(scope,'unknown',null,[],'이 요청의 처리 결과를 확인하지 못했습니다. 자동으로 다시 등록하지 않습니다.');
    const saveReceipt = (response: LeaveBatchResult, requestText: string | null) => {
      tx.create(operationRef,{...response,version:1,requestText,createdAt:new Date().toISOString()} satisfies Receipt);
      return response;
    };
    if (input.mode === 'cancel') return saveReceipt(result(scope,'cancelled',null,[],'이 휴가 요청을 중단했습니다. 늦게 도착한 등록도 막았습니다.'),null);
    if (request!.version === 2) {
      const mutation = request!;
      const targetRef = db.collection('leaveRequests').doc(mutation.targetId);
      const target = await tx.get(targetRef);
      const current = target.data();
      const ids = [mutation.targetId];
      const reject = (message: string) => saveReceipt(result(scope,'rejected',requestHash!,ids,message),text);
      if (!target.exists || !current || (current.companyId ?? 'taebaek') !== scope.companyId) return reject('대상 휴가가 없거나 현재 회사의 휴가가 아닙니다. 다시 조회해 주세요.');
      if (!cleanupValidId(current.employeeId)) return reject('대상 직원의 원문을 확인해 주세요.');
      const targetEmployee = await tx.get(db.collection('employees').doc(current.employeeId));
      if (!targetEmployee.exists || (targetEmployee.data()?.companyId ?? 'taebaek') !== scope.companyId) return reject('현재 회사에 속한 실제 직원인지 확인해 주세요.');
      if (actor.token.isAdmin !== true && current.employeeId !== actor.token.employeeId) throw new HttpsError('permission-denied','본인의 휴가만 변경 신청할 수 있습니다.');
      let currentEvidence: Record<string,unknown>;
      try { currentEvidence = leaveRequestExpected(current); } catch { return reject('현재 휴가 원문을 비교하지 못했습니다. 다시 조회해 주세요.'); }
      if (JSON.stringify(currentEvidence) !== JSON.stringify(mutation.expected)) return reject('휴가 내용이 변경되었습니다. 다시 조회한 뒤 처리해 주세요.');
      const modify = current.modifyRequest as Record<string,unknown> | undefined;
      let patch: Record<string,unknown>;
      switch (mutation.action) {
        case 'approve':
        case 'reject':
          if (current.status !== 'pending') return reject('현재 대기 중인 휴가만 승인·반려할 수 있습니다.');
          patch = leaveStatusPatch(mutation.action === 'approve' ? 'approved' : 'rejected');
          break;
        case 'request-cancel':
          if (current.status !== 'approved') return reject('승인된 휴가만 취소 신청할 수 있습니다.');
          patch = leaveStatusPatch('cancel_pending');
          break;
        case 'cancel': {
          if (!canCancel({status:current.status})) return reject('이미 취소·반려된 휴가는 다시 취소할 수 없습니다.');
          const cancellingEmployee = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
          const cancellingData = cancellingEmployee.data();
          if (!cancellingEmployee.exists || (cancellingData?.companyId ?? 'taebaek') !== scope.companyId || typeof cancellingData?.name !== 'string' || !cancellingData.name.trim()) return reject('취소 처리자의 직원 정보를 확인해 주세요.');
          patch = leaveStatusPatch('cancelled',{id:actor.token.employeeId as string,name:cancellingData.name},mutation.reason);
          break;
        }
        case 'request-modify':
          if (current.status !== 'approved') return reject('승인된 휴가만 변경 신청할 수 있습니다.');
          patch = {modifyRequest:{...mutation.modifyRequest,status:'pending'}};
          break;
        case 'approve-modify':
        case 'reject-modify':
          if (!['approved','cancel_pending'].includes(current.status) || !modify || modify.status !== 'pending') return reject('현재 대기 중인 변경 요청만 승인·반려할 수 있습니다.');
          if (mutation.action === 'approve-modify' && ['startDate','endDate','reason','daysUsed'].some(field => !Object.prototype.hasOwnProperty.call(modify,field))) return reject('변경 요청의 적용할 원문이 부족합니다. 내용을 확인해 주세요.');
          patch = mutation.action === 'approve-modify'
            ? {startDate:modify.startDate,endDate:modify.endDate,reason:modify.reason,daysUsed:modify.daysUsed,modifyRequest:{...modify,status:'approved'}}
            : {modifyRequest:{...modify,status:'rejected'}};
          break;
      }
      tx.update(targetRef,patch);
      return saveReceipt(result(scope,'applied',requestHash!,ids,'휴가 처리를 완료했습니다.'),text);
    }
    const rows = request!.rows;
    // 모든 대상과 기존 휴가를 읽은 뒤에만 첫 쓰기를 만든다. 일부만 등록하는 경로는 없다.
    const employeeRefs = rows.map(row=>db.collection('employees').doc(row.employeeId));
    const leaveRefs = rows.map(row=>db.collection('leaveRequests').doc(row.id));
    const snapshots = await tx.getAll(...employeeRefs,...leaveRefs);
    const employees = snapshots.slice(0,rows.length);
    const leaves = snapshots.slice(rows.length);
    const ids = rows.map(row=>row.id);
    if (employees.some(employee=>!employee.exists || (employee.data()?.companyId ?? 'taebaek') !== scope.companyId)) return saveReceipt(result(scope,'rejected',requestHash!,ids,'현재 회사에 속한 실제 직원인지 확인해 주세요. 휴가는 등록하지 않았습니다.'),text);
    if (leaves.some(leave=>leave.exists)) return saveReceipt(result(scope,'rejected',requestHash!,ids,'같은 번호의 휴가가 이미 있습니다. 기존 휴가를 덮거나 일부만 등록하지 않았습니다.'),text);
    rows.forEach((row,index)=>tx.create(leaveRefs[index],{...row,companyId:scope.companyId}));
    return saveReceipt(result(scope,'applied',requestHash!,ids,'휴가 등록을 완료했습니다.'),text);
  });
}
export const leaveRequestCommand = onCall({region:'asia-northeast3'},request=>executeLeaveRequestCommand(admin.firestore(),request.auth as Actor|undefined,request.data));
