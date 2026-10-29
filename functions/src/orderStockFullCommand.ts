import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {executePrivateOrderStockFullDelegated} from './shared/orderStockFullCommand';
import {normalizePublicOrderStockRecoveryRequest,normalizePublicOrderStockRecoveryResult,type PublicOrderStockRecoveryRequest,type PublicOrderStockRecoveryResult,type PublicOrderStockRecoveryReason,type PublicOrderStockRecoveryState} from './shared/orderStockPublicContract';
import type {ReservationPreviewActor,ReservationPreviewClock} from './shared/orderStockExecutionPlan';

function requestOf(input:unknown):PublicOrderStockRecoveryRequest {
 try{return normalizePublicOrderStockRecoveryRequest(input);}catch{throw new HttpsError('invalid-argument','주문 처리 요청의 참조와 처리 종류를 확인해 주세요.');}
}
function unconfirmed(request:PublicOrderStockRecoveryRequest):PublicOrderStockRecoveryResult {
 return normalizePublicOrderStockRecoveryResult({version:1,reference:request.reference,originalOwnerUid:request.originalOwnerUid,state:'needs-review',canCancel:false,reason:'request-unconfirmed',duplicate:false},requestContext(request));
}
function requestContext(request:PublicOrderStockRecoveryRequest){return {reference:request.reference,originalOwnerUid:request.originalOwnerUid};}
function publicReason(reason:string|undefined):PublicOrderStockRecoveryReason {
 switch(reason){case 'permission-denied':return 'permission-denied';case 'current-evidence-changed':case 'current-evidence-conflict':case 'audit-conflict':case 'delegated-cancel-audit-conflict':return 'current-state-changed';default:return 'source-unproven';}
}

/** 원 요청의 처리 기록은 내부 원본만 판단하고 공개 응답에는 최소 복구 상태만 남긴다. */
export async function executeOrderStockFullRecovery(db:admin.firestore.Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,fixedClock:ReservationPreviewClock):Promise<PublicOrderStockRecoveryResult>{
 if(!actor||typeof actor.uid!=='string'||!actor.uid)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const request=requestOf(input);
 try{
  const result=await executePrivateOrderStockFullDelegated(db,actor,{mode:request.mode,reference:request.reference,originalOwnerUid:request.originalOwnerUid},fixedClock);
  let state:PublicOrderStockRecoveryState='needs-review',reason:PublicOrderStockRecoveryReason='request-unconfirmed',canCancel=false;
  switch(result.status){
   case 'reserved':state='reserved';canCancel=result.canCancel===true;reason=canCancel?'none':publicReason(result.reason);break;
   case 'applied':case 'cancelled':state=result.status;reason='none';break;
   case 'missing-unknown':state='not-found-unconfirmed';break;
   case 'blocked':case 'conflict':reason=publicReason(result.reason);break;
   case 'unknown':break;
  }
  return normalizePublicOrderStockRecoveryResult({version:1,reference:request.reference,originalOwnerUid:request.originalOwnerUid,state,canCancel,reason,duplicate:result.duplicate===true},requestContext(request));
 }catch{return unconfirmed(request);}
}

export const orderStockFullRecoveryCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth||typeof request.auth.uid!=='string'||!request.auth.uid)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const input=requestOf(request.data);
 try{const now=new Date();return await executeOrderStockFullRecovery(admin.firestore(),{uid:request.auth.uid,token:request.auth.token},input,{now:now.toISOString(),nowMs:now.getTime()});}catch{return unconfirmed(input);}
});
