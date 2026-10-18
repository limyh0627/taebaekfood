import DateRangeInputs, { DATE_RANGE_LAYOUT_CLASS, DATE_RANGE_INPUT_CLASS, DATE_RANGE_PAIR_CLASS, DATE_RANGE_QUICK_GROUP_CLASS, dateRangeQuickButtonClass } from '../../../shared/components/DateRangeInputs';
import React from 'react';
import QueryFilterPanel, {QUERY_FILTER_DATE_CLASS} from '../../../shared/components/QueryFilterPanel';
import { ChevronUp, ChevronDown } from 'lucide-react';

export type StatementHistoryKind = '전체' | '매출' | '매입' | '대체' | '입금' | '출금';
export type StatementQuickRange = '당일' | '금주' | '당월' | '당년' | 'ALL' | '';

const QUICK_RANGES = ['당일', '금주', '당월', '당년', 'ALL'] as const;
const KINDS: StatementHistoryKind[] = ['전체', '매출', '매입', '대체', '입금', '출금'];

/** 전표 조회 조건의 공통 틀. 거래처·계정 검색기는 children으로 받아 선택 로직은 부모에 둔다. */
export default function StatementHistoryFilters(props: {
  quickRange: StatementQuickRange;
  from: string;
  to: string;
  kind: StatementHistoryKind;
  kindCounts: ReadonlyMap<string, number>;
  onQuickRange: (range: Exclude<StatementQuickRange, ''>) => void;
  onFrom: (date: string) => void;
  onTo: (date: string) => void;
  onMove: (direction: -1 | 1) => void;
  onKind: (kind: StatementHistoryKind) => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return <>
    <QueryFilterPanel id="statement-query-title" onReset={props.onReset} sectionClassName="relative !overflow-visible" dateRow={<div className={QUERY_FILTER_DATE_CLASS}>
          <span className="text-[10px] font-bold text-slate-500">전표일자</span>
          <div className={DATE_RANGE_LAYOUT_CLASS}><DateRangeInputs from={props.from} to={props.to} onFromChange={props.onFrom} onToChange={props.onTo} className={DATE_RANGE_PAIR_CLASS} separatorClassName="shrink-0 text-xs text-slate-400" fromInputProps={{'aria-label':'조회 시작일',className:DATE_RANGE_INPUT_CLASS}} toInputProps={{'aria-label':'조회 종료일',className:DATE_RANGE_INPUT_CLASS}}/><div className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className={DATE_RANGE_QUICK_GROUP_CLASS}>
              {QUICK_RANGES.map((range,index) => <button key={range} type="button" onClick={() => props.onQuickRange(range)} aria-pressed={props.quickRange===range} className={dateRangeQuickButtonClass(props.quickRange===range,index<QUICK_RANGES.length-1)}>{{당일:'오늘',금주:'이번 주',당월:'이번 달',당년:'올해',ALL:'전체'}[range]}</button>)}
            </span><div className="flex shrink-0 flex-col sm:ml-0.5">
                {([-1, 1] as const).map(direction => <button key={direction} type="button"
                  onClick={() => props.onMove(direction)} disabled={!props.from || !props.to}
                  aria-label={direction < 0 ? '이전 기간' : '다음 기간'} title={direction < 0 ? '이전 기간' : '다음 기간'}
                  className="flex h-[18px] w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30">
                  {direction < 0 ? <ChevronUp size={13} strokeWidth={2.5}/> : <ChevronDown size={13} strokeWidth={2.5}/>}
                </button>)}
              </div></div></div>
        </div>}>{props.children}</QueryFilterPanel>
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" aria-label="전표 거래유형 선택">
      {KINDS.map(kind => <button key={kind} type="button" role="tab" aria-selected={props.kind === kind} onClick={() => props.onKind(kind)}
        className={`flex min-h-10 shrink-0 items-center gap-1 border-b-2 px-3 text-xs font-black transition-colors ${
          props.kind === kind ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
        }`}><span>{kind}</span><span className="text-[9px] opacity-70">{props.kindCounts.get(kind) ?? 0}</span></button>)}
    </div>
  </>;
}
