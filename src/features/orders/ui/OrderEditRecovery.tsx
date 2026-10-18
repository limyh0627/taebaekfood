import type {useOrderEditApplication} from '../hooks/useOrderEditApplication';
interface OrderEditRecoveryProps {
 application:ReturnType<typeof useOrderEditApplication>;
 orderId?:string;
 allTargets?:boolean;
 actionsEnabled?:boolean;
 includeScopeMessage?:boolean;
}
export function OrderEditRecovery({application,orderId,allTargets=false,actionsEnabled=true,includeScopeMessage=false}:OrderEditRecoveryProps){
 const pending=application.pendingEdits.filter(entry=>allTargets||entry.id===orderId);
 const damaged=application.damagedReferences.filter(entry=>allTargets||entry.id===orderId);
 const message=application.message&&(allTargets?application.messageTargetId!==null:application.messageTargetId===orderId||includeScopeMessage&&application.messageTargetId===null)?application.message:'';
 if(!actionsEnabled&&!message)return null;
 if(allTargets&&!pending.length&&!damaged.length)return null;
 if(!allTargets&&!message&&!pending.length&&!damaged.length)return null;
 return <section aria-label={allTargets?'처리 결과 확인이 필요한 주문 수정':undefined} className="space-y-2 text-xs text-slate-600">
  {allTargets&&<p className="font-bold">처리 결과 확인이 필요한 주문 수정</p>}
  {message&&<p role="status" className="whitespace-pre-line">{message}</p>}
  {actionsEnabled&&pending.map(entry=><div key={entry.planId} className="flex flex-wrap gap-3"><span>{allTargets?'대상 주문 '+entry.id+' · ':''}{entry.description}</span><button type="button" disabled={application.busy} className="underline" onClick={()=>application.inspect(entry)}>주문 수정 결과 확인</button><button type="button" disabled={application.busy} className="underline" onClick={()=>application.cancel(entry)}>주문 수정 요청 중단</button></div>)}
  {actionsEnabled&&damaged.map(entry=><div key={entry.planId} className="flex flex-wrap gap-3">{allTargets&&<span>대상 주문 {entry.id}</span>}<button type="button" disabled={application.busy} className="underline" onClick={()=>application.cancelDamaged(entry)}>손상된 주문 수정 요청 중단</button></div>)}
 </section>;
}
