import React from 'react';
import { useCompanyInfoEditor, type CompanyInfoEditorOptions, type CompanyInfoField } from '../hooks/useCompanyInfoEditor';
import { Save } from 'lucide-react';
import ModalShell from '../../../shared/components/ModalShell';

const FIELDS: { key: CompanyInfoField; label: string; placeholder: string }[] = [
  { key: 'name', label: '상호 (회사명)', placeholder: '(주)회사명' },
  { key: 'bizNo', label: '사업자등록번호', placeholder: '000-00-00000' },
  { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
  { key: 'address', label: '사업장 주소', placeholder: '경기도 ...' },
  { key: 'bizType', label: '업태', placeholder: '제조업' },
  { key: 'bizItem', label: '종목', placeholder: '식품 제조·판매' },
  { key: 'phone', label: '전화번호', placeholder: '031-000-0000' },
  { key: 'fax', label: '팩스번호', placeholder: '031-000-0000' },
  { key: 'email', label: '이메일', placeholder: 'info@company.com' },
  { key: 'bankAccount', label: '계좌번호', placeholder: '은행 000-0000-0000 ; 예금주' },
];

export type CompanyInfoRecoveryPorts = Omit<CompanyInfoEditorOptions, 'initial'|'companyId'|'actorUid'|'onSave'|'onClose'>;
export interface StatementCompanyDialogProps extends CompanyInfoEditorOptions { onClose:()=>void }
export default function StatementCompanyDialog(options: StatementCompanyDialogProps) {
  const editor = useCompanyInfoEditor(options);
  const {form} = editor;
  const notice = editor.error || editor.readError || editor.blockedReason;
  return (
    <ModalShell title="회사 정보 설정" onClose={() => { editor.close(); }} bodyClassName="space-y-3" footer={
      <div className="flex gap-2">
        <button type="button" onClick={() => { editor.close(); }} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200">{editor.busy || editor.locked ? '보기 닫기' : '취소'}</button>
        <button type="button" disabled={!editor.canSave} onClick={() => void editor.save()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white hover:bg-emerald-700">
          <Save size={13}/>{editor.openingBusy ? '원문 확인 중…' : editor.busy ? '저장 중…' : '저장'}
        </button>
      </div>
    }>
          {notice && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{notice}</p>}
          {editor.message && editor.message!==notice && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{editor.message}</p>}
          {editor.busy && <p role="status" className="text-sm text-slate-600">{editor.openingBusy ? '서버에서 선택한 회사정보 원문을 확인하고 있습니다.' : '처리 중입니다. 보기를 닫아도 이미 보낸 저장은 취소되지 않습니다.'}</p>}
          {editor.readLoading && !editor.busy && !editor.blockedReason && <p role="status" className="text-sm text-slate-600">보관된 회사정보 요청을 확인하고 있습니다.</p>}
          {editor.readError && <button type="button" disabled={editor.busy} onClick={()=>void editor.refresh()} className="rounded border border-slate-200 px-3 py-2 text-xs">보관 요청 다시 읽기</button>}
          {editor.operations.length>0 && <section aria-label="회사정보 요청 복구" className="max-h-60 space-y-3 overflow-y-auto rounded border border-slate-200 p-3 text-xs text-slate-600">
            <h3 className="font-bold">보관된 회사정보 요청</h3>
            {editor.operations.map(entry=><div key={entry.key} className="space-y-1 break-words">
              <p>{entry.description}</p>
              {entry.reference ? <><p>요청 번호: {entry.reference.planId}</p><div className="flex flex-wrap gap-2">
                <button type="button" disabled={editor.busy} onClick={()=>void editor.inspect(entry.reference!)} className="rounded border border-slate-200 px-3 py-2">결과 확인</button>
                {editor.canRetryEntry(entry) && <button type="button" disabled={editor.busy} onClick={()=>void editor.retry(entry.reference!)} className="rounded border border-slate-200 px-3 py-2">같은 요청 재시도</button>}
                <button type="button" disabled={editor.busy} onClick={()=>void editor.cancel(entry.reference!)} className="rounded border border-slate-200 px-3 py-2">미처리 요청 중단</button>
                {editor.canDiscardEntry(entry) && <button type="button" disabled={editor.busy} onClick={()=>void editor.discardCopy(entry.reference!,entry.observedLocalText,entry.observedReferenceText)} className="rounded border border-slate-200 px-3 py-2">이 기기 사본 정리</button>}
              </div>{entry.status!=='valid' && <p>원문을 확인할 수 없어 다시 보내지 않습니다. 결과 확인이나 미처리 요청 중단을 선택해 주세요.</p>}</> : <p>요청 번호를 확인할 수 없어 원문을 보존했습니다. 원문을 복구하기 전에는 다시 보내지 않습니다.</p>}
            </div>)}
            <p>요청 중단은 이미 저장된 회사정보를 되돌리지 않습니다. 기기 사본 정리는 서버의 업무 처리와 별개입니다.</p>
          </section>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={editor.busy || !editor.canReopenCurrent} onClick={()=>void editor.reopenCurrent()} className="rounded border border-slate-200 px-3 py-2 text-xs">현재 값으로 다시 열기</button>
            <button type="button" disabled={editor.busy || editor.historyLoading} onClick={()=>void editor.loadHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">서버 처리 이력 확인</button>
          </div>
          {editor.historyLoading && <p role="status" className="text-sm text-slate-600">서버 처리 이력을 확인하고 있습니다.</p>}
          {editor.historyError && <p role="status" className="text-sm text-slate-600">{editor.historyError}</p>}
          {editor.history.length>0 && <section aria-label="회사정보 서버 처리 이력" className="max-h-60 space-y-2 overflow-y-auto rounded border border-slate-200 p-3 text-xs text-slate-600">
            {editor.history.map(entry=><div key={entry.result.reference.planId} className="break-words"><p>{entry.createdAt} · 요청 {entry.result.reference.planId}</p><p>{entry.result.message}</p><button type="button" disabled={editor.busy} onClick={()=>void editor.inspect(entry.result.reference)} className="rounded border border-slate-200 px-3 py-2">이 요청 결과 확인</button></div>)}
          </section>}
          {editor.historyMore && <div><p className="text-xs text-slate-600">더 확인할 요청이 있습니다.</p><button type="button" disabled={editor.busy || editor.historyLoading} onClick={()=>void editor.nextHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">다음 이력 확인</button></div>}
          {FIELDS.map(field => (
            <div key={field.key} className="grid grid-cols-3 items-center gap-3">
              <label htmlFor={`statement-company-${field.key}`} className="text-right text-xs font-black text-slate-500">{field.label}</label>
              <input id={`statement-company-${field.key}`} type="text" placeholder={field.placeholder}
                value={String(form[field.key] ?? '')}
                disabled={editor.busy || editor.locked || editor.readLoading || !!editor.readError} onChange={event => editor.changeField(field.key, event.target.value)}
                className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
            </div>
          ))}
    </ModalShell>
  );
}
