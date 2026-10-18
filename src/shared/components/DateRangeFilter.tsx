import DateRangeInputs, { DATE_RANGE_INPUT_CLASS, DATE_RANGE_PAIR_CLASS, DATE_RANGE_QUICK_GROUP_CLASS, dateRangeQuickButtonClass } from './DateRangeInputs';
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
  return <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 sm:gap-2">
    <DateRangeInputs from={from} to={to}
      onFromChange={value => onChange(value, to, '')}
      onToChange={value => onChange(from, value, '')}
      className={DATE_RANGE_PAIR_CLASS}
      separatorClassName="shrink-0 text-xs text-slate-400"
      separatorAriaHidden
      fromInputProps={{ 'aria-label': `${label} 시작일`, max: to || undefined,
        className: DATE_RANGE_INPUT_CLASS }}
      toInputProps={{ 'aria-label': `${label} 종료일`, min: from || undefined,
        className: DATE_RANGE_INPUT_CLASS }}/>
    <span className={DATE_RANGE_QUICK_GROUP_CLASS}>
      {([['당일','오늘'],['금주','이번 주'],['당월','이번 달'],['전체','전체']] as const).map(([value, text], index) =>
        <button key={value} type="button" aria-pressed={quick === value} onClick={() => pick(value)}
          className={dateRangeQuickButtonClass(quick === value,index < 3)}>
          {text}
        </button>)}
    </span>
  </div>;
}
