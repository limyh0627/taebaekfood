import { statementHistoryRowStyles as rowStyle } from './statementHistoryRowStyles';
import type { ReactNode } from 'react';
import type { IssuedStatement } from '../../../shared/types';
import type { SettleStatus } from '../../admin/voucherMerge';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';
import { settlementTypeOf } from '../../admin/voucherMerge';

const fmt = (amount: number) => amount.toLocaleString('ko-KR');
const overLabel = (type: string) => type === '매출' ? '선수금' : '선급금';

function Balance({ view, type, mobile }: { view: StatementHistoryRowView; type: string; mobile?: boolean }) {
  const amount = view.cumulative;
  if (amount == null) return <span className="font-black text-slate-300" title="거래처가 없는 전표">—</span>;
  if (amount === 0) return <span className={`${rowStyle.amount} font-black text-slate-400`}>0</span>;
  if (amount < 0) return <span className={`shrink-0 whitespace-nowrap font-black text-slate-500 ${rowStyle.amount}`}>−{fmt(Math.abs(amount))}<span className={`ml-1 align-middle ${rowStyle.meta}`}>{overLabel(type)}</span></span>;
  return <span className={`${rowStyle.amount} shrink-0 font-black ${type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{mobile ? `잔액 ${fmt(amount)}` : fmt(amount)}</span>;
}

export function StatementTradeTableRow(props: {
  statement: IssuedStatement;
  view: StatementHistoryRowView;
  shownAmount: number;
  partial: boolean;
  settle: SettleStatus;
  canSettle: boolean;
  //  **읽기만 한다**(`readonly`) — `evidenceChoices()` 가 상수 목록을 그대로 돌려주므로
  //  `string[]` 로 받으면 "고칠 수 있는 배열" 을 요구하는 셈이라 타입이 안 맞는다.
  evidenceChoices: readonly string[];
  evidence: string;
  dateCell: ReactNode;
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen: () => void;
  onSettle: () => void;
  onEvidence?: (evidence: string) => void;
}) {
  const { statement, view } = props;
  const settleColor = props.settle.state === 'done' ? 'text-emerald-600' : props.settle.state === 'partial' ? 'text-amber-600' : props.settle.state === 'open' ? 'text-slate-600' : 'text-slate-300';
  return <>
    <tr className={`${rowStyle.row} cursor-pointer transition-colors hover:bg-slate-50`} onClick={props.onOpen}>
      <td className="whitespace-nowrap px-3 py-2" onClick={event => event.stopPropagation()}>{props.dateCell}</td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{view.owner ? <span className="font-bold">{view.owner}</span> : <span className="text-slate-300">—</span>}</td>
      <td className="px-3 py-2"><div className="flex items-center gap-1">{props.journalToggle}<span className={`whitespace-nowrap ${rowStyle.kind} font-black ${statement.type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{view.label}</span>{view.isReturn && <span className={`whitespace-nowrap ${rowStyle.kind} font-black text-amber-600`}>반품</span>}</div></td>
      <td className="max-w-[180px] px-3 py-2 font-bold text-slate-800" title={view.partner}>
        {/*  **업체명 밑에 배송지**(2026-09-16 사장님: "업체명 밑에 회색 글씨로 배송지명만
             표시해주면 어떠냐"). 배송지를 안 쓰는 거래처는 줄을 아예 안 그린다 —
             빈 줄을 두면 줄 높이만 늘고 읽을 것이 없다. */}
        <span className="block truncate">{view.partner}</span>
        {view.shipTo && <span className={`block truncate ${rowStyle.meta} font-bold text-slate-400`}>{view.shipTo}</span>}
      </td>
      <td className={`max-w-[240px] truncate px-3 py-2 ${rowStyle.meta} text-slate-500`} title={view.detail}>{view.detail || '—'}</td>
      <td className={`px-4 py-2 text-right ${rowStyle.amount} font-black ${view.isReturn ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(props.shownAmount)}{props.partial && <span className={`block ${rowStyle.meta} font-bold text-slate-400`}>전표 {fmt(view.amount)}</span>}</td>
      <td className="px-4 py-2 text-right"><Balance view={view} type={statement.type}/></td>
      <td className="whitespace-nowrap px-3 py-2"><span className="flex items-center gap-1.5"><span className={`font-black ${settleColor}`}>{props.settle.label}</span>{props.canSettle && <button onClick={event => { event.stopPropagation(); props.onSettle(); }} className={`shrink-0 whitespace-nowrap ${rowStyle.action} font-black underline decoration-dotted underline-offset-2 ${settlementTypeOf(statement) === '매입' ? 'text-rose-600 hover:text-rose-700' : 'text-blue-600 hover:text-blue-700'}`}>{settlementTypeOf(statement) === '매입' ? '지불처리' : '수금처리'}</button>}</span></td>
      {!props.evidenceChoices.length ? <td className="whitespace-nowrap px-3 py-2 text-slate-300">—</td> : <td className="whitespace-nowrap px-3 py-2" onClick={event => event.stopPropagation()}><select value={props.evidence} disabled={!props.onEvidence} onChange={event => props.onEvidence?.(event.target.value)} aria-label={`${view.partner} 증빙`} className={`h-6 cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 ${rowStyle.action} font-black text-slate-700 outline-none focus:ring-1 focus:ring-indigo-400 disabled:cursor-default disabled:opacity-60`}>{props.evidenceChoices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></td>}
      <td className="px-3 py-2 text-slate-300">—</td>
    </tr>
    {props.journalPreview}
  </>;
}

export function StatementTradeMobileRow(props: {
  statement: IssuedStatement;
  view: StatementHistoryRowView;
  dateLabel: string;
  canSettle: boolean;
  journalToggle: ReactNode;
  journalPreview?: ReactNode;
  onOpen: () => void;
  onSettle: () => void;
}) {
  const { statement, view } = props;
  return <div onClick={props.onOpen} className={`${rowStyle.row} flex cursor-pointer flex-col gap-1.5 px-4 py-3`}>
    <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1">{props.journalToggle}<span className={`${rowStyle.kind} font-black ${statement.type === '매출' ? 'text-blue-700' : 'text-rose-700'}`}>{view.label}</span>{view.isReturn && <span className={`${rowStyle.kind} font-black text-amber-700`}>반품</span>}</div><span className={`font-mono ${rowStyle.meta} text-slate-400`}>{props.dateLabel}</span></div>
    <div className="flex items-center justify-between gap-2"><span className={`min-w-0 truncate ${rowStyle.body} font-bold text-slate-800`}>{view.partner}</span><span className={`shrink-0 ${rowStyle.amount} font-black ${view.isReturn ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(view.amount)}</span></div>
    <div className="flex items-center justify-between gap-2"><span className={`min-w-0 flex-1 truncate ${rowStyle.meta} text-slate-400`}>{view.detail}</span><Balance view={view} type={statement.type} mobile/></div>
    {props.canSettle && <button onClick={event => { event.stopPropagation(); props.onSettle(); }} className={`mt-0.5 self-start ${rowStyle.action} font-black ${settlementTypeOf(statement) === '매입' ? 'text-rose-600' : 'text-blue-600'}`}>{settlementTypeOf(statement) === '매입' ? '지불처리' : '수금처리'}</button>}
    {props.journalPreview}
  </div>;
}
