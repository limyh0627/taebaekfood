import React from 'react';
import { useCompanyInfoEditor, type CompanyInfoField } from '../hooks/useCompanyInfoEditor';
import { Save } from 'lucide-react';
import type { CompanyInfo, CompanyId } from '../../../shared/types';
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

export default function StatementCompanyDialog({ initial, companyId, actorUid, onClose, onSave }: {
  initial?: CompanyInfo | null;
  companyId: CompanyId;
  actorUid?: string;
  onClose: () => void;
  onSave?: (company: Partial<CompanyInfo>) => unknown | Promise<unknown>;
}) {
  const editor = useCompanyInfoEditor({initial, companyId, actorUid, onSave, onClose});
  const {form} = editor;
  return (
    <ModalShell title="회사 정보 설정" onClose={() => { editor.close(); }} bodyClassName="space-y-3" footer={
      <div className="flex gap-2">
        <button type="button" onClick={() => { editor.close(); }} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200">{editor.busy ? '닫기' : '취소'}</button>
        <button type="button" disabled={!editor.canSave} onClick={() => void editor.save()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white hover:bg-emerald-700">
          <Save size={13}/>{editor.busy ? '저장 중…' : editor.error ? '같은 입력 다시 저장' : '저장'}
        </button>
      </div>
    }>
          {editor.blockedReason && <p role="status" className="text-sm text-slate-600">{editor.blockedReason}</p>}
          {editor.busy && <p role="status" className="text-sm text-slate-600">저장 중입니다. 창을 닫아도 이미 보낸 저장은 취소되지 않습니다.</p>}
          {editor.error && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{editor.error}</p>}
          {FIELDS.map(field => (
            <div key={field.key} className="grid grid-cols-3 items-center gap-3">
              <label htmlFor={`statement-company-${field.key}`} className="text-right text-xs font-black text-slate-500">{field.label}</label>
              <input id={`statement-company-${field.key}`} type="text" placeholder={field.placeholder}
                value={String(form[field.key] ?? '')}
                disabled={editor.busy} onChange={event => editor.changeField(field.key, event.target.value)}
                className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
            </div>
          ))}
    </ModalShell>
  );
}
