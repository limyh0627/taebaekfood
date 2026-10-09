import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {cashOriginalHash} from './cashMutationReceipt';
import {pendingReturnQuantityPatch,type ReturnQuantityUpdate} from './shared/pendingReturnQuantity';
import {ReturnValidationError} from './returnValidationError';
import {planStandaloneReturn} from './returnReversalPlan';
type Row=Record<string,any>;
export type PendingReturnQuantityInput={companyId:'taebaek'|'punghoe';requestId:string;operationId:string;updates:ReturnQuantityUpdate[]};
type Actor={uid:string;token:Row}|undefined;
const validId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
function fail(message:string):never{throw new HttpsError('failed-precondition',message);}
export async function updatePendingReturnQuantity(db:admin.firestore.Firestore,actor:Actor,input:PendingReturnQuantityInput):Promise<{status:'updated'|'duplicate';operationId:string;requestId:string;requestHash:string}>{
 if(!actor?.uid||actor.token.isAdmin!==true||!['taebaek','punghoe'].includes(actor.token.companyId)||actor.token.companyId!==input?.companyId)throw new HttpsError('permission-denied','현재 회사 관리자만 반품 수량을 수정할 수 있습니다.');
 if(Object.keys(input).some(key=>!['companyId','requestId','operationId','updates'].includes(key))||!validId(input.requestId)||!validId(input.operationId)||!Array.isArray(input.updates)||input.updates.some(row=>!row||!validId(row.itemId)||!Number.isFinite(row.previousQuantity)||!Number.isFinite(row.quantity)))fail('반품 수량 요청을 확인해주세요.');
 const requestHash=cashOriginalHash(input),ref=db.collection('returnRequests').doc(input.requestId);
 const result=await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)fail('대상 기록을 찾을 수 없습니다.');const current=snap.data()!;
  if((current.companyId??'taebaek')!==input.companyId)fail('다른 회사의 기록은 수정할 수 없습니다.');
  const submissionAudit=await tx.get(db.collection('returnSubmissionOperations').doc(input.requestId));
  const receipt=current.submissionReceipt;
  if(receipt||submissionAudit.exists){const audit=submissionAudit.data();if(!receipt||!audit||audit.status!=='accepted'||audit.companyId!==input.companyId||audit.requestId!==input.requestId||receipt.version!==1||receipt.requestId!==input.requestId||receipt.actorId!==audit.actorId||typeof receipt.actorId!=='string'||!receipt.actorId||!receipt.request||!audit.request||receipt.requestHash!==audit.requestHash||cashOriginalHash(receipt.request)!==receipt.requestHash||cashOriginalHash(audit.request)!==receipt.requestHash)fail('원접수 증명을 확인해주세요.');}
  if(current.quantityOperations!==undefined&&(!current.quantityOperations||Array.isArray(current.quantityOperations)||typeof current.quantityOperations!=='object'))fail('반품 수량 수정 이력을 확인해주세요.');
  const previous=current.quantityOperations?.[input.operationId];
  if(previous){if(previous.actorId!==actor.uid||previous.companyId!==input.companyId||previous.requestHash!==requestHash||!previous.command||cashOriginalHash(previous.command)!==requestHash||!['updated','rejected'].includes(previous.status))fail('같은 수량 수정 요청의 원문이 다릅니다.');if(previous.status==='rejected'){if(typeof previous.message!=='string'||!previous.message)fail('기존 거절 증명을 확인해주세요.');return {status:'rejected' as const,message:previous.message};}return {status:'duplicate' as const,operationId:input.operationId,requestId:input.requestId,requestHash};}
  let patch:ReturnType<typeof pendingReturnQuantityPatch>;
  try{if(current.cancelledAt!==undefined||current.cancelledBy!==undefined||current.cancellationReceipt!==undefined)throw new ReturnValidationError('취소된 반품 접수는 수량을 수정할 수 없습니다.');patch=pendingReturnQuantityPatch(current,input.updates,input.companyId);if(!current.linkedStatementId)planStandaloneReturn({...current,...patch} as Parameters<typeof planStandaloneReturn>[0]);}
  catch(error){if(!(error instanceof ReturnValidationError))throw error;tx.update(ref,{quantityOperations:{...(current.quantityOperations??{}),[input.operationId]:{companyId:input.companyId,actorId:actor.uid,status:'rejected',requestHash,command:input,message:error.message,createdAt:new Date().toISOString()}}});return {status:'rejected' as const,message:error.message};}
  const revision=current.quantityRevision??0;if(!Number.isSafeInteger(revision)||revision<0)fail('반품 수량 수정 이력을 확인해주세요.');
  tx.update(ref,{...patch,quantityRevision:revision+1,quantityOperations:{...(current.quantityOperations??{}),[input.operationId]:{companyId:input.companyId,actorId:actor.uid,status:'updated',requestHash,command:input,beforeHash:cashOriginalHash({items:current.items,totalAmount:current.totalAmount}),afterHash:cashOriginalHash(patch),revision:revision+1,createdAt:new Date().toISOString()}}});
  return {status:'updated' as const,operationId:input.operationId,requestId:input.requestId,requestHash};
 });
 if(result.status==='rejected')throw new HttpsError('failed-precondition',result.message,{quantityRejected:{version:1,companyId:input.companyId,actorId:actor.uid,requestId:input.requestId,operationId:input.operationId,requestHash,command:input,status:'rejected',terminalConfirmed:true}});
 return result;
}
export const updatePendingReturnQuantityCommand=onCall({region:'asia-northeast3'},request=>updatePendingReturnQuantity(admin.firestore(),request.auth?{uid:request.auth.uid,token:request.auth.token}:undefined,request.data as PendingReturnQuantityInput));
