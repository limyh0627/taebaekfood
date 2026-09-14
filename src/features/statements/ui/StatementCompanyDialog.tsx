import React, { useState } from 'react';
import { Save, X } from 'lucide-react';
import type { CompanyInfo } from '../../../shared/types';

const EMPTY_COMPANY: CompanyInfo = {
  name: '', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '', phone: '', fax: '', email: '',
};

const FIELDS: { key: keyof CompanyInfo; label: string; placeholder: string }[] = [
  { key: 'name', label: '상호 (회사명)', placeholder: '(주)회사명' },
  { key: 'bizNo', label: '사업자등록번호', placeholder: '000-00-00000' },
  { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
  { key: 'address', label: '사업장 주소', placeholder: '경기도 ...' },
  { key: 'bizType', label: '업태', placeholder: '제조업' },
  { key: 'bizItem', label: '종목', placeholder: '식품 제조·판매' },
  { key: 'phone', label: '전화번호', placeholder: '031-000-0000' },
  { key: 'fax', label: '팩스번호', placeholder: '031-000-0000' },
  { key: 'email', label: '이메일', placeholder: 'info@company.com' },
];

export default function StatementCompanyDialog({ initial, onClose, onSave }: {
  initial?: CompanyInfo | null;
  onClose: () => void;
  onSave?: (company: CompanyInfo) => void;
}) {
  // 창이 열릴 때 새로 마운트되므로 당시 회사정보를 한 번 복사한다. 입력 중 외부 구독 갱신이
  // 폼을 덮으면 사용자가 적던 주소가 사라질 수 있어 이후에는 로컬 값만 편집한다.
  const [form, setForm] = useState<CompanyInfo>(() => ({ ...EMPTY_COMPANY, ...(initial ?? {}) }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="statement-company-title"
        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 id="statement-company-title" className="font-black text-slate-900">회사 정보 설정</h2>
          <button type="button" aria-label="닫기" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {FIELDS.map(field => (
            <div key={field.key} className="grid grid-cols-3 items-center gap-3">
              <label htmlFor={`statement-company-${field.key}`} className="text-right text-xs font-black text-slate-500">{field.label}</label>
              <input id={`statement-company-${field.key}`} type="text" placeholder={field.placeholder}
                value={String(form[field.key] ?? '')}
                onChange={event => setForm(prev => ({ ...prev, [field.key]: event.target.value }))}
                className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-6 pb-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200">취소</button>
          <button type="button" onClick={() => { onSave?.(form); onClose(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white hover:bg-emerald-700">
            <Save size={13}/>저장
          </button>
        </div>
      </div>
    </div>
  );
}
