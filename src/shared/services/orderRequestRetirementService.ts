import type {InventoryNewSendGuard} from '../hooks/useInventoryReferenceGuard';
import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {requireActiveReleaseId} from '../releaseGate';
import {companyOf,type Order} from '../types';
import {generationFromOrder,sameOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,type OrderInventoryGeneration} from '../orderInventoryGeneration';
import {archiveRetiredOrderRawBatchAttempt,orderRawBatchAttemptKey,readOrderRawBatchAttempt,orderRawBatchOrderEvidence} from '../orderRawBatchAttempt';
import {rawPressText} from '../rawPressAttempt';
export interface OrderRequestRetirementResult {status:'retired'|'duplicate';action:'archived-only'|'allow-new-claim';allowNewClaim:boolean;inventoryApplied:'unknown';requestHash:string;requestText:string;authorizationId:string;retirementId:string;generation:OrderInventoryGeneration}
const hashText=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
const claimChanged=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('order-retirement-claim-pending'));};
const claimKey=(companyId:string,uid:string,orderId:string)=>`order-retirement-first-claim:${encodeURIComponent(uid)}:${companyId}:${encodeURIComponent(orderId)}`;
/** 응답 유실로 서버 pending이 내려갔어도 같은 최초 명세를 다시 확인한다. */
export function hasRetainedRetirementClaim(orderId:string,companyId:string,actorUid:string,retirementId?:string):boolean{
 if(typeof localStorage==='undefined'||!orderId||!actorUid||!['taebaek','punghoe'].includes(companyId))return false;
 const encoded=localStorage.getItem(claimKey(companyId,actorUid,orderId));if(encoded===null)return false;
 try{const stored=JSON.parse(encoded),request=JSON.parse(stored.requestText);return retirementId===undefined||request.retirementId===retirementId;}
 catch{return true;}
}
export async function claimRetiredOrderInventoryOperation(orderId:string,expectedStatus:Order['status'],operation:NonNullable<Order['inventoryOperation']>,referenceGuard?:InventoryNewSendGuard):Promise<Order>{
 const {auth,authReady,db,functions}=await import('../firebase');
 await authReady;const user=auth.currentUser;if(!user)throw Error('첫 재고 작업은 직원 로그인이 필요합니다.');const uid=user.uid;
 const token=await user.getIdTokenResult(),companyId=token.claims.companyId;
 if(auth.currentUser?.uid!==uid||!['taebaek','punghoe'].includes(String(companyId))||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim()||operation.actorUid!==uid||operation.contractVersion!==1||operation.productionRecordContractVersion!==1)throw Error('첫 재고 작업의 회사·최초 계정을 확인해 주세요.');
 const key=claimKey(String(companyId),uid,orderId),original=localStorage.getItem(key);
 const assertCurrent=(encoded:string|null)=>{if(auth.currentUser?.uid!==uid||localStorage.getItem(key)!==encoded)throw Error('첫 재고 claim 원문이나 로그인 계정이 바뀌었습니다. 원문을 보존했습니다.');};
 let requestText:string,requestHash:string,encoded:string,request:any;
 let unsent=original===null;
 if(original!==null){try{unsent=JSON.parse(original).sendState==='unsent';}catch{}}
 const assertReference=()=>{if(!unsent)return;const checked:unknown=referenceGuard?.assertBeforeNewSend();if(checked&&(typeof checked==='object'||typeof checked==='function')&&typeof (checked as {then?:unknown}).then==='function'){void Promise.resolve(checked).catch(()=>{});throw Error('기준정보 전송 검사는 동기 함수여야 합니다. 전송하지 않았습니다.');}};
 assertReference();
 if(original!==null){
  try{const stored=JSON.parse(original);requestText=stored.requestText;requestHash=stored.requestHash;request=JSON.parse(requestText);if(stored.version!==1||rawPressText(request)!==requestText||requestHash!==await hashText(requestText)||request.companyId!==companyId||request.actorUid!==uid||request.orderId!==orderId||request.expectedStatus!==expectedStatus||request.operation.kind!==operation.kind||request.operation.lineId!==operation.lineId||request.operation.targetStatus!==operation.targetStatus)throw Error();}
  catch{throw Error('저장된 첫 재고 claim 명세가 다릅니다. 최초 원문을 보존했습니다.');}
  encoded=original;assertCurrent(encoded);
 }else{
  assertReference();
  const snapshot=await getDoc(doc(db,'orders',orderId));assertCurrent(null);if(!snapshot.exists())throw Error('주문을 찾을 수 없습니다.');
  const live={...snapshot.data(),id:orderId} as Order&{retirementId?:string;retirementClaimPending?:boolean};
  if(live.companyId!==companyId||live.retirementClaimPending!==true||!live.retirementId||live.inventoryOperation!=null||live.inventoryGenerationCompletion||live.status!==expectedStatus)throw Error('퇴역 뒤 첫 claim의 현재 주문 원문을 확인해 주세요.');
  assertReference();
  request=JSON.parse(rawPressText({version:1,retirementId:live.retirementId,companyId,actorUid:uid,orderId,expectedStatus,orderText:orderRawBatchOrderEvidence(live),operation}));
  requestText=rawPressText(request);requestHash=await hashText(requestText);assertCurrent(null);
  assertReference();
  encoded=JSON.stringify({version:1,requestText,requestHash,sendState:'unsent'});localStorage.setItem(key,encoded);assertCurrent(encoded);
 }
 const gate=await getDoc(doc(db,'appMeta','releaseCutover'));assertCurrent(encoded);const releaseId=requireActiveReleaseId(gate.data());
 const currentToken=await user.getIdTokenResult();assertCurrent(encoded);if(currentToken.claims.companyId!==companyId||typeof currentToken.claims.employeeId!=='string'||!currentToken.claims.employeeId.trim())throw Error('첫 claim의 회사 직원 계정이 바뀌었습니다. 원문을 보존했습니다.');
 const call=httpsCallable<unknown,{status:string;retirementId:string;requestText:string;requestHash:string;generation:OrderInventoryGeneration;order:Order}>(functions,'claimRetiredOrderInventoryOperationCommand');
 assertReference();
 if(unsent){assertCurrent(encoded);const attempted=JSON.stringify({...JSON.parse(encoded),sendState:'attempted'});localStorage.setItem(key,attempted);if(localStorage.getItem(key)!==attempted)throw Error('첫 claim 송신 표식을 저장하지 못했습니다. 원문을 보존했습니다.');encoded=attempted;unsent=false;claimChanged();}
 const {data}=await call({requestText,requestHash,releaseId});assertCurrent(encoded);
 const g={contractVersion:1 as const,companyId:companyId as OrderInventoryGeneration['companyId'],orderId,operationId:request.operation.id,startedAt:request.operation.startedAt,actorUid:uid};
 const live=data?.order as Order&{retirementId?:string;retirementClaimPending?:boolean};
 if(!data||!['claimed','duplicate'].includes(data.status)||data.requestText!==requestText||data.requestHash!==requestHash||data.retirementId!==request.retirementId||!sameOrderInventoryGeneration(data.generation,g)||!live||live.id!==orderId||live.companyId!==companyId||live.retirementId!==request.retirementId||live.retirementClaimPending!==false||!(sameOrderInventoryGeneration(generationFromOrder(live),g)||hasOrderInventoryGenerationCompletion(live,g)))throw Error('서버 첫 claim 결과가 최초 명세와 다릅니다. 원문을 보존했습니다.');
 assertCurrent(encoded);localStorage.removeItem(key);claimChanged();if(localStorage.getItem(key)!==null)throw Error('첫 claim의 정확한 정리를 확인하지 못했습니다.');
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
/** 이 descriptor는 실행권이 아니다. 보관 원문을 읽기 확인 창으로 연결할 때만 쓴다. */
export interface RetainedRetirementClaimDescriptor {state:'unsent'|'attempted'|'legacy-unknown'|'corrupt';companyId:'taebaek'|'punghoe';actorUid:string;orderId:string;operationId:string;startedAt:string;lineId?:string;encoded:string;requestText?:string;requestHash?:string}
export function readPendingRetirementClaims(companyId:'taebaek'|'punghoe',actorUid:string):RetainedRetirementClaimDescriptor[]{
 if(typeof localStorage==='undefined'||!actorUid)return [];
 const prefix=`order-retirement-first-claim:${encodeURIComponent(actorUid)}:${companyId}:`,rows:RetainedRetirementClaimDescriptor[]=[];
 for(const key of Object.keys(localStorage).filter(key=>key.startsWith(prefix))){const encoded=localStorage.getItem(key);if(encoded===null)continue;let orderId:string;try{orderId=decodeURIComponent(key.slice(prefix.length));}catch{continue;}const base={companyId,actorUid,orderId,operationId:'확인 필요',startedAt:'확인 필요',encoded};
  try{const saved=JSON.parse(encoded),request=JSON.parse(saved.requestText);if(saved.version!==1||request.companyId!==companyId||request.actorUid!==actorUid||request.orderId!==orderId||typeof request.operation?.id!=='string'||!request.operation.id||typeof request.operation?.startedAt!=='string'||!request.operation.startedAt||typeof saved.requestHash!=='string'||rawPressText(request)!==saved.requestText)throw Error();rows.push({...base,state:saved.sendState==='unsent'?'unsent':saved.sendState==='attempted'?'attempted':'legacy-unknown',operationId:request.operation.id,startedAt:request.operation.startedAt,lineId:request.operation.lineId,requestText:saved.requestText,requestHash:saved.requestHash});}
  catch{rows.push({...base,state:'corrupt'});}
 }
 return rows;
}
export async function requirePreviousRetirementClaimReview(orderId:string,companyId:'taebaek'|'punghoe',actorUid:string):Promise<void>{
 const descriptor=readPendingRetirementClaims(companyId,actorUid).find(row=>row.orderId===orderId);if(!descriptor||descriptor.state==='unsent')return;
 if(descriptor.state!=='corrupt'&&descriptor.requestText&&await hashText(descriptor.requestText)!==descriptor.requestHash)descriptor.state='corrupt';
 throw Object.assign(Error('이전 시작 요청의 결과를 먼저 확인해 주세요. 완료가 확인되기 전에는 새 작업을 보내지 않습니다.'),{code:'previous-claim-review',descriptor});
}
export function assertRetainedRetirementClaimCurrent(descriptor:RetainedRetirementClaimDescriptor):void{
 if(localStorage.getItem(claimKey(descriptor.companyId,descriptor.actorUid,descriptor.orderId))!==descriptor.encoded)throw Error('보관된 이전 요청이 바뀌었습니다. 원문을 보존하고 다시 조회해 주세요.');
}
