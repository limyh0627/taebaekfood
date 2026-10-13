import React,{useEffect,useState,useRef} from 'react';
import ModalShell from '../src/shared/components/ModalShell';
import {listOrderInterpretationRules,reviewOrderInterpretationRule} from '../src/shared/services/orderCopyService';
import type {CompanyId} from '../src/shared/types';

interface Props{companyId:CompanyId;actorUid:string;isAdmin:boolean;onClose:()=>void;onChanged?:()=>void;isCurrentActor?:()=>boolean;}
export default function OrderInterpretationRules({companyId,actorUid,isAdmin,onClose,onChanged,isCurrentActor}:Props){
 const scope=useRef({companyId,actorUid});if(scope.current.companyId!==companyId||scope.current.actorUid!==actorUid)scope.current={companyId,actorUid};
 const alive=useRef(true);React.useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [rules,setRules]=useState<Awaited<ReturnType<typeof listOrderInterpretationRules>>>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true;setRules([]);setError('');if(isAdmin&&actorUid)void listOrderInterpretationRules(companyId,true).then(rows=>{if(alive&&(!isCurrentActor||isCurrentActor()))setRules(rows);}).catch(reason=>{if(alive&&(!isCurrentActor||isCurrentActor()))setError(reason instanceof Error?reason.message:String(reason));});return()=>{alive=false;};},[companyId,actorUid,isAdmin,revision]);
 return <ModalShell title="복사주문 판독 규칙" onClose={()=>{if(!busy)onClose();}} layer={1400}>
  <p>서로 다른 주문의 확정 기록 3건 이상으로 제안된 별칭입니다. 승인한 규칙만 다음 판독에 적용합니다. 다른 품목으로 확정된 별칭은 추천을 중단합니다.</p>
  {!isAdmin?<p>현재 회사 관리자만 규칙을 승인하거나 중지할 수 있습니다.</p>:<>
   {error&&<p role="alert">{error}</p>}{!rules.length&&!error&&<p>확인할 판독 규칙이 없습니다.</p>}
   {rules.map(rule=><section key={rule.ruleId} className="space-y-2 border-b border-slate-200 py-4"><p>{rule.alias} · 거래처 {rule.partnerId} · {rule.itemId} · {{proposed:'승인 대기',approved:'승인됨',stopped:'적용 중지'}[rule.status]} · 확정 기록 {new Set(rule.captureIds).size}건</p><div className="flex flex-wrap gap-2">
    {(['approve','stop'] as const).map(action=><button type="button" key={action} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50" disabled={busy||action==='approve'&&(rule.status!=='proposed'||(new Set(rule.captureIds).size<3||new Set(rule.orderIds).size<3))||action==='stop'&&rule.status==='stopped'} onClick={async()=>{const captured=scope.current,current=()=>alive.current&&scope.current===captured&&(!isCurrentActor||isCurrentActor());if(!actorUid||!current())return;setBusy(true);try{await reviewOrderInterpretationRule({companyId,ruleId:rule.ruleId,expectedRevision:rule.revision,action});if(current()){setRevision(value=>value+1);onChanged?.();}}catch(reason){if(current())setError(reason instanceof Error?reason.message:String(reason));}finally{if(current())setBusy(false);}}}>{action==='approve'?'승인':'중지'}</button>)}
   </div></section>)}
  </>}
 </ModalShell>;
}
