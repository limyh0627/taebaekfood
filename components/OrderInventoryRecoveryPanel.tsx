import type {RetainedRetirementClaimDescriptor} from '../src/shared/services/orderRequestRetirementService';
import {orderInventoryErrorMessage,orderInventoryRecoveryChecks} from '../src/shared/orderInventoryError';
import React,{useEffect,useRef,useState} from 'react';
import {LockKeyhole} from 'lucide-react';
import ModalShell from '../src/shared/components/ModalShell';
import {useOutputScope} from '../src/shared/hooks/useOutputScope';
import {companyOf,type CompanyId,type Order} from '../src/shared/types';
import {appConfirm} from '../src/shared/components/appDialog';
import {clearCompletedRetirementClaimCopy,readRetainedRetirementClaimEvidence,clearPendingOrderInventoryRecovery,recoverOrderInventoryLock,readOrderInventoryRecoveryEvidence,type OrderInventoryRecoveryEvidence,type OrderInventoryEvidenceScope,type OrderInventoryResumeRun,type OrderInventoryRecoveryResult,type PendingOrderInventoryRecovery} from '../src/shared/services/orderInventoryRecoveryService';
import {fullRecoveryLocatorKey,inspectFullRecovery,cancelFullRecovery,type FullRecoveryScope,type FullRecoveryLocator,type PublicOrderStockRecoveryResult} from '../src/shared/services/orderStockFullService';
import {sessionActorKey,sessionIdentityLifetime} from '../src/shared/sessionIdentityLifetime';
interface Props {companyId:CompanyId;actorUid:string;orders:readonly Order[];pending?:readonly PendingOrderInventoryRecovery[];retirementClaims?:readonly RetainedRetirementClaimDescriptor[];isCurrentActor?:()=>boolean;onRecovered:(result:OrderInventoryRecoveryResult,expectedSaved:string|null)=>void;onResumeLine?:(run:OrderInventoryResumeRun)=>Promise<unknown>|unknown;fullRecoveryScope?:FullRecoveryScope;fullRecoveryCopies?:readonly FullRecoveryLocator[];fullRecoveryReadError?:string;onFullRecoverySettled?:(result:PublicOrderStockRecoveryResult)=>void|Promise<void>;onFullRecoveryCopiesChanged?:()=>void;onOpenFullRecovery?:(entry:{order?:Order;locator:FullRecoveryLocator})=>void;initialFullRecovery?:{order?:Order;locator:FullRecoveryLocator};onCloseFullRecovery?:()=>void}
type Entry={ownerToken?:object;orderId:string;partnerName:string;operationId:string;startedAt:string;order?:Order;pending?:PendingOrderInventoryRecovery;retirement?:RetainedRetirementClaimDescriptor;full?:FullRecoveryLocator;fullMalformed?:boolean};
const entryKey=(entry:Entry)=>entry.full?'full:'+fullRecoveryLocatorKey(entry.full):entry.orderId+':'+entry.operationId+':'+entry.startedAt;
type Notice={ownerToken?:object;message:string;checks?:readonly string[];failure?:string};
const blockedNotice=(result:OrderInventoryRecoveryResult):Notice=>({message:'잠금을 유지합니다. '+orderInventoryErrorMessage(result.reason),checks:orderInventoryRecoveryChecks(result.reason),failure:result.failureMessage?orderInventoryErrorMessage(result.failureMessage):undefined});
export default function OrderInventoryRecoveryPanel({companyId,actorUid,orders,pending=[],retirementClaims=[],isCurrentActor=()=>true,onRecovered,onResumeLine,fullRecoveryScope,fullRecoveryCopies=[],fullRecoveryReadError,onFullRecoverySettled,onFullRecoveryCopiesChanged,onOpenFullRecovery,initialFullRecovery,onCloseFullRecovery}:Props){
 const [messages,setMessages]=useState<Record<string,Notice>>({}),[busy,setBusy]=useState<string|null>(null),[selected,setSelected]=useState<Entry|null>(null),[evidence,setEvidence]=useState<OrderInventoryRecoveryEvidence|null>(null),[fullResult,setFullResult]=useState<{key:string;ownerToken:object;result:PublicOrderStockRecoveryResult}|null>(null);
 const selectedKey=useRef<string|null>(null);
 const inFlight=useRef<symbol|null>(null),scope=useRef('');scope.current=companyId+':'+actorUid;
 const identity=useRef({key:companyId+':'+actorUid,token:{}}),flightOwner=useRef(identity.current.token);
 if(identity.current.key!==companyId+':'+actorUid){identity.current={key:companyId+':'+actorUid,token:{}};inFlight.current=null;}
 const ownerToken=identity.current.token,visibleBusy=flightOwner.current===ownerToken?busy:null;
 const getSignal=useOutputScope(companyId,'order-recovery:'+actorUid);
 useEffect(()=>{scope.current=companyId+':'+actorUid;return()=>{scope.current='closed';};},[companyId,actorUid]);
 const latest=useRef(orders);latest.current=orders;
 const entries:Entry[]=orders.filter(order=>companyOf(order)===companyId&&!!order.inventoryOperation).map(order=>({orderId:order.id,partnerName:order.partnerName,operationId:order.inventoryOperation!.id,startedAt:order.inventoryOperation!.startedAt,order}));
 for(const entry of entries){const operation=entry.order?.inventoryOperation;if(!operation)continue;const marked=['fullProtocol','fullAttemptId','fullReference'].some(key=>Object.prototype.hasOwnProperty.call(operation,key))||operation.id.startsWith('private-stock-full-v1:');if(!marked)continue;entry.fullMalformed=true;try{const locator={reference:operation.fullReference!,originalOwnerUid:operation.actorUid!};if(operation.fullProtocol!=='private-stock-full-v1'||typeof operation.fullAttemptId!=='string'||operation.id!=='private-stock-full-v1:'+operation.fullAttemptId||locator.reference.orderId!==entry.orderId||locator.reference.companyId!==companyId)continue;fullRecoveryLocatorKey(locator);entry.full=locator;entry.fullMalformed=false;}catch{/* 잘못된 서버 표식을 이전 작업으로 넘기지 않는다. */}}
 for(const locator of fullRecoveryCopies){try{if(locator.reference.companyId!==companyId)continue;const key=fullRecoveryLocatorKey(locator);if(entries.some(row=>row.full&&fullRecoveryLocatorKey(row.full)===key))continue;entries.push({orderId:locator.reference.orderId,partnerName:orders.find(row=>row.id===locator.reference.orderId)?.partnerName??'',operationId:locator.reference.requestId,startedAt:'',full:locator});}catch{/* 손상된 사본은 서비스의 오류로 따로 표시한다. */}}
 for(const saved of pending.filter(row=>row.companyId===companyId&&row.uid===actorUid)){const existing=entries.find(row=>row.orderId===saved.orderId&&row.operationId===saved.failedOperationId&&row.startedAt===saved.failedStartedAt);if(existing)existing.pending=saved;else entries.push({orderId:saved.orderId,partnerName:orders.find(row=>row.id===saved.orderId)?.partnerName??'',operationId:saved.failedOperationId,startedAt:saved.failedStartedAt,pending:saved});}
 for(const saved of retirementClaims.filter(row=>row.companyId===companyId&&row.actorUid===actorUid&&row.state!=='unsent')){const existing=entries.find(row=>row.orderId===saved.orderId&&row.operationId===saved.operationId&&row.startedAt===saved.startedAt);if(existing)existing.retirement=saved;else entries.push({orderId:saved.orderId,partnerName:orders.find(row=>row.id===saved.orderId)?.partnerName??'',operationId:saved.operationId,startedAt:saved.startedAt,retirement:saved});}
 const lineEntry=(entry:Entry)=>entry.order?.inventoryOperation?.kind==='line'||entry.order?.inventoryOperation?.state==='processing';
 const target=(entry:Entry)=>({orderId:entry.orderId,operationId:entry.operationId,startedAt:entry.startedAt,lineId:entry.order?.inventoryOperation?.lineId});
 function capture():OrderInventoryEvidenceScope{const captured=scope.current,signal=getSignal();return{companyId,uid:actorUid,signal,isCurrent:()=>identity.current.token===ownerToken&&scope.current===captured&&isCurrentActor()&&!signal.aborted};}
 const notice=(entry:Entry,message:string)=>setMessages(rows=>({...rows,[entryKey(entry)]:{ownerToken,message}}));
 async function fullAction(entry:Entry,mode:'inspect'|'cancel'){
  if(inFlight.current||!isCurrentActor()||getSignal().aborted)return;
  const key=entryKey(entry),run=Symbol(),captured=capture();inFlight.current=run;flightOwner.current=ownerToken;selectedKey.current=key;setBusy(key);setSelected({...entry,ownerToken});setEvidence(null);if(mode==='inspect')setFullResult(null);
  const valid=()=>inFlight.current===run&&selectedKey.current===key&&captured.isCurrent();
  try{
   if(entry.fullMalformed||!entry.full){notice(entry,'서버 작업 참조를 확인하지 못했습니다. 원래 요청을 보존하고 다시 확인해 주세요.');return;}
   if(!fullRecoveryScope||fullRecoveryScope.companyId!==companyId||fullRecoveryScope.actorUid!==actorUid){notice(entry,'현재 직원의 로그인 범위를 확인한 뒤 다시 조회해 주세요.');return;}
   const ticket=sessionIdentityLifetime.capture(sessionActorKey({uid:fullRecoveryScope.actorUid,employeeId:fullRecoveryScope.employeeId,companyId:fullRecoveryScope.companyId,isAdmin:fullRecoveryScope.isAdmin}));
   if(!ticket){notice(entry,'로그인 확인이 진행 중입니다. 확인 후 다시 조회해 주세요.');return;}
   const ready=async()=>valid()&&await sessionIdentityLifetime.waitUntilReady(ticket)&&valid()&&sessionIdentityLifetime.isCurrent(ticket);
   if(mode==='cancel'){
    const approved=await appConfirm({title:'미반영 처리 요청 취소',message:'아직 반영되지 않은 처리 요청만 취소합니다. 원래 재고와 완료된 업무, 기존 예약은 유지합니다.',confirmText:'미반영 처리 요청 취소',tone:'amber'});
    if(!approved||!await ready())return;
    if(entry.order){const current=latest.current.find(order=>order.id===entry.orderId&&companyOf(order)===companyId)?.inventoryOperation;try{if(!current||current.id!==entry.operationId||current.startedAt!==entry.startedAt||current.fullProtocol!=='private-stock-full-v1'||current.fullAttemptId!==entry.order.inventoryOperation?.fullAttemptId||fullRecoveryLocatorKey({reference:current.fullReference!,originalOwnerUid:current.actorUid!})!==key.slice(5)){notice(entry,'확인하는 동안 주문 작업이 바뀌었습니다. 다시 조회해 주세요.');return;}}catch{notice(entry,'확인하는 동안 주문 작업이 바뀌었습니다. 다시 조회해 주세요.');return;}}
   }
   if(!await ready())return;
   const outcome=await (mode==='inspect'?inspectFullRecovery:cancelFullRecovery)(fullRecoveryScope,entry.full,valid);
   if(!await ready())return;
   try{onFullRecoveryCopiesChanged?.();}catch{/* 서버 결과와 사본 목록 갱신 실패를 혼동하지 않는다. */}
   if(outcome.kind==='invalidated')return;
   if(outcome.kind==='busy'){notice(entry,'같은 요청을 확인하고 있습니다. 잠시 후 다시 조회해 주세요.');return;}
   if(outcome.kind==='local-error'){notice(entry,outcome.message);return;}
   const value=outcome.result;setFullResult({key,ownerToken,result:value});
   const labels={reserved:'아직 반영되지 않은 요청입니다.',applied:'이 요청은 이미 반영되었습니다.',cancelled:'미반영 처리 요청을 취소했습니다. 기존 업무는 유지됩니다.','needs-review':'현재 근거를 확인해야 합니다. 원요청을 보존했습니다.','not-found-unconfirmed':'요청 결과를 아직 확인하지 못했습니다. 원요청을 보존했습니다.'} as const;
   notice(entry,labels[value.state]+(outcome.notice?' '+outcome.notice:''));
   if(value.state==='applied'||value.state==='cancelled'){
    try{await onFullRecoverySettled?.(value);}catch{if(await ready())notice(entry,labels[value.state]+' 처리 결과는 확인했지만 목록을 갱신하지 못했습니다. 다시 조회해 주세요.');}
   }
  }catch{if(valid())notice(entry,'요청 결과를 확인하지 못했습니다. 원요청을 보존하고 다시 조회해 주세요.');}
  finally{if(inFlight.current===run){inFlight.current=null;if(captured.isCurrent())setBusy(null);}}
 }
 async function inspect(entry:Entry){
  if(entry.full&&onOpenFullRecovery){onOpenFullRecovery({order:entry.order,locator:entry.full});return;}
  if(entry.full||entry.fullMalformed)return fullAction(entry,'inspect');
  if(inFlight.current||!isCurrentActor()||getSignal().aborted)return;
  const run=Symbol(),captured=capture(),key=entryKey(entry);inFlight.current=run;flightOwner.current=ownerToken;setBusy(key);setSelected({...entry,ownerToken});setEvidence(null);
  const valid=()=>inFlight.current===run&&captured.isCurrent();
  let expectedSaved:string|null=entry.pending?.expectedSaved??null;
  if(!entry.pending)try{expectedSaved=localStorage.getItem('order-cancellation:'+actorUid+':'+companyId+':'+entry.orderId);}catch{}
  const finish=(result:OrderInventoryRecoveryResult)=>{if(!valid())return;onRecovered(result,expectedSaved);if(!valid())return;clearPendingOrderInventoryRecovery(companyId,actorUid,result,expectedSaved);notice(entry,'작업 잠금을 해제했습니다. 원래 출고 취소·주문 삭제는 목록에서 다시 확인하고 승인해 주세요.');};
  try{
   if(entry.retirement){notice(entry,'서버의 처리기록을 조회하고 있습니다.');const read=await readRetainedRetirementClaimEvidence(captured,entry.retirement);if(valid()){setEvidence(read);notice(entry,read.reason);}return;}
   if(lineEntry(entry)){const read=await readOrderInventoryRecoveryEvidence(captured,target(entry));if(valid()){setEvidence(read);notice(entry,read.reason||'현재 실패 줄과 근거를 조회했습니다. 같은 최초 작업을 계속할 수 있습니다.');}return;}
   const result=await recoverOrderInventoryLock(companyId,'inspect',entry.orderId,entry.operationId,entry.startedAt);if(!valid())return;
   if(result.status==='blocked'||result.inventoryApplied!=='none'){setMessages(rows=>({...rows,[key]:{...blockedNotice(result),ownerToken}}));return;}
   if(['recovered','duplicate'].includes(result.status)){finish(result);return;}
   if(result.status==='ready'){
    notice(entry,'재고 반영 없음이 확인되었습니다. 사용자 확인을 기다립니다.');
    const approved=await appConfirm({title:'실패 작업 잠금 해제',message:'서버에서 이 실패 작업의 재고·로트·수불부 반영이 없음을 확인했습니다. 작업 잠금만 해제할까요? 출고 취소·주문 삭제는 이후 새로 확인하고 승인합니다.',confirmText:'잠금 해제',tone:'amber'});
    if(!approved||!valid()||!latest.current.some(order=>order.id===entry.orderId&&order.inventoryOperation?.id===entry.operationId&&order.inventoryOperation.state==='failed'&&order.inventoryOperation.startedAt===entry.startedAt))return;
    const recovered=await recoverOrderInventoryLock(companyId,'recover',entry.orderId,entry.operationId,entry.startedAt,expectedSaved);if(!valid())return;
    if(['recovered','duplicate'].includes(recovered.status)&&recovered.inventoryApplied==='none')finish(recovered);else setMessages(rows=>({...rows,[key]:{...blockedNotice(recovered),ownerToken}}));
   }
  }catch(error){if(valid())setMessages(rows=>({...rows,[key]:{ownerToken,message:orderInventoryErrorMessage(error),checks:orderInventoryRecoveryChecks(undefined)}}));}
  finally{if(inFlight.current===run){inFlight.current=null;if(captured.isCurrent())setBusy(null);}}
 }
 async function clearCompletedCopy(entry:Entry){
  if(!entry.retirement||!evidence?.generationCompleted||inFlight.current||!isCurrentActor()||getSignal().aborted)return;
  const run=Symbol(),captured=capture();inFlight.current=run;flightOwner.current=ownerToken;setBusy(entryKey(entry));
  const valid=()=>inFlight.current===run&&captured.isCurrent();
  try{
   const approved=await appConfirm({title:'완료 요청의 기기 사본 정리',message:'서버에서 이 요청의 최종 완료를 다시 확인한 뒤 이 기기에 남은 시작 요청 사본만 정리합니다. 주문·재고 기록과 다른 작업의 잠금은 유지합니다. 정리 후 주문 목록에서 다음 업무를 선택해 주세요.',confirmText:'기기 사본 정리'});
   if(!approved||!valid())return;
   setEvidence(null);notice(entry,'최종 완료를 다시 조회하고 기기 사본을 정리하고 있습니다.');
   await clearCompletedRetirementClaimCopy(captured,entry.retirement);if(!valid())return;
   setSelected(null);setEvidence(null);
  }catch(error){if(valid())notice(entry,orderInventoryErrorMessage(error));}
  finally{if(inFlight.current===run){inFlight.current=null;if(captured.isCurrent())setBusy(null);}}
 }
 async function resume(entry:Entry){
  if(entry.retirement||inFlight.current||!onResumeLine||!isCurrentActor()||getSignal().aborted)return;
  let launched=false;const run=Symbol(),captured=capture();inFlight.current=run;flightOwner.current=ownerToken;setBusy(entryKey(entry));
  const valid=()=>inFlight.current===run&&captured.isCurrent();
  const release=()=>{if(inFlight.current===run){inFlight.current=null;if(captured.isCurrent())setBusy(null);}};
  try{
   const read=await readOrderInventoryRecoveryEvidence(captured,target(entry));if(!valid())return;
   if(!read.canResume||!read.intent){setEvidence(read);notice(entry,read.reason);return;}
   const approved=await appConfirm({title:'최초 줄 작업 계속',message:'현재 미완료인 줄을 최초 작업번호와 원문으로 계속합니다. 기존 재고 사용·생산 확인창에서 내용을 확인해 주세요.',confirmText:'계속'});
   if(!approved||!valid())return;
   await read.intent.revalidate();if(!valid())return;
   let settled=false;
   const finish=async(result:Parameters<OrderInventoryResumeRun['settled']>[0])=>{
    if(settled)return;settled=true;if(!valid()){release();return;}
    setSelected(entry);
    if(result.status==='cancelled'){notice(entry,'확인을 취소했습니다. 최초 작업과 원문은 유지합니다. 다시 확인해 계속할 수 있습니다.');release();return;}
    if(result.status==='failed'){notice(entry,'작업을 완료하지 못했습니다. '+orderInventoryErrorMessage(result.error));release();return;}
    try{const after=await readOrderInventoryRecoveryEvidence(captured,target(entry));if(!valid())return;setEvidence(after);notice(entry,after.lineCompleted&&after.generationCompleted?'최초 줄 작업의 완료를 확인했습니다. 주문으로 돌아갈 수 있습니다.':'저장 응답은 받았지만 최초 줄 작업 완료를 확인하지 못했습니다. 다시 조회해 주세요.');}catch(error){if(valid())notice(entry,'저장 응답은 받았지만 후속 조회를 하지 못했습니다. '+orderInventoryErrorMessage(error));}finally{release();}
   };
   setSelected(null);notice(entry,'기존 재고 사용·생산 확인창에서 진행해 주세요. 아직 완료된 것은 아닙니다.');
   launched=true;await onResumeLine({intent:read.intent,isCurrent:()=>valid(),settled:result=>{void finish(result);}});
   // launch 반환은 확인창 생성이며 ACK가 아니다. settled만 실행 수명을 끝낸다.
   return;
  }catch(error){if(valid()){setSelected(entry);notice(entry,orderInventoryErrorMessage(error));}release();}
  finally{if(!launched)release();}
 }
 const started=useRef(false);
 useEffect(()=>{if(!initialFullRecovery||started.current)return;started.current=true;const {order,locator}=initialFullRecovery;void fullAction({orderId:locator.reference.orderId,partnerName:order?.partnerName??'',operationId:order?.inventoryOperation?.id??locator.reference.requestId,startedAt:order?.inventoryOperation?.startedAt??'',order,full:locator},'inspect');},[initialFullRecovery]);
 if(!entries.length&&!selected)return null;
 const entryOrders=entries.filter((entry,index)=>entries.findIndex(row=>row.orderId===entry.orderId)===index);
 const active=selected?.ownerToken===ownerToken?selected:null,stored=active&&messages[entryKey(active)]?.ownerToken===ownerToken?messages[entryKey(active)]:undefined,operation=active?.order?.inventoryOperation,fullCurrent=active&&fullResult?.ownerToken===ownerToken&&fullResult.key===entryKey(active)?fullResult.result:null;
 return <>{!initialFullRecovery&&entryOrders.map(entry=><button key={entryKey(entry)} type="button" aria-label="잠금 이유 및 복구" title="잠금 이유 및 복구" disabled={visibleBusy!==null} onClick={()=>void inspect(entry)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-40"><LockKeyhole size={14}/></button>)}
  {active&&<ModalShell className="text-slate-700" title="주문 재고 작업 확인" subtitle={active.partnerName||'거래처 확인 필요'} onClose={()=>{if(!visibleBusy){selectedKey.current=null;setSelected(null);onCloseFullRecovery?.();}}} footer={<><button type="button" disabled={visibleBusy!==null} onClick={()=>void inspect(active)} className="rounded border px-3 py-2">다시 조회</button>{active.full&&fullCurrent?.state==='reserved'&&fullCurrent.canCancel&&<button type="button" disabled={visibleBusy!==null} onClick={()=>void fullAction(active,'cancel')} className="rounded border px-3 py-2">미반영 처리 요청 취소</button>}{!active.full&&!active.fullMalformed&&active.retirement&&evidence?.generationCompleted&&<button type="button" disabled={visibleBusy!==null} onClick={()=>void clearCompletedCopy(active)} className="rounded border px-3 py-2">기기 사본 정리</button>}{!active.full&&!active.fullMalformed&&!active.retirement&&evidence?.canResume&&onResumeLine&&<button type="button" disabled={visibleBusy!==null} onClick={()=>void resume(active)} className="rounded border px-3 py-2">최초 작업 계속</button>}<button type="button" disabled={visibleBusy!==null} onClick={()=>{selectedKey.current=null;setSelected(null);onCloseFullRecovery?.();}} className="rounded border px-3 py-2">주문으로 돌아가기</button></>}>
   {entries.filter(row=>row.orderId===active.orderId).length>1&&<label>확인할 작업<select aria-label="확인할 작업" disabled={visibleBusy!==null} value={entryKey(active)} onChange={event=>{const chosen=entries.find(row=>entryKey(row)===event.target.value);if(chosen)void inspect(chosen);}}>{entries.filter(row=>row.orderId===active.orderId).map((row,index)=><option key={entryKey(row)} value={entryKey(row)}>{row.order?'현재 잠금':'이전 요청 결과'} {index+1}</option>)}</select></label>}
   <p>{active.order?`주문 품목 ${active.order.items.length}개`:'현재 목록에서 주문 품목을 확인하지 못했습니다.'} · {operation?.state==='processing'?(active.full||active.fullMalformed?'열었을 때 요청 상태: 처리 중':'처리 중'):operation?.state==='failed'?(active.full||active.fullMalformed?'열었을 때 요청 상태: 실패 작업':'실패 작업'):'이전 요청 결과 확인'}</p>
   {operation?.lineId&&<p>실패 줄: {(active.order?.items.findIndex(line=>line.lineId===operation.lineId)??-1)+1}번 · 단계: {({claim:'작업 시작',reservation:'재고 예약','raw-inventory':'원료 처리','production-record':'생산 기록','final-stock':'최종 재고 반영'} as Record<string,string>)[operation.stage??'']??'확인 필요'}</p>}
   {operation?.error&&<section className="mt-3 border-t pt-3"><h4>당시 실패 안내</h4><p>{orderInventoryErrorMessage(operation.error)}</p></section>}
   {stored&&<div role="status" className="mt-3 space-y-2 border-t pt-3"><p>{stored.message}</p>{stored.checks&&<ul>{stored.checks.map(check=><li key={check}>{check}</li>)}</ul>}{stored.failure&&<section><h4>당시 실패 안내</h4><p>{stored.failure}</p></section>}</div>}
   {fullRecoveryReadError&&<p role="alert">{fullRecoveryReadError}</p>}
   {evidence&&<section className="mt-3 border-t pt-3"><h4>현재 조회 근거</h4>{evidence.checks.map(check=><div key={check.label} className="mt-2"><p>{check.label}</p><p>{check.detail}</p></div>)}</section>}
   <details className="mt-3 text-xs text-slate-500"><summary>원작업 번호와 시작 시각</summary><p className="break-all">주문 {active.orderId}</p><p className="break-all">작업 {active.operationId}</p><p>{active.startedAt}</p></details>
  </ModalShell>}
 </>;
}
