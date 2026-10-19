import { statementHistoryRowStyles as rowStyle } from './statementHistoryRowStyles';
import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const fmt = (amount: number) => amount.toLocaleString('ko-KR');
const overLabel = (type: '매출' | '매입') => type === '매출' ? '선수금' : '선급금';

function Balance(props: { amount: number; type: '매출' | '매입'; mobile?: boolean }) {
  const { amount, type, mobile } = props;
  if (amount === 0) return <span className={`${rowStyle.amount} font-black text-slate-400`}>0</span>;
  if (amount < 0) return <span className={`font-black whitespace-nowrap text-slate-500 ${rowStyle.amount}`}>−{fmt(Math.abs(amount))}<span className={`ml-1 align-middle ${rowStyle.meta} font-black text-slate-500`}>{overLabel(type)}</span></span>;
  return <span className={`${rowStyle.amount} font-black ${type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{mobile ? `잔액 ${fmt(amount)}` : fmt(amount)}</span>;
}

export function StatementPaymentTableRow(props: {
  view: StatementHistoryRowView;
  statementType: '매출' | '매입';
  dateCell: ReactNode;
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen: () => void;
}) {
  const { view, statementType } = props;
  return <>
    <tr className={`${rowStyle.row} cursor-pointer transition-colors hover:bg-slate-50`} onClick={props.onOpen}>
      <td className="whitespace-nowrap px-3 py-2" onClick={event => event.stopPropagation()}>{props.dateCell}</td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{view.owner ? <span className="font-bold">{view.owner}</span> : <span className="text-slate-300">—</span>}</td>
      <td className="px-3 py-2"><span className="inline-flex items-center gap-1 align-middle">{props.journalToggle}<span className={`whitespace-nowrap ${rowStyle.kind} font-black ${statementType === '매출' ? 'text-lime-700' : 'text-orange-600'}`}>{view.label}</span></span></td>
      <td className="max-w-[180px] px-3 py-2 font-bold text-slate-800" title={view.partner}>
        {/*  **업체명 밑에 배송지**(2026-09-16 사장님: "업체명 밑에 회색 글씨로 배송지명만
             표시해주면 어떠냐"). 배송지를 안 쓰는 거래처는 줄을 아예 안 그린다 —
             빈 줄을 두면 줄 높이만 늘고 읽을 것이 없다. */}
        <span className="block truncate">{view.partner}</span>
        {view.shipTo && <span className={`block truncate ${rowStyle.meta} font-bold text-slate-400`}>{view.shipTo}</span>}
      </td>
      <td className={`max-w-[240px] truncate px-3 py-2 ${rowStyle.meta} text-slate-500`}>{view.detail || '—'}</td>
      <td className={`px-4 py-2 text-right ${rowStyle.amount} font-black text-slate-800`}>{fmt(view.amount)}</td>
      <td className="px-4 py-2 text-right"><Balance amount={view.cumulative ?? 0} type={statementType}/></td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-300">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-300">—</td>
      <td className={`max-w-[110px] truncate px-3 py-2 ${rowStyle.meta} text-slate-400`} title={view.note}>{view.note || '—'}</td>
    </tr>
    {props.journalPreview}
  </>;
}

export function StatementPaymentMobileRow(props: {
  view: StatementHistoryRowView;
  statementType: '매출' | '매입';
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { view, statementType } = props;
  const memo = [view.detail, view.note].filter(Boolean).join(' · ');
  return <div onClick={props.onOpen} className={`${rowStyle.row} flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3`}>
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1">{props.journalToggle}<span className={`${rowStyle.kind} font-black ${statementType === '매출' ? 'text-lime-700' : 'text-orange-700'}`}>{view.label}</span></span>
      <div className="flex items-center gap-2"><span className={`font-mono ${rowStyle.meta} text-slate-400`}>{view.date}</span><button onClick={event => { event.stopPropagation(); props.onDelete(); }} className="text-slate-300 hover:text-rose-500" title="삭제"><Trash2 size={13}/></button></div>
    </div>
    <div className="flex items-center justify-between gap-2"><span className={`min-w-0 truncate ${rowStyle.body} font-bold text-slate-800`}>{view.partner}</span><span className={`shrink-0 ${rowStyle.amount} font-black text-slate-800`}>{fmt(view.amount)}</span></div>
    <div className="flex items-center justify-between gap-2"><span className={`min-w-0 flex-1 truncate ${rowStyle.meta} text-slate-400`}>{memo}</span><Balance amount={view.cumulative ?? 0} type={statementType} mobile/></div>
    {props.journalPreview}
  </div>;
}
