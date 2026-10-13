import { advanceInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
import * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {assertReleaseActive,releaseGateRef} from './releaseGate';
import {assessCancellationLockRecovery,cancellationEvidenceText,type CancellationEvidenceOrder} from './shared/orderCancellationEvidence';
type OrderRow=CancellationEvidenceOrder&{inventoryOperation?:{id?:string;state?:string;kind?:string;stage?:string;targetStatus?:string;error?:string;startedAt?:string}|null};
type Input={action:'inspect'|'recover';orderId:string;failedOperationId:string;failedStartedAt:string;releaseId:string};
export type OrderLockRecoveryResult={status:'ready'|'blocked'|'recovered'|'duplicate';orderId:string;failedOperationId:string;failedStartedAt:string;inventoryApplied:'none'|'unknown'|'complete';reason?:string;failureMessage?:string;targetStatus?:string};
const fail=(code:'invalid-argument'|'failed-precondition'|'permission-denied',message:string):never=>{throw new HttpsError(code,message);};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const identity=(companyId:string,input:Input)=>digest(JSON.stringify([companyId,input.orderId,input.failedOperationId,input.failedStartedAt]));
/** 기존 원자 취소만 복구한다. 일반 상태 작업의 원료 job·생산 기록은 분리돼 있어 자동 해제하지 않는다. */
export async function recoverOrderInventoryLock(db:admin.firestore.Firestore,companyId:string,actorId:string,input:Input):Promise<OrderLockRecoveryResult>{
 if(!input||!['inspect','recover'].includes(input.action)||!['taebaek','punghoe'].includes(companyId)
  ||typeof input.orderId!=='string'||!/^[A-Za-z0-9_:-]{1,160}$/.test(input.orderId)
  ||typeof input.failedOperationId!=='string'||!/^[A-Za-z0-9_:-]{1,512}$/.test(input.failedOperationId)
  ||typeof input.failedStartedAt!=='string'||!input.failedStartedAt.trim()||!Number.isFinite(Date.parse(input.failedStartedAt))
  ||typeof input.releaseId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(input.releaseId))fail('invalid-argument','주문 잠금 복구 요청이 잘못되었습니다.');
 const orderRef=db.collection('orders').doc(input.orderId),completionRef=db.collection('orderStatusAudits').doc(input.failedOperationId);
 const recoveryRef=db.collection('orderLockRecoveryOperations').doc('order-unlock-'+identity(companyId,input));
 return db.runTransaction(async tx=>{
  const [gate,orderSnap,completion,recovery]=await Promise.all([tx.get(releaseGateRef(db)),tx.get(orderRef),tx.get(completionRef),tx.get(recoveryRef)]);
  assertReleaseActive(gate,input.releaseId);
  const base={orderId:input.orderId,failedOperationId:input.failedOperationId,failedStartedAt:input.failedStartedAt};
  const order:OrderRow|null=orderSnap.exists?{...orderSnap.data(),id:input.orderId} as OrderRow:null;
  if(order&&(order.companyId??'taebaek')!==companyId)fail('permission-denied','현재 회사의 주문만 복구할 수 있습니다.');
  const operation=order?.inventoryOperation;
  const details={...(typeof operation?.error==='string'?{failureMessage:operation.error}:{}),...(typeof operation?.targetStatus==='string'?{targetStatus:operation.targetStatus}:{})};
  // 과거 복구 영수증이 있어도 원취소 완료표가 생겼다면 다시 미반영이라고 표시하지 않는다.
  if(completion.exists){
   const saved=completion.data()!;
   const matched=saved.id===input.failedOperationId&&saved.orderId===input.orderId&&saved.companyId===companyId&&saved.state==='completed'&&['cancel-shipment','delete'].includes(saved.cancellation?.action)&&saved.cancellation?.evidence===input.failedOperationId.slice(-64);
   return {...base,...details,status:'blocked',inventoryApplied:matched?'complete':'unknown',reason:matched?'COMPLETION_RECEIPT_PRESENT':'COMPLETION_RECEIPT_MISMATCH'};
  }
  if(recovery.exists){
   const saved=recovery.data()!;
   if(saved.companyId!==companyId||saved.orderId!==input.orderId||saved.failedOperationId!==input.failedOperationId||saved.failedStartedAt!==input.failedStartedAt||saved.status!=='recovered'||saved.inventoryApplied!=='none')
    return {...base,status:'blocked',inventoryApplied:'unknown',reason:'RECOVERY_RECEIPT_MISMATCH'};
   if(operation?.id===input.failedOperationId)return {...base,status:'blocked',inventoryApplied:'unknown',reason:operation.startedAt!==input.failedStartedAt?'OPERATION_GENERATION_CHANGED':'RECOVERY_STATE_MISMATCH'};
   return {...base,status:'duplicate',inventoryApplied:'none'};
  }
  if(!order)return {...base,status:'blocked',inventoryApplied:'unknown',reason:'ORDER_NOT_FOUND'};
  if(operation?.id===input.failedOperationId&&operation.startedAt!==input.failedStartedAt)return {...base,...details,status:'blocked',inventoryApplied:'unknown',reason:'OPERATION_GENERATION_CHANGED'};
  const action=operation?.targetStatus==='DISPATCHED'?'cancel-shipment':'delete';
  let evidenceHash:string;
  try{evidenceHash=digest(cancellationEvidenceText(order as CancellationEvidenceOrder,action));}
  catch{return {...base,...details,status:'blocked',inventoryApplied:'unknown',reason:'ORDER_EVIDENCE_INVALID'};}
  const assessment=assessCancellationLockRecovery({order:order,failedOperationId:input.failedOperationId,evidenceHash,completionExists:false});
  if(assessment.status==='blocked')return {...base,...details,status:'blocked',inventoryApplied:assessment.inventoryApplied,reason:assessment.reason};
  if(input.action==='inspect')return {...base,...details,status:'ready',inventoryApplied:'none'};
  // 완료표의 부재와 주문 지문이 같은 TX에 묶여 있으므로 진행 중 취소와 경합하면 재조회해 차단한다.
  tx.update(orderRef,advanceInventoryWriterProtocol(orderSnap.data(),{inventoryOperation:null}));
  tx.create(recoveryRef,{companyId,...base,status:'recovered',inventoryApplied:'none',evidenceHash,action:assessment.action,
   failedOperation:operation,recoveredBy:actorId,recoveredAt:new Date().toISOString()});
  return {...base,...details,status:'recovered',inventoryApplied:'none'};
 });
}
export const recoverOrderInventoryLockCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const companyId=request.auth.token.companyId;
 if(!['taebaek','punghoe'].includes(companyId)||typeof request.auth.token.employeeId!=='string'||!request.auth.token.employeeId.trim())throw new HttpsError('permission-denied','현재 회사 직원만 주문 잠금을 복구할 수 있습니다.');
 return recoverOrderInventoryLock(admin.firestore(),companyId,request.auth.uid,request.data as Input);
});



