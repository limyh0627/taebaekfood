import React,{useEffect,useRef} from 'react';
import type {Item,PartnerItem,AccountCode,AccountGroup} from '../../../shared/types';
import {filterCodesForContext} from '../../admin/financials';
import {usePartnerItemTermsEditor,type PartnerItemTermsEditor} from '../hooks/usePartnerItemTermsEditor';
import type {PartnerItemTermsBindings,PartnerItemTermsInput,PartnerItemTermsOutcome,PartnerItemTermsTarget} from '../infrastructure/partnerItemTermsWrites';
interface ServiceTermsProps extends PartnerItemTermsBindings {
 item:Item;partnerId:string;direction:'in'|'out';value?:PartnerItem;
 accountCodes:AccountCode[];accountGroups:AccountGroup[];
 onSave?:(input:PartnerItemTermsInput)=>Promise<PartnerItemTermsOutcome>;
 editor?:PartnerItemTermsEditor;
}
export function PartnerItemTermsRecovery({editor,showMessage=true}:{editor:PartnerItemTermsEditor;showMessage?:boolean}){
 const matches=(a:import('../infrastructure/partnerItemTermsWrites').PartnerItemTermsReference|null,b:import('../infrastructure/partnerItemTermsWrites').PartnerItemTermsReference)=>!!a&&a.companyId===b.companyId&&a.targetId===b.targetId&&a.planId===b.planId&&editor.keyFor(a)===editor.keyFor(b);
 const rows=editor.references.map(row=>({
  ...row,description:row.description??'거래조건 요청 · 대상 '+(row.reference?.targetId??'번호 확인 불가')
 }));
 for(const pending of editor.pending){
  if(!rows.some(row=>matches(row.reference,pending.reference)))rows.push({key:pending.reference.planId,reference:pending.reference,readable:true,description:pending.description,observedLocalText:pending.observedLocalText});
 }
 return <>
  {showMessage&&editor.message&&<p role="status" className="whitespace-pre-line text-xs text-slate-600">{editor.message}</p>}
  {rows.length>0&&<section aria-label="처리 결과 확인이 필요한 거래조건" className="max-h-60 min-w-0 shrink-0 space-y-2 overflow-y-auto break-words rounded-lg border border-slate-200 p-3">
   <h3 className="text-sm font-bold text-slate-700">처리 결과 확인이 필요한 거래조건</h3>
   {rows.map(row=><div key={row.key} className="flex flex-wrap items-center gap-2 text-xs">
    <span>{row.description}{row.reference&&' · 요청 '+row.reference.planId}</span>
    {row.reference&&<>
     <button type="button" disabled={editor.busy} onClick={()=>void editor.inspect(row.reference!)} className="rounded border border-slate-200 px-3 py-2">결과 확인</button>
     <button type="button" disabled={editor.busy} onClick={()=>void editor.cancel(row.reference!)} className="rounded border border-slate-200 px-3 py-2">요청 중단</button>
     {typeof row.observedLocalText==='string'&&<button type="button" disabled={editor.busy} onClick={()=>void editor.discard(row.reference!,row.observedLocalText!)} className="rounded border border-slate-200 px-3 py-2">이 기기 사본 정리</button>}
    </>}
   </div>)}
   <p className="text-xs text-slate-600">요청 중단은 미처리 요청의 늦은 실행을 막습니다. 사본 정리는 이 기기의 기록만 지우며 이미 저장된 거래조건을 되돌리지 않습니다.</p>
  </section>}
 </>;
}
function Fields({editor,item,partnerId,direction,value,accountCodes,accountGroups}:ServiceTermsProps&{editor:PartnerItemTermsEditor}){
 const target:PartnerItemTermsTarget={itemId:item.id,partnerId,direction,...(value?.id?{existingLinkId:value.id}:{}),opening:value??null};
 const key=editor.keyFor(target),selection=useRef({key,target});
 if(selection.current.key!==key)selection.current={key,target};
 const eligibleCodes=filterCodesForContext(accountCodes,accountGroups,direction==='out'?'매출':'매입');
 useEffect(()=>{editor.open(selection.current.target,undefined,'service',eligibleCodes.map(row=>row.code));},[key]);
 const draft=editor.draftFor(key),locked=editor.locked(key)||!draft;
 const completed=!draft&&editor.outcomes[key]?.status==='saved'||!!editor.outcomes[key]?.requiresReopen||editor.copyCleared(key);
 return <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2" onClick={e=>e.stopPropagation()}>
  <label className="text-[10px] font-bold text-slate-500">단가<input aria-label="용역 단가" type="number" min="0" disabled={locked} value={draft?.price??''} onChange={e=>editor.change(key,'price',e.target.value)} className="block w-28 rounded-md border border-slate-200 px-2 py-1 text-xs"/></label>
  <label className="text-[10px] font-bold text-slate-500">과세<select aria-label="용역 과세 여부" disabled={locked} value={draft?.taxType??''} onChange={e=>editor.change(key,'taxType',e.target.value)} className="block rounded-md border border-slate-200 px-2 py-1 text-xs"><option value="">선택</option><option value="과세">과세</option><option value="면세">면세</option></select></label>
  <label className="text-[10px] font-bold text-slate-500">계정과목<select aria-label="용역 계정과목" disabled={locked} value={draft?.Account_Code??''} onChange={e=>editor.change(key,'Account_Code',e.target.value)} className="block max-w-44 rounded-md border border-slate-200 px-2 py-1 text-xs"><option value="">선택</option>{eligibleCodes.map(row=><option key={row.id} value={row.code}>{row.code} {row.name}</option>)}</select></label>
  {completed?<button type="button" onClick={()=>editor.reopen(target,undefined,'service',eligibleCodes.map(row=>row.code))} className="rounded border border-slate-200 px-3 py-1.5 text-xs font-bold">거래조건 수정</button>:<button type="button" disabled={locked} onClick={()=>void editor.submit(key)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{editor.busyKey===key?'저장 중…':'저장'}</button>}
 </div>;
}
function Standalone(props:ServiceTermsProps){
 const editor=usePartnerItemTermsEditor({scopeKey:(props.item.companyId??'taebaek')+':'+(props.requestScopeKey??''),onSave:props.onSave??props.onSavePartnerItemTerms,readPending:props.onReadPendingPartnerItemTerms,readReferences:props.onReadPartnerItemTermsReferences,inspect:props.onInspectPartnerItemTerms,cancel:props.onCancelPartnerItemTerms,discard:props.onDiscardPartnerItemTermsCopy});
 return <><Fields {...props} editor={editor}/><PartnerItemTermsRecovery editor={editor}/></>;
}
export const ServiceTerms:React.FC<ServiceTermsProps>=props=>props.editor?<Fields {...props} editor={props.editor}/>:<Standalone key={(props.item.companyId??'taebaek')+':'+(props.requestScopeKey??'')} {...props}/>;
