import { monthEnd, monthStart, today, weekMonday, weekSunday } from '../../../shared/day';

export type StatementOrderDateQuick = '당일' | '금주' | '당월' | '전체' | '';

export default function StatementOrderDateFilter(props: {
  quick: StatementOrderDateQuick;
  from: string;
  to: string;
  onChange: (from: string, to: string, quick: StatementOrderDateQuick) => void;
}) {
  const pickQuick = (quick: Exclude<StatementOrderDateQuick, ''>) => {
    if (quick === '전체') return props.onChange('', '', quick);
    if (quick === '금주') return props.onChange(weekMonday(), weekSunday(), quick);
    if (quick === '당월') return props.onChange(monthStart(), monthEnd(), quick);
    const date = today();
    props.onChange(date, date, quick);
  };
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
      {(['당일', '금주', '당월', '전체'] as const).map(quick => (
        <button key={quick} onClick={() => pickQuick(quick)}
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-black transition-all ${props.quick === quick ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>
          {quick}
        </button>
      ))}
      <input aria-label="주문 조회 시작일" type="date" value={props.from}
        onChange={event => props.onChange(event.target.value, props.to, '')}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
      <span className="text-xs text-slate-300">~</span>
      <input aria-label="주문 조회 종료일" type="date" value={props.to}
        onChange={event => props.onChange(props.from, event.target.value, '')}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
    </div>
  );
}
