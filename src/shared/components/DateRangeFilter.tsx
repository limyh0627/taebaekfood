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
  return <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
    {(['당일', '금주', '당월', '전체'] as const).map(value =>
      <button key={value} type="button" aria-pressed={quick === value} onClick={() => pick(value)}
        className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${quick === value ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>
        {value}
      </button>)}
    </div>
    <div className="grid w-full min-w-0 max-w-full grid-cols-1 items-center gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:w-80">
    <input aria-label={`${label} 시작일`} type="date" value={from} max={to || undefined}
      onChange={event => onChange(event.target.value, to, '')}
      className="min-h-11 w-full !min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300" />
    <span aria-hidden="true" className="hidden text-xs text-slate-400 min-[360px]:block">~</span>
    <input aria-label={`${label} 종료일`} type="date" value={to} min={from || undefined}
      onChange={event => onChange(from, event.target.value, '')}
      className="min-h-11 w-full !min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300" />
    </div>
  </div>;
}
