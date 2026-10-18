import React, { useId } from 'react';
import { RotateCcw } from 'lucide-react';

export const QUERY_FILTER_LABEL_CLASS = 'flex flex-col gap-1 text-[10px] font-bold text-slate-500';
export const QUERY_FILTER_CONTROL_CLASS = 'h-10 min-w-32 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300';

export default function QueryFilterPanel({ id, ariaLabel, onReset, children, bodyClassName = '', sectionClassName = '' }: {
  id?: string;
  ariaLabel?: string;
  onReset: () => void;
  children: React.ReactNode;
  bodyClassName?: string;
  sectionClassName?: string;
}) {
  const fallbackId = useId();
  const titleId = id ?? fallbackId;
  return <section className={`overflow-hidden rounded-lg border border-slate-200 bg-white${sectionClassName ? ' ' + sectionClassName : ''}`} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleId}>
    <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
      <h3 id={titleId} className="text-xs font-black text-slate-900">검색조건</h3>
      <button type="button" onClick={onReset} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700"><RotateCcw size={12} aria-hidden="true" />초기화</button>
    </div>
    <div className={`flex flex-wrap items-end gap-2 p-3 md:p-4 [&_input:not([type=checkbox]):not([type=radio])]:!h-10 [&_input:not([type=checkbox]):not([type=radio])]:!min-h-0 [&_input:not([type=checkbox]):not([type=radio])]:!rounded-md [&_input:not([type=checkbox]):not([type=radio])]:!border-slate-200 [&_input:not([type=checkbox]):not([type=radio])]:!bg-slate-50 [&_input:not([type=checkbox]):not([type=radio])]:!font-bold [&_input:not([type=checkbox]):not([type=radio])]:!text-slate-700 [&_input:not([type=checkbox]):not([type=radio]):not([type=date]):not(.date-narrow)]:!text-xs${bodyClassName ? ' ' + bodyClassName : ''}`}>{children}</div>
  </section>;
}
