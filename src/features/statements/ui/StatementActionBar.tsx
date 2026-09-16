import React from 'react';
import { Download, Edit2, Plus, Printer, Save, X } from 'lucide-react';

interface Props {
  editing: boolean;
  editMode: boolean;
  canIssue: boolean;
  saving: boolean;
  mode: string | null;
  issuePay: boolean;
  issuePayAmount: string;
  totalAmount: number;
  onIssuePayChange: (checked: boolean) => void;
  onIssuePayAmountChange: (value: string) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onIssue: () => void;
  onExcel: () => void;
}

/** 전표 작성·조회 하단의 저장/인쇄 동작을 한곳에서 그린다. */
export default function StatementActionBar(props: Props) {
  return <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-white flex-shrink-0 flex-wrap">
    <div className="ml-auto flex items-center gap-2 flex-wrap">
      {props.editing ? props.editMode ? <>
        <button onClick={props.onSaveEdit} disabled={props.saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-all">
          <Save size={13}/>{props.saving ? '저장 중…' : '저장'}
        </button>
        <button onClick={props.onPrint} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
          <Printer size={13}/>거래명세서
        </button>
      </> : <>
        <button onClick={props.onDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-black hover:bg-red-600 transition-all">
          <X size={13}/>삭제
        </button>
        <button onClick={props.onEdit} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 transition-all">
          <Edit2 size={13}/>수정
        </button>
        <button onClick={props.onPrint} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
          <Printer size={13}/>거래명세서
        </button>
      </> : props.canIssue ? <>
        <label className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-black cursor-pointer transition-all ${props.issuePay ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400'}`}>
          <input type="checkbox" checked={props.issuePay} onChange={e => props.onIssuePayChange(e.target.checked)} className="accent-emerald-600"/>
          {props.mode === '매출' ? '수금' : '지불'}도 함께
        </label>
        {props.issuePay && <div className="flex items-center gap-1">
          <input inputMode="numeric" value={props.issuePayAmount} onChange={e => props.onIssuePayAmountChange(e.target.value.replace(/[^\d]/g, ''))}
            className="w-28 text-right border border-emerald-300 rounded-xl px-2.5 py-2 text-xs font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
          <span className="text-[10px] font-black text-slate-400">원</span>
          {Math.round(Number(props.issuePayAmount) || 0) !== Math.round(props.totalAmount) && (
            <button type="button" onClick={() => props.onIssuePayAmountChange(String(Math.round(props.totalAmount)))} className="text-[10px] font-black text-emerald-600 hover:underline">전액</button>
          )}
        </div>}
        <button onClick={props.onIssue} disabled={props.saving}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${props.mode === '매출' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-rose-600 text-white hover:bg-rose-700'}`}>
          <Plus size={13} strokeWidth={3}/>{props.saving ? '저장 중…' : '저장'}
        </button>
        <span className="text-[10px] text-slate-400 font-bold self-center ml-1">저장 후 인쇄·엑셀 가능</span>
      </> : null}
      {props.editing && !props.editMode && <button onClick={props.onExcel}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">
        <Download size={13}/>엑셀
      </button>}
    </div>
  </div>;
}
