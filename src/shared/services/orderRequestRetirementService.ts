import type {InventoryNewSendGuard} from '../hooks/useInventoryReferenceGuard';
import {doc,getDoc,getDocFromServer} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {requireActiveReleaseId} from '../releaseGate';
import {companyOf,type Order} from '../types';
import {generationFromOrder,sameOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,type OrderInventoryGeneration} from '../orderInventoryGeneration';
import {archiveRetiredOrderRawBatchAttempt,orderRawBatchAttemptKey,readOrderRawBatchAttempt,orderRawBatchOrderEvidence} from '../orderRawBatchAttempt';
import {rawPressText} from '../rawPressAttempt';
import {normalizeBatchCommand,normalizeBatchLegacyRecoveryResult,type BatchLegacyRecoveryCommand,type BatchLegacyRecoveryResult} from '../../../functions/src/shared/orderProductionBatchContract';
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
/** 완료 증명은 호출부의 재조회가 맡는다. 다른 요청이나 업무 원문까지 함께 지우지 않는다. */
export function removeRetainedRetirementClaimCopy(descriptor:RetainedRetirementClaimDescriptor,assertCurrent:()=>void):void{
 assertCurrent();assertRetainedRetirementClaimCurrent(descriptor);
 const key=claimKey(descriptor.companyId,descriptor.actorUid,descriptor.orderId);
 // 이 동기 비교는 같은 실행의 교체를 막으며 여러 탭의 원자 CAS를 대신하지 않는다.
 localStorage.removeItem(key);
 if(localStorage.getItem(key)!==null)throw Error('기기 사본 정리를 확인하지 못했습니다. 현재 사본을 유지하고 다시 조회해 주세요.');
 claimChanged();
}

/** 최초 원문과 새 서버 참조를 먼저 기기에 보관하고 서버가 재검증한 결과만 사용한다. */
export interface LegacyBatchRecoveryEntry {key:string;encoded:string;originalEncoded:string;command:BatchLegacyRecoveryCommand}
const legacyRecoveryKey=(companyId:string,uid:string,orderId:string)=>`order-legacy-batch-recovery:${encodeURIComponent(uid)}:${companyId}:${encodeURIComponent(orderId)}`;
function archiveLegacyRecovery(entry:LegacyBatchRecoveryEntry,result:BatchLegacyRecoveryResult,assert:()=>void):boolean {
 try{const rawKey=orderRawBatchAttemptKey(entry.command.reference.companyId,entry.command.originalOwnerUid,entry.command.reference.orderId),archiveKey=`order-legacy-batch-recovery-archive:${result.receiptHash}`,archive=JSON.stringify({version:1,originalEncoded:entry.originalEncoded,command:entry.command,receiptHash:result.receiptHash,state:result.state,evidence:result.evidence});const prior=localStorage.getItem(archiveKey);if(prior!==null&&prior!==archive)throw Error('이전 요청 보관 내용이 다릅니다.');if(prior===null)localStorage.setItem(archiveKey,archive);assert();if(localStorage.getItem(archiveKey)!==archive)throw Error('서버 확인 원문의 보관을 확인하지 못했습니다.');localStorage.removeItem(rawKey);if(localStorage.getItem(rawKey)!==null)throw Error('기존 요청 정리를 확인하지 못했습니다.');localStorage.removeItem(entry.key);if(localStorage.getItem(entry.key)!==null)throw Error('복구 사본을 정리하지 못했습니다.');return true;}catch{return false;}
}
async function inspectLegacyBatchRecoveryUnlocked(companyId:'taebaek'|'punghoe',uid:string,orderId:string,isCurrent:()=>boolean):Promise<{entry:LegacyBatchRecoveryEntry;result:BatchLegacyRecoveryResult & {localCleanupPending?:boolean}}>{
 const {auth,authReady,functions}=await import('../firebase');await authReady;const user=auth.currentUser;
 const assert=()=>{if(!isCurrent()||!user||auth.currentUser?.uid!==uid||user.uid!==uid)throw Error('로그인 또는 선택이 바뀌었습니다. 최초 원문을 보존했습니다.');};assert();
 const token=await user!.getIdTokenResult();assert();if(token.claims.companyId!==companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('같은 회사 직원 계정을 확인해 주세요.');
 const retained=readOrderRawBatchAttempt(companyId,uid,orderId);if(!retained)throw Error('이 기기에서 최초 주문 원문을 찾지 못했습니다. 원료와 생산 기록을 확인해 주세요.');
 const rawKey=orderRawBatchAttemptKey(companyId,uid,orderId),key=legacyRecoveryKey(companyId,uid,orderId),requestText=rawPressText(retained.request),requestHash=await hashText(requestText);assert();
 if(localStorage.getItem(rawKey)!==retained.encoded)throw Error('최초 원문이 바뀌었습니다. 다시 확인해 주세요.');
 let encoded=localStorage.getItem(key),command:BatchLegacyRecoveryCommand;
 if(encoded!==null){let saved:any;try{saved=JSON.parse(encoded);command=normalizeBatchCommand(saved.command) as BatchLegacyRecoveryCommand;if(saved.originalEncoded!==retained.encoded||command.mode!=='migrate-legacy-unapplied'||command.action!=='inspect'||command.originalOwnerUid!==uid||command.reference.companyId!==companyId||command.reference.orderId!==orderId||command.requestText!==requestText||command.requestHash!==requestHash)throw Error();}catch{throw Error('이전 복구 요청의 원문이 달라 보존했습니다.');}}
 else{command=normalizeBatchCommand({version:1,mode:'migrate-legacy-unapplied',action:'inspect',reference:{version:1,companyId,orderId,requestId:`pb1-${crypto.randomUUID()}`},originalOwnerUid:uid,requestText,requestHash}) as BatchLegacyRecoveryCommand;encoded=JSON.stringify({originalEncoded:retained.encoded,command});localStorage.setItem(key,encoded);if(localStorage.getItem(key)!==encoded)throw Error('복구 요청을 보관하지 못했습니다.');}
 assert();if(localStorage.getItem(key)!==encoded||localStorage.getItem(rawKey)!==retained.encoded)throw Error('보관 원문이 바뀌었습니다.');
 const call=httpsCallable<unknown,unknown>(functions,'orderProductionBatchCommand');const {data}=await call(command);assert();if(localStorage.getItem(key)!==encoded||localStorage.getItem(rawKey)!==retained.encoded)throw Error('조회 중 원문이 바뀌었습니다.');
 const entry={key,encoded,originalEncoded:retained.encoded,command},result=normalizeBatchLegacyRecoveryResult(data,command);return {entry,result:result.state==='migrated'&&!archiveLegacyRecovery(entry,result,assert)?{...result,localCleanupPending:true}:result};
}
async function migrateLegacyBatchRecoveryUnlocked(entry:LegacyBatchRecoveryEntry,observed:BatchLegacyRecoveryResult,uid:string,isCurrent:()=>boolean):Promise<BatchLegacyRecoveryResult & {localCleanupPending?:boolean}>{
 if(observed.state!=='observed'||observed.evidence!=='none'||observed.nextAction!=='migrate')throw Error('서버의 미반영 확인이 필요합니다.');
 const {auth,authReady,functions}=await import('../firebase');await authReady;const user=auth.currentUser,command=entry.command,rawKey=orderRawBatchAttemptKey(command.reference.companyId,uid,command.reference.orderId);
 const assert=()=>{if(!isCurrent()||!user||user.uid!==uid||auth.currentUser?.uid!==uid||localStorage.getItem(entry.key)!==entry.encoded||localStorage.getItem(rawKey)!==entry.originalEncoded)throw Error('계정이나 원문이 바뀌었습니다. 요청을 보존했습니다.');};assert();
 const token=await user!.getIdTokenResult();assert();if(token.claims.companyId!==command.reference.companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('같은 회사 직원을 확인해 주세요.');
 const expected=normalizeBatchLegacyRecoveryResult(observed,command);if(expected.reference.requestId!==command.reference.requestId)throw Error('조회한 원작업이 바뀌었습니다.');
 const apply={...command,action:'apply' as const};const call=httpsCallable<unknown,unknown>(functions,'orderProductionBatchCommand');const {data}=await call(apply);assert();const result=normalizeBatchLegacyRecoveryResult(data,apply);
 if(result.state==='migrated'&&!archiveLegacyRecovery(entry,result,assert))return {...result,localCleanupPending:true};
 return result;
}

/** 여러 탭에서 같은 원문에 서로 다른 복구 번호를 만들지 않는다. */
export async function inspectLegacyBatchRecovery(companyId:'taebaek'|'punghoe',uid:string,orderId:string,isCurrent:()=>boolean){
 if(!navigator.locks)throw Error('이 브라우저에서 이전 요청 잠금을 사용할 수 없습니다.');
 return navigator.locks.request(legacyRecoveryKey(companyId,uid,orderId),{mode:'exclusive'},()=>inspectLegacyBatchRecoveryUnlocked(companyId,uid,orderId,isCurrent));
}
export async function migrateLegacyBatchRecovery(entry:LegacyBatchRecoveryEntry,observed:BatchLegacyRecoveryResult,uid:string,isCurrent:()=>boolean){
 if(!navigator.locks)throw Error('이 브라우저에서 이전 요청 잠금을 사용할 수 없습니다.');
 return navigator.locks.request(entry.key,{mode:'exclusive'},()=>migrateLegacyBatchRecoveryUnlocked(entry,observed,uid,isCurrent));
}

/** 새 생산 창을 열기 직전 서버 marker와 계정 세대를 다시 확인한다. */
export async function confirmLegacyBatchMarker(companyId:'taebaek'|'punghoe',uid:string,orderId:string,receiptHash:string,isCurrent:()=>boolean):Promise<Order>{
 const {auth,authReady,db}=await import('../firebase');await authReady;const user=auth.currentUser;const assert=()=>{if(!isCurrent()||!user||user.uid!==uid||auth.currentUser?.uid!==uid)throw Error('로그인이나 선택이 바뀌었습니다.');};assert();const token=await user!.getIdTokenResult();assert();if(token.claims.companyId!==companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('현재 회사 직원을 확인해 주세요.');const snapshot=await getDocFromServer(doc(db,'orders',orderId));assert();if(!snapshot.exists()||snapshot.metadata.fromCache!==false||snapshot.metadata.hasPendingWrites!==false)throw Error('서버에서 확정된 주문을 확인해 주세요.');const order={...snapshot.data(),id:orderId} as Order & {legacyRecoveryRetirementV1?:{receiptHash?:string}};if(order.companyId!==companyId||order.inventoryOperation!=null||order.legacyRecoveryRetirementV1?.receiptHash!==receiptHash)throw Error('중단된 주문의 현재 서버 상태가 바뀌었습니다.');return order;
}
