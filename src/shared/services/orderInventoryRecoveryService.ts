import type {ExecutionInspectResult,ExecutionInspectInput} from '../../../functions/src/orderInventoryExecutionInspect';
import {rawPressText} from '../rawPressAttempt';
import {generationFromOrder,sameOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,type OrderInventoryGeneration} from '../orderInventoryGeneration';
import {readOrderRawBatchAttempt,orderRawBatchJobId,orderRawBatchOrderEvidence} from '../orderRawBatchAttempt';
import {doc,getDoc,getDocFromServer} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,db,functions} from '../firebase';
import {requireActiveReleaseId} from '../releaseGate';
import type {CompanyId,Order} from '../types';
export interface OrderInventoryRecoveryResult {status:'ready'|'blocked'|'recovered'|'duplicate';orderId:string;failedOperationId:string;failedStartedAt:string;inventoryApplied:'none'|'unknown'|'complete';reason?:string;failureMessage?:string;targetStatus?:string}
export async function recoverOrderInventoryLock(companyId:CompanyId,action:'inspect'|'recover',orderId:string,failedOperationId:string,failedStartedAt:string,expectedSaved:string|null=null):Promise<OrderInventoryRecoveryResult>{
 await authReady;const user=auth.currentUser;if(!user)throw Error('로그인을 확인한 뒤 다시 처리하세요.');
 const uid=user.uid;const assertActor=()=>{if(auth.currentUser?.uid!==uid)throw Error('로그인 사용자가 변경되어 작업을 중단했습니다.');};
 const token=await user.getIdTokenResult();assertActor();if(token.claims.companyId!==companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('현재 회사의 직원만 작업 잠금을 확인할 수 있습니다.');
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

export interface OrderInventoryEvidenceScope {companyId:CompanyId;uid:string;signal:AbortSignal;isCurrent:()=>boolean}
export interface OrderInventoryEvidenceTarget {orderId:string;operationId:string;startedAt:string;lineId?:string}
export interface OrderInventoryLineResumeIntent {
 order:Order;generation:OrderInventoryGeneration;lineId:string;itemIndex:number;businessText:string;
 isCurrent:()=>boolean;revalidate:()=>Promise<void>;
}
export type OrderInventoryResumeOutcome={status:'completed'|'cancelled'|'failed';error?:unknown};
export interface OrderInventoryResumeRun {intent:OrderInventoryLineResumeIntent;isCurrent:()=>boolean;settled:(result:OrderInventoryResumeOutcome)=>void}
export interface OrderInventoryRecoveryEvidence {
 order:Order|null;canResume:boolean;reason:string;checks:{label:string;state:'confirmed'|'missing'|'unknown'|'different';detail:string}[];
 intent?:OrderInventoryLineResumeIntent;lineCompleted:boolean;generationCompleted:boolean;
}
const validRecoveryId=(id:string)=>typeof id==='string'&&!!id.trim()&&id===id.trim()&&!id.includes('/');
/** 빈 조회·권한 거절·다른 세대를 재고 미반영의 증거로 사용하지 않는다. */
export async function readOrderInventoryRecoveryEvidence(scope:OrderInventoryEvidenceScope,target:OrderInventoryEvidenceTarget):Promise<OrderInventoryRecoveryEvidence>{
 const current=()=>!scope.signal.aborted&&scope.isCurrent()&&auth.currentUser?.uid===scope.uid;
 const assert=()=>{if(!current())throw Error('로그인 범위가 바뀌었습니다. 원작업은 보존했습니다.');};
 if(!validRecoveryId(target.orderId)||!target.operationId||!target.startedAt)throw Error('주문과 원작업 번호를 확인해 주세요.');
 assert();await authReady;assert();const token=await auth.currentUser!.getIdTokenResult();assert();
 if(token.claims.companyId!==scope.companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('현재 회사 직원의 로그인을 확인해 주세요.');
 const checks:OrderInventoryRecoveryEvidence['checks']=[];
 const read=async(collection:string,id:string)=>{assert();const snap=await getDocFromServer(doc(db,collection,id));assert();if(snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false||snap.id!==id)throw Error('서버에서 확정된 현재 자료를 받지 못했습니다. 다시 조회해 주세요.');return snap;};
 const base=await read('orders',target.orderId);
 if(!base.exists())return{order:null,canResume:false,reason:'현재 주문을 찾지 못했습니다. 원요청은 보존했습니다.',checks,lineCompleted:false,generationCompleted:false};
 const order={...base.data(),id:base.id} as Order;if(order.companyId!==scope.companyId)throw Error('현재 회사의 주문을 확인하지 못했습니다.');
 const operation=order.inventoryOperation,expected=operation?.id===target.operationId&&operation.startedAt===target.startedAt;
 const marker=order.inventoryGenerationCompletion?.generation;
 const generation=expected?generationFromOrder(order):marker?.operationId===target.operationId&&marker.startedAt===target.startedAt&&marker.orderId===order.id&&marker.companyId===scope.companyId?marker:null;
 if(!generation)return{order,canResume:false,reason:'현재 작업의 세대 또는 지원 계약이 다릅니다. 잠금을 임의로 해제하지 않았습니다.',checks,lineCompleted:false,generationCompleted:false};
 const index=order.items.findIndex(line=>line.lineId===(operation?.lineId??target.lineId)),line=index>=0?order.items[index]:undefined;
 let confirmed=true;
 const observe=async(label:string,collection:string,id:string,owns:(data:Record<string,any>)=>boolean)=>{
  try{const snapshot=await read(collection,id);if(!snapshot.exists()){checks.push({label,state:'missing',detail:'이번 조회에서 기록을 찾지 못했습니다. 미처리의 증거는 아닙니다.'});return;}const data=snapshot.data();if(!owns(data)){confirmed=false;checks.push({label,state:'different',detail:'현재 작업과 다른 근거입니다. 원작업을 보존했습니다.'});return;}checks.push({label,state:'confirmed',detail:'현재 작업에 연결된 기록을 조회했습니다.'});}catch(error){if(!current())throw error;confirmed=false;checks.push({label,state:'unknown',detail:error instanceof Error?error.message:'조회하지 못했습니다.'});}
 };
 await observe('원료 일괄 처리 기록','rawInventoryJobs',orderRawBatchJobId(generation),data=>data.companyId===scope.companyId&&sameOrderInventoryGeneration(data.generation??JSON.parse(data.requestText??'null')?.generation,generation));
 const indexed=line?.lineId?order.productionRecordIndex?.[line.lineId]:undefined;
 if(indexed)await observe('해당 줄 생산 기록','productionRecords',indexed.recordId,data=>data.companyId===scope.companyId&&data.orderId===order.id&&data.lineId===line!.lineId&&sameOrderInventoryGeneration(data.generation,generation));
 if(indexed&&checks.at(-1)?.state==='missing')confirmed=false;
 else if(!indexed)checks.push({label:'해당 줄 생산 기록',state:'missing',detail:'이 줄에 연결된 생산 기록이 없습니다. 다른 줄의 완료 기록으로 대신 판정하지 않습니다.'});
 if(line&&validRecoveryId(line.itemId)){await observe('해당 품목 예약 조회','items',line.itemId,data=>data.companyId===scope.companyId);if(checks.at(-1)?.state==='missing')confirmed=false;}
 checks.push({label:'품목 완료 상태',state:'confirmed',detail:order.items.map((row,i)=>`${i+1}번 ${row.name||'품목'}: ${row.checked?'완료':'미완료'}`).join(' / ')});
 const complete=hasOrderInventoryGenerationCompletion(order,generation),lineCompleted=line?.checked===true;
 checks.push({label:'최종 작업 완료표',state:complete?'confirmed':'missing',detail:complete?'이 원작업의 최종 완료 근거가 일치합니다.':'이 원작업의 최종 완료를 확인하지 못했습니다. 앞선 다른 줄의 완료표와 구분합니다.'});
 let retainedProblem='';
 if(expected&&operation?.state==='failed'){try{const retained=readOrderRawBatchAttempt(scope.companyId,scope.uid,order.id);if(retained&&(!sameOrderInventoryGeneration(retained.request.generation,generation)||retained.request.business.orderText!==orderRawBatchOrderEvidence(order)))retainedProblem='보관된 최초 원문이 현재 작업과 다릅니다. 기존 원문을 보존하고 확인해 주세요.';if(!retained&&!['claim','reservation'].includes(operation.stage??''))retainedProblem='최초 원료·생산 계획의 보관본이 없어 새로 계산하지 않았습니다. 원작업 자료를 확인해 주세요.';}catch(error){retainedProblem=error instanceof Error?error.message:'최초 원문을 읽지 못했습니다.';}}
 let reason=retainedProblem||(!expected?'현재 같은 실패 잠금은 없습니다. 완료 근거와 현재 줄 상태를 확인해 주세요.':operation?.state==='processing'?'현재 처리 중인 작업입니다. 자동 해제하거나 다시 시작하지 않습니다.':lineCompleted?'이 줄은 현재 완료로 표시됩니다. 완료 줄을 다시 누르거나 취소하지 않았습니다.':operation?.actorUid!==scope.uid?'최초 작업을 시작한 계정으로 로그인해야 계속할 수 있습니다.':!confirmed?'일부 근거를 확인하지 못했습니다. 원문과 잠금을 유지하고 다시 조회해 주세요.':'');
 const canResume=!reason&&operation?.state==='failed'&&operation.kind==='line'&&operation.productionRecordContractVersion===1&&!!line;
 if(!canResume&&!reason)reason='이 작업은 현재 화면에서 계속할 수 있는 줄 작업 계약이 아닙니다. 원문을 보존했습니다.';
 const evidence:OrderInventoryRecoveryEvidence={order,canResume,reason,checks,lineCompleted,generationCompleted:complete};
 if(canResume){const businessText=orderRawBatchOrderEvidence(order),intent:OrderInventoryLineResumeIntent={order,generation,lineId:line!.lineId!,itemIndex:index,businessText,isCurrent:current,revalidate:async()=>{const fresh=await readOrderInventoryRecoveryEvidence(scope,target);if(!fresh.canResume||!fresh.intent||!sameOrderInventoryGeneration(fresh.intent.generation,generation)||fresh.intent.lineId!==line!.lineId||fresh.order?.inventoryOperation?.targetStatus!==operation?.targetStatus||fresh.intent.businessText!==businessText)throw Error(fresh.reason||'확인 뒤 주문 내용이 바뀌었습니다. 원작업을 다시 조회해 주세요.');}};evidence.intent=intent;}
 return evidence;
}
/** 이전 claim은 서버 읽기 확인만 요청한다. RPC 부재·권한 오류를 이전 client 조회로 숨기지 않는다. */
export async function readRetainedRetirementClaimEvidence(scope:OrderInventoryEvidenceScope,descriptor:import('./orderRequestRetirementService').RetainedRetirementClaimDescriptor):Promise<OrderInventoryRecoveryEvidence>{
 const {assertRetainedRetirementClaimCurrent}=await import('./orderRequestRetirementService');
 const assert=()=>{if(scope.signal.aborted||!scope.isCurrent()||auth.currentUser?.uid!==scope.uid||descriptor.actorUid!==scope.uid||descriptor.companyId!==scope.companyId)throw Error('로그인 범위가 바뀌었습니다. 이전 요청은 보존했습니다.');assertRetainedRetirementClaimCurrent(descriptor);};
 assert();await authReady;assert();const token=await auth.currentUser!.getIdTokenResult();assert();
 if(token.claims.companyId!==scope.companyId||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('현재 회사 직원의 로그인을 확인해 주세요.');
 const preserved='이전 시작 요청의 결과를 확인하고 있습니다. 완료가 확인되기 전에는 새 작업을 보내지 않습니다. 처리 중 요청을 이어가는 기능은 현재 지원하지 않습니다.';
 if(descriptor.state==='corrupt'||!descriptor.requestText||!descriptor.requestHash)return{order:null,canResume:false,reason:'보관 원문을 확인하지 못했습니다. 삭제하지 않고 유지합니다. '+preserved,checks:[],lineCompleted:false,generationCompleted:false};
 let request:Record<string,any>;try{request=JSON.parse(descriptor.requestText);}catch{throw Error('보관된 이전 요청을 읽지 못했습니다. 삭제하지 않고 유지합니다.');}
 if(request?.operation?.contractVersion!==1||request.actorUid!==scope.uid||request.companyId!==scope.companyId||request.orderId!==descriptor.orderId||request.operation.id!==descriptor.operationId||request.operation.startedAt!==descriptor.startedAt)throw Error('보관된 이전 요청의 처리번호를 확인하지 못했습니다. 원문은 유지합니다.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(descriptor.requestText))),byte=>byte.toString(16).padStart(2,'0')).join('');assert();if(hash!==descriptor.requestHash)throw Error('보관된 이전 요청의 원문을 확인하지 못했습니다. 삭제하지 않고 유지합니다.');
 const generation={contractVersion:1 as const,companyId:scope.companyId,actorUid:scope.uid,orderId:descriptor.orderId,operationId:descriptor.operationId,startedAt:descriptor.startedAt},input:ExecutionInspectInput={version:1,generation,claimRequestHash:hash};
 let response:ExecutionInspectResult;
 try{response=(await httpsCallable<ExecutionInspectInput,ExecutionInspectResult>(functions,'inspectOrderInventoryExecutionCommand')(input)).data;}catch(error){assert();const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';throw Error(code.includes('not-found')||code.includes('unimplemented')?'서버 상태 조회 기능을 아직 사용할 수 없습니다. 원문을 유지했습니다. 나중에 다시 조회해 주세요.':code.includes('permission-denied')?'현재 회사 직원의 조회 권한을 확인해 주세요. 원문은 유지했습니다.':'서버 상태를 조회하지 못했습니다. 연결을 확인하고 다시 조회해 주세요. 원문은 유지했습니다.');}
 assert();
 const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const exactKeys=(row:object,keys:readonly string[])=>Object.keys(row).every(key=>keys.includes(key));
 const reasonCodes=['order-missing','generation-different','claim-missing','claim-invalid','raw-missing','raw-invalid','production-missing','production-invalid','final-missing','final-invalid','read-limit','evidence-too-large','read-failed'];
 const reasons=(value:unknown)=>Array.isArray(value)&&value.length<=reasonCodes.length&&new Set(value).size===value.length&&value.every(code=>typeof code==='string'&&reasonCodes.includes(code));
 const evidenceKeys=['claim','raw','production','final'] as const;
 if(!object(response)||!exactKeys(response,['version','generation','claimRequestHash','status','canResume','evidence','reasonCodes','observedAt'])||response.version!==1||response.canResume!==false||!object(response.generation)||rawPressText(response.generation)!==rawPressText(generation)||response.claimRequestHash!==hash||!['completed','processing','failed','different','unknown'].includes(response.status)||typeof response.observedAt!=='string'||!Number.isFinite(Date.parse(response.observedAt))||!reasons(response.reasonCodes)||!object(response.evidence)||Object.keys(response.evidence).length!==4||!evidenceKeys.every(key=>{const row=response.evidence[key];return object(row)&&exactKeys(row,['state','count','reasonCodes'])&&Object.keys(row).length===3&&['matched','missing','unknown','different'].includes(row.state)&&Number.isSafeInteger(row.count)&&row.count>=0&&row.count<=53&&reasons(row.reasonCodes);}))throw Error('서버 조회 응답이 최초 요청과 다릅니다. 원문을 유지하고 다시 조회해 주세요.');
 const complete=response.status==='completed';
 if(complete&&(response.evidence.claim.state!=='matched'||response.evidence.final.state!=='matched'||response.evidence.raw.state!=='matched'||response.evidence.production.state!=='matched'||response.reasonCodes.length||evidenceKeys.some(key=>response.evidence[key].reasonCodes.length>0)))throw Error('서버 완료 근거를 확인하지 못했습니다. 원문을 유지하고 다시 조회해 주세요.');
 const reasonText:Record<string,string>={'order-missing':'이번 서버 조회에서 주문을 찾지 못했습니다. 미처리로 확정하지 않았습니다.','generation-different':'현재 작업의 처리번호가 보관 원문과 다릅니다.','claim-missing':'조회한 위치에 시작 요청 근거가 없습니다. 미처리로 확정하지 않았습니다.','claim-invalid':'시작 요청의 원문과 연결 근거가 일치하지 않습니다.','raw-missing':'조회한 위치에 원료 일괄 근거가 없습니다. 미처리로 확정하지 않았습니다.','raw-invalid':'원료 일괄 원문이나 결과의 연결이 일치하지 않습니다.','production-missing':'조회한 위치에 생산기록 근거가 없습니다. 미처리로 확정하지 않았습니다.','production-invalid':'생산계획·기록·연결 근거가 일치하지 않습니다.','final-missing':'주문에서 이 요청의 최종 완료 근거를 찾지 못했습니다. 미처리로 확정하지 않았습니다.','final-invalid':'최종 완료 근거의 원문이나 처리번호가 일치하지 않습니다.','read-limit':'조회할 기록 수가 한도를 넘어 일부 근거를 확인하지 못했습니다.','evidence-too-large':'조회한 근거의 크기가 한도를 넘어 일부 내용을 확인하지 못했습니다.','read-failed':'서버 근거 조회에 실패했습니다. 연결을 확인한 뒤 다시 조회해 주세요.'};
 const labels={claim:'이전 시작 요청',raw:'원료 일괄 처리',production:'생산기록',final:'최종 완료'};
 const detail={matched:'이 요청과 연결된 처리기록을 확인했습니다.',missing:'조회한 위치에 근거가 없습니다. 미처리로 확정하지 않았습니다.',unknown:'아직 근거를 확인하지 못했습니다. 원문을 유지합니다.',different:'원요청과 다른 근거가 확인됐습니다. 원문을 유지합니다.'};
 const checks=evidenceKeys.map(key=>({label:labels[key],state:response.evidence[key].state==='matched'?'confirmed' as const:response.evidence[key].state,detail:[detail[response.evidence[key].state],...response.evidence[key].reasonCodes.map(code=>reasonText[code])].join(' ')}));
 const statusText={completed:'이전 시작 요청과 일치하는 최종 완료를 서버에서 확인했습니다. 보관 원문은 유지합니다.',processing:'이전 요청은 현재 처리 중으로 표시됩니다.',failed:'이전 요청은 실패 상태로 표시됩니다.',different:'현재 주문의 작업이 보관된 요청과 다릅니다.',unknown:'현재 원요청의 결과를 확정하지 못했습니다.'};
 return{order:null,canResume:false,reason:[statusText[response.status],...response.reasonCodes.map(code=>reasonText[code]),complete?'':preserved].filter(Boolean).join(' '),checks,lineCompleted:false,generationCompleted:complete};
}
