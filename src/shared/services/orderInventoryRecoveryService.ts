import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,db,functions} from '../firebase';
import {requireActiveReleaseId} from '../releaseGate';
import type {CompanyId} from '../types';
export interface OrderInventoryRecoveryResult {status:'ready'|'blocked'|'recovered'|'duplicate';orderId:string;failedOperationId:string;failedStartedAt:string;inventoryApplied:'none'|'unknown'|'complete';reason?:string;failureMessage?:string;targetStatus?:string}
export async function recoverOrderInventoryLock(companyId:CompanyId,action:'inspect'|'recover',orderId:string,failedOperationId:string,failedStartedAt:string,expectedSaved:string|null=null):Promise<OrderInventoryRecoveryResult>{
 await authReady;const user=auth.currentUser;if(!user)throw Error('로그인을 확인한 뒤 다시 처리하세요.');
 const uid=user.uid;const assertActor=()=>{if(auth.currentUser?.uid!==uid)throw Error('로그인 사용자가 변경되어 작업을 중단했습니다.');};
 const token=await user.getIdTokenResult();assertActor();if(token.claims.companyId!==companyId||token.claims.isAdmin!==true)throw Error('현재 회사의 관리자만 작업 잠금을 확인할 수 있습니다.');
 if(!orderId||!failedOperationId||!failedStartedAt)throw Error('주문과 실패 작업번호를 확인하세요.');
 const gate=await getDoc(doc(db,'appMeta','releaseCutover'));assertActor();const releaseId=requireActiveReleaseId(gate.data());
 if(action==='recover') savePendingRecovery({version:1,companyId,uid,orderId,failedOperationId,failedStartedAt,expectedSaved});
 const call=httpsCallable<unknown,OrderInventoryRecoveryResult>(functions,'recoverOrderInventoryLockCommand');
 const {data}=await call({action,orderId,failedOperationId,failedStartedAt,releaseId});assertActor();
 if(!data||data.orderId!==orderId||data.failedOperationId!==failedOperationId||data.failedStartedAt!==failedStartedAt||!['ready','blocked','recovered','duplicate'].includes(data.status)||!['none','unknown','complete'].includes(data.inventoryApplied))throw Error('서버의 작업 확인 결과가 요청과 일치하지 않습니다. 다시 확인하세요.');
 return data;
}
/** 서버가 해당 실패 작업의 복구 완료를 확인했을 때만 그 작업의 취소 원문을 폐기한다. */
export function clearRecoveredOrderCancellation(companyId:CompanyId,uid:string,result:OrderInventoryRecoveryResult,expectedSaved:string|null):boolean{
 if(!['recovered','duplicate'].includes(result.status)||result.inventoryApplied!=='none')return false;
 const key='order-cancellation:'+uid+':'+companyId+':'+result.orderId;const saved=localStorage.getItem(key);if(!saved||saved!==expectedSaved)return false;
 try{const ticket=JSON.parse(saved);if(ticket.companyId!==companyId||ticket.orderId!==result.orderId||ticket.operationId!==result.failedOperationId)return false;
 if(localStorage.getItem(key)!==saved)return false;localStorage.removeItem(key);return true;}catch{return false;}
}

export interface PendingOrderInventoryRecovery {version:1;companyId:CompanyId;uid:string;orderId:string;failedOperationId:string;failedStartedAt:string;expectedSaved:string|null}
const pendingPrefix=(companyId:CompanyId,uid:string)=>'order-inventory-recovery:'+uid+':'+companyId+':';
const pendingKey=(pending:PendingOrderInventoryRecovery)=>pendingPrefix(pending.companyId,pending.uid)+encodeURIComponent(pending.orderId)+':'+encodeURIComponent(pending.failedOperationId)+':'+encodeURIComponent(pending.failedStartedAt);
const changed=()=>window.dispatchEvent(new Event('order-inventory-recovery-pending'));
function savePendingRecovery(pending:PendingOrderInventoryRecovery):void {
 const key=pendingKey(pending),text=JSON.stringify(pending),previous=localStorage.getItem(key);
 if(previous!==null&&previous!==text)throw Error('이전 작업 잠금 해제 요청의 결과부터 확인하세요. 원문을 보존했습니다.');
 localStorage.setItem(key,text);changed();
}
export function readPendingOrderInventoryRecoveries(companyId:CompanyId,uid:string):PendingOrderInventoryRecovery[]{
 const prefix=pendingPrefix(companyId,uid),rows:PendingOrderInventoryRecovery[]=[];
 for(const key of Object.keys(localStorage).filter(key=>key.startsWith(prefix))){try{const p=JSON.parse(localStorage.getItem(key)??'null') as PendingOrderInventoryRecovery;
 if(p?.version===1&&p.companyId===companyId&&p.uid===uid&&typeof p.orderId==='string'&&p.orderId&&typeof p.failedOperationId==='string'&&p.failedOperationId&&typeof p.failedStartedAt==='string'&&p.failedStartedAt&&(p.expectedSaved===null||typeof p.expectedSaved==='string')&&pendingKey(p)===key)rows.push(p);
 }catch{/* 손상된 원문은 임의 삭제하지 않는다. */}}
 return rows;
}
export function clearPendingOrderInventoryRecovery(companyId:CompanyId,uid:string,result:OrderInventoryRecoveryResult,expectedSaved:string|null):boolean{
 if(!['recovered','duplicate'].includes(result.status)||result.inventoryApplied!=='none')return false;
 const p:PendingOrderInventoryRecovery={version:1,companyId,uid,orderId:result.orderId,failedOperationId:result.failedOperationId,failedStartedAt:result.failedStartedAt,expectedSaved};
 const key=pendingKey(p),text=JSON.stringify(p);if(localStorage.getItem(key)!==text)return false;
 localStorage.removeItem(key);changed();return true;
}
