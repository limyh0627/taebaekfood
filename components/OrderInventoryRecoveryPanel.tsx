import {orderInventoryErrorMessage} from '../src/shared/orderInventoryError';
import React,{useEffect,useRef,useState} from 'react';
import {companyOf,type CompanyId,type Order} from '../src/shared/types';
import {appConfirm} from '../src/shared/components/appDialog';
import {clearPendingOrderInventoryRecovery,recoverOrderInventoryLock,type OrderInventoryRecoveryResult,type PendingOrderInventoryRecovery} from '../src/shared/services/orderInventoryRecoveryService';
interface Props {companyId:CompanyId;actorUid:string;orders:readonly Order[];pending?:readonly PendingOrderInventoryRecovery[];isCurrentActor?:()=>boolean;onRecovered:(result:OrderInventoryRecoveryResult,expectedSaved:string|null)=>void}
type Entry={orderId:string;partnerName:string;operationId:string;startedAt:string;pending?:PendingOrderInventoryRecovery};
const entryKey=(entry:Entry)=>entry.orderId+':'+entry.operationId+':'+entry.startedAt;
export default function OrderInventoryRecoveryPanel({companyId,actorUid,orders,pending=[],isCurrentActor=()=>true,onRecovered}:Props){
 const [messages,setMessages]=useState<Record<string,string>>({}),[busy,setBusy]=useState<string|null>(null);const inFlight=useRef(false),scope=useRef('');scope.current=companyId+':'+actorUid;
 useEffect(()=>()=>{scope.current='closed';},[]);
 const latest=useRef(orders);latest.current=orders;
 const entries:Entry[]=orders.filter(order=>companyOf(order)===companyId&&order.inventoryOperation?.state==='failed').map(order=>({orderId:order.id,partnerName:order.partnerName,operationId:order.inventoryOperation!.id,startedAt:order.inventoryOperation!.startedAt}));
 for(const saved of pending.filter(row=>row.companyId===companyId&&row.uid===actorUid)){
  const existing=entries.find(row=>row.orderId===saved.orderId&&row.operationId===saved.failedOperationId&&row.startedAt===saved.failedStartedAt);
  if(existing)existing.pending=saved;else entries.push({orderId:saved.orderId,partnerName:orders.find(row=>row.id===saved.orderId)?.partnerName??'',operationId:saved.failedOperationId,startedAt:saved.failedStartedAt,pending:saved});
 }
 async function inspect(entry:Entry){if(inFlight.current||!isCurrentActor())return;const {orderId,operationId,startedAt:failedStartedAt}=entry,initialScope=scope.current,key=entryKey(entry);
 let expectedSaved:string|null=entry.pending?.expectedSaved??null;if(!entry.pending)try{expectedSaved=localStorage.getItem('order-cancellation:'+actorUid+':'+companyId+':'+orderId);}catch{}
 inFlight.current=true;setBusy(key);const valid=()=>scope.current===initialScope&&isCurrentActor();
 const finish=(result:OrderInventoryRecoveryResult)=>{if(!valid())return;onRecovered(result,expectedSaved);if(!valid())return;clearPendingOrderInventoryRecovery(companyId,actorUid,result,expectedSaved);setMessages(m=>({...m,[key]:'작업 잠금을 해제했습니다. 원래 출고 취소·주문 삭제는 목록에서 다시 확인하고 승인해 주세요.'}));};
 try{
  const result=await recoverOrderInventoryLock(companyId,'inspect',orderId,operationId,failedStartedAt);if(!valid())return;
  if(result.status==='blocked'||result.inventoryApplied!=='none'){setMessages(m=>({...m,[key]:'잠금을 유지합니다. '+orderInventoryErrorMessage(result.failureMessage??result.reason)}));return;}
  if(['recovered','duplicate'].includes(result.status)){finish(result);return;}
  if(result.status==='ready'){
   setMessages(m=>({...m,[key]:'재고 반영 없음이 확인되었습니다. 사용자 확인을 기다립니다.'}));
   const approved=await appConfirm({title:'실패 작업 잠금 해제',message:'서버에서 이 실패 작업의 재고·로트·수불부 반영이 없음을 확인했습니다. 작업 잠금만 해제할까요? 출고 취소·주문 삭제는 이후 새로 확인하고 승인합니다.',confirmText:'잠금 해제',tone:'amber'});
   if(!approved||!valid()||!latest.current.some(candidate=>candidate.id===orderId&&candidate.inventoryOperation?.id===operationId&&candidate.inventoryOperation.state==='failed'&&candidate.inventoryOperation.startedAt===failedStartedAt))return;
   const recovered=await recoverOrderInventoryLock(companyId,'recover',orderId,operationId,failedStartedAt,expectedSaved);if(!valid())return;
   if(['recovered','duplicate'].includes(recovered.status)&&recovered.inventoryApplied==='none')finish(recovered);
   else setMessages(m=>({...m,[key]:'잠금을 유지합니다. '+orderInventoryErrorMessage(recovered.failureMessage??recovered.reason)}));
  }
 }catch(error){if(valid())setMessages(m=>({...m,[key]:orderInventoryErrorMessage(error)}));}
 finally{inFlight.current=false;if(valid())setBusy(null);}}
 if(!entries.length)return null;
 return <div aria-label="실패 재고 작업 확인" className="mt-3 border-t border-amber-200 pt-2"><p className="text-xs font-bold">실패한 주문 재고 작업</p>{entries.map(entry=>{const key=entryKey(entry);return <div key={key} className="mt-2"><button type="button" disabled={busy!==null} onClick={()=>void inspect(entry)} className="text-sm font-bold text-indigo-700 underline">{busy===key?'재고 작업 확인 중':entry.pending?'잠금 해제 결과 확인':'작업 확인·잠금 해제'} · {entry.partnerName} · {entry.orderId}</button>{messages[key]&&<p role="status" className="mt-1 text-xs">{messages[key]}</p>}</div>;})}</div>;
}
