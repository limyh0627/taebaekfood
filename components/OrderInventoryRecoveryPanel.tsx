import {orderInventoryErrorMessage,orderInventoryRecoveryChecks} from '../src/shared/orderInventoryError';
import React,{useEffect,useRef,useState} from 'react';
import {LockKeyhole} from 'lucide-react';
import ModalShell from '../src/shared/components/ModalShell';
import {useOutputScope} from '../src/shared/hooks/useOutputScope';
import {companyOf,type CompanyId,type Order} from '../src/shared/types';
import {appConfirm} from '../src/shared/components/appDialog';
import {clearPendingOrderInventoryRecovery,recoverOrderInventoryLock,readOrderInventoryRecoveryEvidence,type OrderInventoryRecoveryEvidence,type OrderInventoryEvidenceScope,type OrderInventoryResumeRun,type OrderInventoryRecoveryResult,type PendingOrderInventoryRecovery} from '../src/shared/services/orderInventoryRecoveryService';
interface Props {companyId:CompanyId;actorUid:string;orders:readonly Order[];pending?:readonly PendingOrderInventoryRecovery[];isCurrentActor?:()=>boolean;onRecovered:(result:OrderInventoryRecoveryResult,expectedSaved:string|null)=>void;onResumeLine?:(run:OrderInventoryResumeRun)=>Promise<unknown>|unknown}
type Entry={orderId:string;partnerName:string;operationId:string;startedAt:string;order?:Order;pending?:PendingOrderInventoryRecovery};
const entryKey=(entry:Entry)=>entry.orderId+':'+entry.operationId+':'+entry.startedAt;
type Notice={message:string;checks?:readonly string[];failure?:string};
const blockedNotice=(result:OrderInventoryRecoveryResult):Notice=>({message:'잠금을 유지합니다. '+orderInventoryErrorMessage(result.reason),checks:orderInventoryRecoveryChecks(result.reason),failure:result.failureMessage?orderInventoryErrorMessage(result.failureMessage):undefined});
export default function OrderInventoryRecoveryPanel({companyId,actorUid,orders,pending=[],isCurrentActor=()=>true,onRecovered,onResumeLine}:Props){
 const [messages,setMessages]=useState<Record<string,Notice>>({}),[busy,setBusy]=useState<string|null>(null),[selected,setSelected]=useState<Entry|null>(null),[evidence,setEvidence]=useState<OrderInventoryRecoveryEvidence|null>(null);
 const inFlight=useRef<symbol|null>(null),scope=useRef('');scope.current=companyId+':'+actorUid;
 const getSignal=useOutputScope(companyId,'order-recovery:'+actorUid);
 useEffect(()=>{scope.current=companyId+':'+actorUid;return()=>{scope.current='closed';};},[companyId,actorUid]);
 const latest=useRef(orders);latest.current=orders;
 const entries:Entry[]=orders.filter(order=>companyOf(order)===companyId&&!!order.inventoryOperation).map(order=>({orderId:order.id,partnerName:order.partnerName,operationId:order.inventoryOperation!.id,startedAt:order.inventoryOperation!.startedAt,order}));
 for(const saved of pending.filter(row=>row.companyId===companyId&&row.uid===actorUid)){const existing=entries.find(row=>row.orderId===saved.orderId&&row.operationId===saved.failedOperationId&&row.startedAt===saved.failedStartedAt);if(existing)existing.pending=saved;else entries.push({orderId:saved.orderId,partnerName:orders.find(row=>row.id===saved.orderId)?.partnerName??'',operationId:saved.failedOperationId,startedAt:saved.failedStartedAt,pending:saved});}
 const lineEntry=(entry:Entry)=>entry.order?.inventoryOperation?.kind==='line'||entry.order?.inventoryOperation?.state==='processing';
 const target=(entry:Entry)=>({orderId:entry.orderId,operationId:entry.operationId,startedAt:entry.startedAt,lineId:entry.order?.inventoryOperation?.lineId});
 function capture():OrderInventoryEvidenceScope{const captured=scope.current,signal=getSignal();return{companyId,uid:actorUid,signal,isCurrent:()=>scope.current===captured&&isCurrentActor()&&!signal.aborted};}
 const notice=(entry:Entry,message:string)=>setMessages(rows=>({...rows,[entryKey(entry)]:{message}}));
 async function inspect(entry:Entry){
  if(inFlight.current||!isCurrentActor()||getSignal().aborted)return;
  const run=Symbol(),captured=capture(),key=entryKey(entry);inFlight.current=run;setBusy(key);setSelected(entry);setEvidence(null);
  const valid=()=>inFlight.current===run&&captured.isCurrent();
  let expectedSaved:string|null=entry.pending?.expectedSaved??null;
  if(!entry.pending)try{expectedSaved=localStorage.getItem('order-cancellation:'+actorUid+':'+companyId+':'+entry.orderId);}catch{}
  const finish=(result:OrderInventoryRecoveryResult)=>{if(!valid())return;onRecovered(result,expectedSaved);if(!valid())return;clearPendingOrderInventoryRecovery(companyId,actorUid,result,expectedSaved);notice(entry,'작업 잠금을 해제했습니다. 원래 출고 취소·주문 삭제는 목록에서 다시 확인하고 승인해 주세요.');};
  try{
   if(lineEntry(entry)){const read=await readOrderInventoryRecoveryEvidence(captured,target(entry));if(valid()){setEvidence(read);notice(entry,read.reason||'현재 실패 줄과 근거를 조회했습니다. 같은 최초 작업을 계속할 수 있습니다.');}return;}
   const result=await recoverOrderInventoryLock(companyId,'inspect',entry.orderId,entry.operationId,entry.startedAt);if(!valid())return;
   if(result.status==='blocked'||result.inventoryApplied!=='none'){setMessages(rows=>({...rows,[key]:blockedNotice(result)}));return;}
   if(['recovered','duplicate'].includes(result.status)){finish(result);return;}
   if(result.status==='ready'){
    notice(entry,'재고 반영 없음이 확인되었습니다. 사용자 확인을 기다립니다.');
    const approved=await appConfirm({title:'실패 작업 잠금 해제',message:'서버에서 이 실패 작업의 재고·로트·수불부 반영이 없음을 확인했습니다. 작업 잠금만 해제할까요? 출고 취소·주문 삭제는 이후 새로 확인하고 승인합니다.',confirmText:'잠금 해제',tone:'amber'});
    if(!approved||!valid()||!latest.current.some(order=>order.id===entry.orderId&&order.inventoryOperation?.id===entry.operationId&&order.inventoryOperation.state==='failed'&&order.inventoryOperation.startedAt===entry.startedAt))return;
    const recovered=await recoverOrderInventoryLock(companyId,'recover',entry.orderId,entry.operationId,entry.startedAt,expectedSaved);if(!valid())return;
    if(['recovered','duplicate'].includes(recovered.status)&&recovered.inventoryApplied==='none')finish(recovered);else setMessages(rows=>({...rows,[key]:blockedNotice(recovered)}));
   }
  }catch(error){if(valid())setMessages(rows=>({...rows,[key]:{message:orderInventoryErrorMessage(error),checks:orderInventoryRecoveryChecks(undefined)}}));}
  finally{if(inFlight.current===run){inFlight.current=null;if(captured.isCurrent())setBusy(null);}}
 }
 async function resume(entry:Entry){
  if(inFlight.current||!onResumeLine||!isCurrentActor()||getSignal().aborted)return;
  let launched=false;const run=Symbol(),captured=capture();inFlight.current=run;setBusy(entryKey(entry));
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
 if(!entries.length)return null;
 const entryOrders=entries.filter((entry,index)=>entries.findIndex(row=>row.orderId===entry.orderId)===index);
 const active=selected,stored=active?messages[entryKey(active)]:undefined,operation=active?.order?.inventoryOperation;
 return <>{entryOrders.map(entry=><button key={entryKey(entry)} type="button" aria-label="잠금 이유 및 복구" title="잠금 이유 및 복구" disabled={busy!==null} onClick={()=>void inspect(entry)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-40"><LockKeyhole size={14}/></button>)}
  {active&&<ModalShell className="text-slate-700" title="주문 재고 작업 확인" subtitle={active.partnerName||'거래처 확인 필요'} onClose={()=>{if(!busy)setSelected(null);}} footer={<><button type="button" disabled={busy!==null} onClick={()=>void inspect(active)} className="rounded border px-3 py-2">다시 조회</button>{evidence?.canResume&&onResumeLine&&<button type="button" disabled={busy!==null} onClick={()=>void resume(active)} className="rounded border px-3 py-2">최초 작업 계속</button>}<button type="button" disabled={busy!==null} onClick={()=>setSelected(null)} className="rounded border px-3 py-2">주문으로 돌아가기</button></>}>
   {entries.filter(row=>row.orderId===active.orderId).length>1&&<label>확인할 작업<select aria-label="확인할 작업" disabled={busy!==null} value={entryKey(active)} onChange={event=>{const chosen=entries.find(row=>entryKey(row)===event.target.value);if(chosen)void inspect(chosen);}}>{entries.filter(row=>row.orderId===active.orderId).map((row,index)=><option key={entryKey(row)} value={entryKey(row)}>{row.order?'현재 잠금':'이전 요청 결과'} {index+1}</option>)}</select></label>}
   <p>주문 품목 {active.order?.items.length??'확인 필요'}개 · {operation?.state==='processing'?'처리 중':operation?.state==='failed'?'실패 작업':'이전 요청 결과 확인'}</p>
   {operation?.lineId&&<p>실패 줄: {(active.order?.items.findIndex(line=>line.lineId===operation.lineId)??-1)+1}번 · 단계: {({claim:'작업 시작',reservation:'재고 예약','raw-inventory':'원료 처리','production-record':'생산 기록','final-stock':'최종 재고 반영'} as Record<string,string>)[operation.stage??'']??'확인 필요'}</p>}
   {operation?.error&&<section className="mt-3 border-t pt-3"><h4>당시 실패 안내</h4><p>{orderInventoryErrorMessage(operation.error)}</p></section>}
   {stored&&<div role="status" className="mt-3 space-y-2 border-t pt-3"><p>{stored.message}</p>{stored.checks&&<ul>{stored.checks.map(check=><li key={check}>{check}</li>)}</ul>}{stored.failure&&<section><h4>당시 실패 안내</h4><p>{stored.failure}</p></section>}</div>}
   {evidence&&<section className="mt-3 border-t pt-3"><h4>현재 조회 근거</h4>{evidence.checks.map(check=><div key={check.label} className="mt-2"><p>{check.label}</p><p>{check.detail}</p></div>)}</section>}
   <details className="mt-3 text-xs text-slate-500"><summary>원작업 번호와 시작 시각</summary><p className="break-all">주문 {active.orderId}</p><p className="break-all">작업 {active.operationId}</p><p>{active.startedAt}</p></details>
  </ModalShell>}
 </>;
}
