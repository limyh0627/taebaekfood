import React,{useState} from 'react';
import ModalShell from '../../../shared/components/ModalShell';
import {unitOf} from '../../../constants/formula';
import {useRawManualCorrection,type RawManualContext} from '../hooks/useRawManualCorrection';
type Props=RawManualContext&{onClose:()=>void;onApplied?:()=>void;onBackdated?:()=>Promise<unknown>;onOpenDraft:(material:string,originalId:string)=>void};
const inputClass='h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs';
const buttonClass='min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40';
export default function RawManualCorrectionForm(props:Props){
 const control=useRawManualCorrection(props),[copyOpen,setCopyOpen]=useState(false);
 const {draft,selected}=control,entry=selected?.entry,result=control.confirmed?.copy.entry.request?.operationId===entry?.request?.operationId?control.confirmed?.result:entry?.result;
 return <div className="space-y-2 text-xs">
  <button type="button" className={buttonClass} onClick={control.openRecovery}>원료 정정 보관 {control.entries.length}</button>
  {props.originalId&&<div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
   <p className="font-bold">정정 추가 · {draft.material} · 원기록 {draft.originalId}</p>
   <div className="flex flex-wrap items-center gap-2">
    <input aria-label="정정 날짜" type="date" className={inputClass} value={draft.date} disabled={!control.editable} onChange={event=>control.updateDraft({date:event.target.value})}/>
    <select aria-label="정정 종류" className={inputClass} value={draft.mode??(draft.isNegative?'neg':'pos')} disabled={!control.editable} onChange={event=>control.updateDraft({mode:event.target.value as 'neg'|'pos'|'stocktake',isNegative:event.target.value!=='pos'})}>
     <option value="neg">사용량 감소 (−)</option><option value="pos">사용량 증가 (+)</option><option value="stocktake">실사 — 잔량을 이 값으로</option>
    </select>
    <input aria-label="정정 수량" type="number" min="0" step="0.001" className={inputClass+' w-28'} placeholder={draft.mode==='stocktake'?`실사 잔량(${unitOf(draft.material)})`:`수량(${unitOf(draft.material)})`} value={draft.amount} disabled={!control.editable} onChange={event=>control.updateDraft({amount:event.target.value})}/>
    <input aria-label="정정 비고" className={inputClass+' min-w-32 flex-1'} placeholder="비고" value={draft.note} disabled={!control.editable} onChange={event=>control.updateDraft({note:event.target.value})}/>
    <button type="button" className={buttonClass} disabled={control.busy||!control.editable} onClick={()=>void control.run('apply')}>저장</button>
    <button type="button" className={buttonClass} disabled={control.busy} onClick={props.onClose}>닫기</button>
   </div>
   <p className="text-slate-600">입력과 요청은 이 기기에 보관합니다. 창을 닫거나 로그아웃해도 서버에 접수된 정정을 취소하지 않습니다.</p>
  </div>}
  {control.storageError&&<div role="alert" className="space-y-2"><p>{control.storageError}</p><button className={buttonClass} onClick={()=>void control.retryCheckpoint()}>다시 보관</button><button className={buttonClass} onClick={()=>setCopyOpen(true)}>입력 원문 복사</button><button className={buttonClass} onClick={control.readAgain}>보관 요청 다시 읽기</button>{copyOpen&&<textarea aria-label="복사할 정정 입력" readOnly className="w-full border border-slate-300 p-2" value={control.localDraftText}/>}</div>}
  {control.notice&&!control.recoveryOpen&&<p role="status">{control.notice}</p>}
  {control.recoveryOpen&&<ModalShell title="원료 정정 처리 확인" onClose={control.closeRecovery} bodyClassName="space-y-3 text-xs" footer={<button className={buttonClass} disabled={control.busy} onClick={control.closeRecovery}>닫기</button>}>
   {control.notice&&<p role="status">{control.notice}</p>}
   {control.confirmed&&<div><p>서버 처리 결과 확정 · 기기 기록 갱신 실패</p><button className={buttonClass} disabled={control.busy} onClick={()=>void control.retryConfirmed()}>확인 결과 다시 보관</button></div>}
   {!selected?<>
    <p>현재 계정이 이 기기에 보관한 모든 원료의 초안과 최초 요청입니다. 다른 원료도 여기서 찾을 수 있습니다.</p>
    {control.entries.length===0&&<p>보관된 요청이 없습니다. 서버 미처리 여부를 뜻하지 않습니다.</p>}
    {control.entries.map(row=><button className={buttonClass+' block w-full text-left'} key={row.key} disabled={control.busy} onClick={()=>control.select(row.copy,row.encoded)}>{row.copy?`${row.copy.entry.draft.material} · ${row.copy.entry.draft.amount||'미입력'} · ${row.copy.entry.state==='draft'?'작성 초안':row.copy.entry.state==='prepared'?'전송 전 요청':row.copy.entry.state==='terminal'?'확인 결과 보관':'처리 결과 미확인'}`:row.error}</button>)}
    {control.damagedText&&<textarea aria-label="보존된 손상 원문" value={control.damagedText} readOnly className="w-full border border-slate-300 p-2"/>}
   </>:<>
    <p className="font-bold">{entry!.draft.material} · {entry!.draft.amount} · {entry!.draft.date}</p>
    {entry!.request&&<p className="break-all">정정 번호: {entry!.request.operationId}</p>}
    <p>원입력: {entry!.draft.mode==='stocktake'?'실사 잔량':entry!.draft.isNegative?'사용량 감소':'사용량 증가'} · {entry!.draft.note||'비고 없음'}</p>
    {entry!.state==='draft'?<><p>아직 전송하지 않은 작성 초안입니다.</p><button className={buttonClass} onClick={()=>control.openDraft(selected)}>보관된 초안 열기</button></>:<>
     {entry!.state==='prepared'&&<p>최초 요청을 보관했고 아직 전송 결과를 확인하지 않았습니다.</p>}
     {entry!.state==='submitted'&&!control.confirmed&&<p>처리 결과가 미확인입니다. 조회가 없거나 실패해도 미처리로 확정하지 않습니다.</p>}
     {result?.status==='applied'&&<p>이 요청의 원적용을 확인했습니다. 이후의 원장 수정이나 역분개 여부는 별도로 확인하세요.</p>}
     {result?.status==='cancelled'&&<p>미처리 중단을 확인했습니다. 이미 적용한 재고를 되돌린 작업은 아닙니다.</p>}
     {result?.status==='rejected'&&<p>이 요청은 적용하지 않고 종결했습니다. 입력을 확인해 새 정정을 시작할 수 있습니다.</p>}
     {result?.status==='conflict'&&<p>처리 근거와 최초 요청이 다릅니다. 원문을 보존하고 관리자에게 확인해 주세요.</p>}
     <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={control.busy} onClick={()=>void control.run('inspect',selected)}>처리 결과 조회</button>
      {entry!.state!=='terminal'&&!control.confirmed&&result?.status!=='conflict'&&<><button className={buttonClass} disabled={control.busy} onClick={()=>void control.run('apply',selected)}>같은 요청 재시도</button><button className={buttonClass} disabled={control.busy} onClick={()=>void control.run('cancel',selected)}>미처리 요청 중단</button></>}
      {(entry!.state==='terminal'||entry!.state==='prepared')&&<button className={buttonClass} disabled={control.busy} onClick={()=>void control.startNew(selected)}>{entry!.state==='prepared'?'전송 전 요청을 입력으로 돌리기':'입력 복사해 새 작업 시작'}</button>}
     </div>
    </>}
    <button className={buttonClass} disabled={control.busy} onClick={()=>control.select(null)}>보관 목록으로</button>
   </>}
   <button className={buttonClass} disabled={control.busy} onClick={control.readAgain}>보관 요청 다시 읽기</button>
  </ModalShell>}
 </div>;
}
