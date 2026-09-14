import React from 'react';
import { ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';

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
    <section className="relative overflow-visible rounded-lg border border-slate-200 bg-white" aria-labelledby="statement-query-title">
      <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-4">
        <h3 id="statement-query-title" className="text-xs font-black text-slate-800">검색조건</h3>
        <button type="button" onClick={props.onReset} className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
          <RotateCcw size={12}/>초기화
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2 p-3 md:p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500">전표일자</span>
          <div className="flex flex-wrap items-center gap-2">
            {/*  **단추 묶음은 제 상자 안에 있어야 한다**(2026-09-15 사장님: "ALL이랑 달력사이 경계가
                 애매하다", "ALL 오른쪽은 테두리가 없잖아").
                 맞다 — 단추들 **뒤에 달력 묶음이 같은 부모에 있어서** 마지막 단추(ALL)가
                 `:last-child` 가 아니었다. 그래서 `last:border-r`(오른쪽 테두리)도
                 `last:mr-0`(붙이려고 준 당김을 푸는 것)도 통째로 무시됐다 —
                 ALL 은 오른쪽이 트인 채로 달력 쪽으로 8px 끌려가 있었다.
                 단추만 따로 감싸면 그제야 마지막이 마지막이 된다. */}
            <div className="flex items-center">
              {QUICK_RANGES.map(range => <button key={range} type="button" onClick={() => props.onQuickRange(range)}
                className={`h-9 px-3 text-[11px] font-black border-y border-l first:rounded-l-md last:rounded-r-md last:border-r -mr-px last:mr-0 transition-all ${
                  props.quickRange === range ? 'relative z-10 bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}>{range}</button>)}
            </div>
            <div className="flex w-full items-center gap-1.5 sm:ml-1 sm:w-auto">
              <input type="date" value={props.from} aria-label="조회 시작일" onChange={event => props.onFrom(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
              <span className="text-xs text-slate-300">~</span>
              <input type="date" value={props.to} aria-label="조회 종료일" onChange={event => props.onTo(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
              {/*  **테두리 없이 위아래로**(2026-09-15 사장님: "테두리 없애고 위아래로 바꿔라").
                   네모 상자 둘이 날짜칸 옆에서 날짜만큼 자리를 먹고 있었다. 표가 이제
                   **오래된 것부터 아래로** 흐르므로(같은 날 "오래된게 위로 오게") 기간을
                   옮기는 방향도 좌우가 아니라 위아래로 읽는 것이 맞다 — 위가 이전, 아래가 다음. */}
              <div className="flex shrink-0 flex-col sm:ml-0.5">
                {([-1, 1] as const).map(direction => <button key={direction} type="button"
                  onClick={() => props.onMove(direction)} disabled={!props.from || !props.to}
                  aria-label={direction < 0 ? '이전 기간' : '다음 기간'} title={direction < 0 ? '이전 기간' : '다음 기간'}
                  className="flex h-[18px] w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30">
                  {direction < 0 ? <ChevronUp size={13} strokeWidth={2.5}/> : <ChevronDown size={13} strokeWidth={2.5}/>}
                </button>)}
              </div>
            </div>
          </div>
        </div>
        <span className="h-0 basis-full" aria-hidden="true"/>
        {props.children}
      </div>
    </section>
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" aria-label="전표 거래유형 선택">
      {KINDS.map(kind => <button key={kind} type="button" role="tab" aria-selected={props.kind === kind} onClick={() => props.onKind(kind)}
        className={`flex min-h-10 shrink-0 items-center gap-1 border-b-2 px-3 text-xs font-black transition-colors ${
          props.kind === kind ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
        }`}><span>{kind}</span><span className="text-[9px] opacity-70">{props.kindCounts.get(kind) ?? 0}</span></button>)}
    </div>
  </>;
}
