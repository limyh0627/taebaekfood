import { X } from 'lucide-react';

export default function StatementComposerHeader(props: {
  mode: '매출' | '매입' | '비용';
  twoSided: boolean;
  editingDocNo?: string;
  editMode: boolean;
  partnerName?: string;
  partnerPhone?: string;
  tradeDate: string;
  onTradeDate: (date: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { mode, twoSided, editingDocNo, editMode, partnerName, partnerPhone, tradeDate, onTradeDate, onNew, onClose } = props;
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-3 sm:gap-3 sm:px-5">
      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
        twoSided ? 'bg-amber-100 text-amber-700' : mode === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
        {twoSided ? '일반' : mode === '매출' ? '매출' : '매입'}전표
      </span>
      {editingDocNo && <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-400">[수정중] {editingDocNo}</span>}
      {partnerName
        ? <span className="font-black text-slate-900">{partnerName}</span>
        : <span className="text-sm font-bold text-slate-400">거래처를 선택하세요</span>}
      {partnerPhone && <span className="text-xs text-slate-400">{partnerPhone}</span>}
      <span className="text-slate-200">·</span>
      {editingDocNo && !editMode
        ? <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-700">{tradeDate}</span>
        : <input aria-label="전표일자" type="date" value={tradeDate} onChange={event => onTradeDate(event.target.value)}
            className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onNew} className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 transition-all hover:bg-slate-200">새 전표</button>
        <button aria-label="전표 작성 닫기" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100"><X size={18}/></button>
      </div>
    </div>
  );
}
