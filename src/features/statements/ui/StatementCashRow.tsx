import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const fmt = (amount: number) => amount.toLocaleString('ko-KR');
const KIND_CLASS: Record<string, string> = {
  비용: 'text-rose-700', 수익: 'text-blue-700', 상환: 'text-violet-700', 차입: 'text-violet-700',
  예수: 'text-amber-700', 반환: 'text-amber-700', 자산: 'text-teal-700', 처분: 'text-teal-700',
};

export function StatementCashTableRow(props: {
  view: StatementHistoryRowView;
  direction: '입금' | '출금';
  shownAmount: number;
  partial: boolean;
  unallocated: number;
  classifications: string[];
  dateCell: ReactNode;
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen?: () => void;
}) {
  const { view, direction } = props;
  return <>
    <tr onClick={props.onOpen} className={`transition-colors hover:bg-slate-50 ${props.onOpen ? 'cursor-pointer' : ''}`}>
      <td className="whitespace-nowrap px-3 py-2" onClick={event => event.stopPropagation()}>{props.dateCell}</td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{view.owner ? <span className="font-bold">{view.owner}</span> : <span className="text-slate-300">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2"><span className="inline-flex items-center gap-1 align-middle">{props.journalToggle}<span className={`whitespace-nowrap text-[12px] font-black ${direction === '입금' ? 'text-emerald-600' : 'text-slate-600'}`}>{view.label}</span>{props.classifications.map(label => <span key={label} className={`text-[10px] font-black ${KIND_CLASS[label] ?? 'text-slate-500'}`}>{label}</span>)}</span></td>
      <td className="max-w-[180px] truncate px-3 py-2 font-bold text-slate-700" title={view.partner}>{view.partner || <span className="text-slate-300">—</span>}</td>
      <td className="max-w-[240px] truncate px-3 py-2 text-[10px] text-slate-500" title={view.detail}>{view.detail || <span className="font-bold text-amber-500">계정 미지정</span>}</td>
      <td className={`px-4 py-2 text-right font-black ${direction === '입금' ? 'text-emerald-600' : 'text-slate-800'}`}>{fmt(props.shownAmount)}{props.partial && <span className="block text-[10px] font-bold text-slate-400">통장 {fmt(view.amount)}</span>}</td>
      <td className="px-4 py-2 text-right">{view.cumulative !== undefined && <span className={`block font-black tabular-nums ${view.cumulative === 0 ? 'text-slate-300' : view.cumulative < 0 ? 'text-amber-600' : 'text-slate-600'}`}>{view.cumulative === 0 ? '0' : view.cumulative < 0 ? `−${fmt(Math.abs(view.cumulative))}` : fmt(view.cumulative)}</span>}{props.unallocated > 0 ? <span className="whitespace-nowrap text-[12px] font-black text-amber-600">미배분 {fmt(props.unallocated)}</span> : view.cumulative === undefined && <span className="text-slate-300">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-300">—</td><td className="whitespace-nowrap px-3 py-2 text-slate-300">—</td>
      <td className="max-w-[110px] truncate px-3 py-2 text-[10px] text-slate-400" title={view.note}>{view.note || '—'}</td>
    </tr>
    {props.journalPreview}
  </>;
}

export function StatementCashMobileRow(props: {
  view: StatementHistoryRowView;
  direction: '입금' | '출금';
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  const { view, direction } = props;
  const detail = [view.detail, view.note].filter(Boolean).join(' · ');
  return <div onClick={props.onOpen} className={`flex flex-col gap-1.5 px-4 py-3 ${props.onOpen ? 'cursor-pointer' : ''}`}>
    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1">{props.journalToggle}<span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${direction === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{view.label}</span></span><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-400">{view.date}</span>{props.onDelete && <button onClick={event => { event.stopPropagation(); props.onDelete?.(); }} className="text-slate-300 hover:text-rose-500" title="삭제"><Trash2 size={13}/></button>}</div></div>
    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-700">{view.partner || view.detail || '자금'}</span><span className={`shrink-0 text-sm font-black ${direction === '입금' ? 'text-emerald-600' : 'text-slate-800'}`}>{fmt(view.amount)}</span></div>
    {detail && <p className="truncate text-[11px] text-slate-400">{detail}</p>}
    {props.journalPreview}
  </div>;
}
