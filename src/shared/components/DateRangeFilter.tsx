import { monthStart, today, weekMonday } from '../day';

export type DateRangeQuick = '당일' | '금주' | '당월' | '전체' | '';

export default function DateRangeFilter({ from, to, quick = '', onChange, label = '조회' }: {
  from: string;
  to: string;
  quick?: DateRangeQuick;
  onChange: (from: string, to: string, quick: DateRangeQuick) => void;
  label?: string;
}) {
  const pick = (value: Exclude<DateRangeQuick, ''>) => {
    if (value === '전체') return onChange('', '', value);
    if (value === '금주') return onChange(weekMonday(), today(), value);
    if (value === '당월') return onChange(monthStart(), today(), value);
    const date = today();
    onChange(date, date, value);
  };
  return <div className="flex flex-wrap items-center gap-1.5">
    {(['당일', '금주', '당월', '전체'] as const).map(value =>
      <button key={value} type="button" onClick={() => pick(value)}
        className={`rounded-lg border px-2.5 py-1 text-[11px] font-black transition-all ${quick === value ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>
        {value}
      </button>)}
    <input aria-label={`${label} 시작일`} type="date" value={from} max={to || undefined}
      onChange={event => onChange(event.target.value, to, '')}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300" />
    <span className="text-xs text-slate-300">~</span>
    <input aria-label={`${label} 종료일`} type="date" value={to} min={from || undefined}
      onChange={event => onChange(from, event.target.value, '')}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300" />
  </div>;
}
