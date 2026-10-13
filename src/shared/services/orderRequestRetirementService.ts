import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {requireActiveReleaseId} from '../releaseGate';
import {companyOf,type Order} from '../types';
import {generationFromOrder,sameOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,type OrderInventoryGeneration} from '../orderInventoryGeneration';
import {archiveRetiredOrderRawBatchAttempt,orderRawBatchAttemptKey,readOrderRawBatchAttempt,orderRawBatchOrderEvidence} from '../orderRawBatchAttempt';
import {rawPressText} from '../rawPressAttempt';
export interface OrderRequestRetirementResult {status:'retired'|'duplicate';action:'archived-only'|'allow-new-claim';allowNewClaim:boolean;inventoryApplied:'unknown';requestHash:string;requestText:string;authorizationId:string;retirementId:string;generation:OrderInventoryGeneration}
const hashText=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
const claimKey=(companyId:string,uid:string,orderId:string)=>`order-retirement-first-claim:${encodeURIComponent(uid)}:${companyId}:${encodeURIComponent(orderId)}`;
/** 응답 유실로 서버 pending이 내려갔어도 같은 최초 명세를 다시 확인한다. */
export function hasRetainedRetirementClaim(orderId:string,companyId:string,actorUid:string,retirementId?:string):boolean{
 if(typeof localStorage==='undefined'||!orderId||!actorUid||!['taebaek','punghoe'].includes(companyId))return false;
 const encoded=localStorage.getItem(claimKey(companyId,actorUid,orderId));if(encoded===null)return false;
 try{const stored=JSON.parse(encoded),request=JSON.parse(stored.requestText);return retirementId===undefined||request.retirementId===retirementId;}
 catch{return true;}
}
export async function claimRetiredOrderInventoryOperation(orderId:string,expectedStatus:Order['status'],operation:NonNullable<Order['inventoryOperation']>):Promise<Order>{
 const {auth,authReady,db,functions}=await import('../firebase');
 await authReady;const user=auth.currentUser;if(!user)throw Error('첫 재고 작업은 직원 로그인이 필요합니다.');const uid=user.uid;
 const token=await user.getIdTokenResult(),companyId=token.claims.companyId;
 if(auth.currentUser?.uid!==uid||!['taebaek','punghoe'].includes(String(companyId))||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim()||operation.actorUid!==uid||operation.contractVersion!==1||operation.productionRecordContractVersion!==1)throw Error('첫 재고 작업의 회사·최초 계정을 확인해 주세요.');
 const key=claimKey(String(companyId),uid,orderId),original=localStorage.getItem(key);
 const assertCurrent=(encoded:string|null)=>{if(auth.currentUser?.uid!==uid||localStorage.getItem(key)!==encoded)throw Error('첫 재고 claim 원문이나 로그인 계정이 바뀌었습니다. 원문을 보존했습니다.');};
 let requestText:string,requestHash:string,encoded:string,request:any;
 if(original!==null){
  try{const stored=JSON.parse(original);requestText=stored.requestText;requestHash=stored.requestHash;request=JSON.parse(requestText);if(stored.version!==1||rawPressText(request)!==requestText||requestHash!==await hashText(requestText)||request.companyId!==companyId||request.actorUid!==uid||request.orderId!==orderId||request.expectedStatus!==expectedStatus||request.operation.kind!==operation.kind||request.operation.lineId!==operation.lineId||request.operation.targetStatus!==operation.targetStatus)throw Error();}
  catch{throw Error('저장된 첫 재고 claim 명세가 다릅니다. 최초 원문을 보존했습니다.');}
  encoded=original;assertCurrent(encoded);
 }else{
  const snapshot=await getDoc(doc(db,'orders',orderId));assertCurrent(null);if(!snapshot.exists())throw Error('주문을 찾을 수 없습니다.');
  const live={...snapshot.data(),id:orderId} as Order&{retirementId?:string;retirementClaimPending?:boolean};
  if(live.companyId!==companyId||live.retirementClaimPending!==true||!live.retirementId||live.inventoryOperation!=null||live.inventoryGenerationCompletion||live.status!==expectedStatus)throw Error('퇴역 뒤 첫 claim의 현재 주문 원문을 확인해 주세요.');
  request=JSON.parse(rawPressText({version:1,retirementId:live.retirementId,companyId,actorUid:uid,orderId,expectedStatus,orderText:orderRawBatchOrderEvidence(live),operation}));
  requestText=rawPressText(request);requestHash=await hashText(requestText);assertCurrent(null);
  encoded=JSON.stringify({version:1,requestText,requestHash});localStorage.setItem(key,encoded);assertCurrent(encoded);
 }
 const gate=await getDoc(doc(db,'appMeta','releaseCutover'));assertCurrent(encoded);const releaseId=requireActiveReleaseId(gate.data());
 const currentToken=await user.getIdTokenResult();assertCurrent(encoded);if(currentToken.claims.companyId!==companyId||typeof currentToken.claims.employeeId!=='string'||!currentToken.claims.employeeId.trim())throw Error('첫 claim의 회사 직원 계정이 바뀌었습니다. 원문을 보존했습니다.');
 const call=httpsCallable<unknown,{status:string;retirementId:string;requestText:string;requestHash:string;generation:OrderInventoryGeneration;order:Order}>(functions,'claimRetiredOrderInventoryOperationCommand');
 const {data}=await call({requestText,requestHash,releaseId});assertCurrent(encoded);
 const g={contractVersion:1 as const,companyId:companyId as OrderInventoryGeneration['companyId'],orderId,operationId:request.operation.id,startedAt:request.operation.startedAt,actorUid:uid};
 const live=data?.order as Order&{retirementId?:string;retirementClaimPending?:boolean};
 if(!data||!['claimed','duplicate'].includes(data.status)||data.requestText!==requestText||data.requestHash!==requestHash||data.retirementId!==request.retirementId||!sameOrderInventoryGeneration(data.generation,g)||!live||live.id!==orderId||live.companyId!==companyId||live.retirementId!==request.retirementId||live.retirementClaimPending!==false||!(sameOrderInventoryGeneration(generationFromOrder(live),g)||hasOrderInventoryGenerationCompletion(live,g)))throw Error('서버 첫 claim 결과가 최초 명세와 다릅니다. 원문을 보존했습니다.');
 assertCurrent(encoded);localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw Error('첫 claim의 정확한 정리를 확인하지 못했습니다.');
 return live;
}
/** claim보다 먼저 확인한다. 무승인 옛 요청은 새 실패 잠금을 만들지 않고 그대로 보존한다. */
export async function retireRetainedOrderRequestBeforeClaim(order:Order):Promise<void|'archived-only'>{
 const companyId=companyOf(order),suffix=':'+companyId+':'+encodeURIComponent(order.id);
 if(typeof localStorage==='undefined'||!Object.keys(localStorage).some(key=>key.startsWith('order-raw-batch:')&&key.endsWith(suffix)))return;
 // 보관할 사본이 없는 일반 재고 작업은 Firebase runtime을 새로 초기화하지 않는다.
 const {auth,authReady,db,functions}=await import('../firebase');
 await authReady;const user=auth.currentUser;
 if(!user)throw Error('최초 주문 요청을 확인하려면 로그인해 주세요.');
 const uid=user.uid,first=readOrderRawBatchAttempt(companyId,uid,order.id);
 if(!first)return;
 const g=first.request.generation;
 const assertActor=()=>{if(auth.currentUser?.uid!==uid||localStorage.getItem(orderRawBatchAttemptKey(companyId,uid,order.id))!==first.encoded)throw Error('로그인이나 최초 주문 요청이 바뀌었습니다. 원문을 보존했습니다.');};
 assertActor();
 if(sameOrderInventoryGeneration(generationFromOrder(order),g)||hasOrderInventoryGenerationCompletion(order,g))return;
 const token=await user.getIdTokenResult();assertActor();if(token.claims.companyId!==companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('최초 요청의 회사 직원 로그인을 확인해 주세요.');
 const requestText=rawPressText(first.request),requestHash=await hashText(requestText);assertActor();
 const gate=await getDoc(doc(db,'appMeta','releaseCutover'));assertActor();const releaseId=requireActiveReleaseId(gate.data());
 const call=httpsCallable<unknown,OrderRequestRetirementResult>(functions,'retireOrderRequestCommand');
 const {data}=await call({requestText,requestHash,releaseId});assertActor();
 if(!data||data.requestHash!==requestHash||data.requestText!==requestText||data.authorizationId!==data.retirementId||!['archived-only','allow-new-claim'].includes(data.action)||data.allowNewClaim!==(data.action==='allow-new-claim')||data.action==='allow-new-claim'&&(order.inventoryOperation!=null||order.inventoryGenerationCompletion))throw Error('서버의 최초 요청 보관 결과가 다릅니다. 원문을 보존했습니다.');
 archiveRetiredOrderRawBatchAttempt(first.request,first.encoded,data); 
 if(data.action==='archived-only')return 'archived-only';
}
