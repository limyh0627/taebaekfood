import type {InputHTMLAttributes} from 'react';

export const DATE_RANGE_LAYOUT_CLASS = 'flex min-w-0 max-w-full flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center';
export const DATE_RANGE_INPUT_CLASS = 'date-narrow h-10 !min-w-0 max-w-full rounded-md border border-slate-200 bg-slate-50 px-0.5 text-[10px] font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 sm:px-2 sm:text-xs';
export const DATE_RANGE_PAIR_CLASS = 'flex min-w-0 max-w-full flex-nowrap items-center gap-1 sm:gap-2';
export const DATE_RANGE_QUICK_GROUP_CLASS = 'flex h-10 shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-white';
export function dateRangeQuickButtonClass(active: boolean, divider = false): string {
  return `h-full whitespace-nowrap px-1.5 text-[9px] sm:px-3 sm:text-[11px] ${divider ? 'border-r border-slate-200' : ''} ${active ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`;
}


type DateInputProps=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'onChange'>;
export interface DateRangeInputsProps {
  from:string;
  to:string;
  onFromChange:(value:string)=>void;
  onToChange:(value:string)=>void;
  fromInputProps?:DateInputProps;
  toInputProps?:DateInputProps;
  className?:string;
  separatorClassName?:string;
  separatorAriaHidden?:boolean;
}

/** 날짜 정책은 호출자가 정하고, 두 입력의 값과 변경 전달만 공유한다. */
export default function DateRangeInputs({from,to,onFromChange,onToChange,fromInputProps,toInputProps,className,separatorClassName,separatorAriaHidden}:DateRangeInputsProps){
  return <span className={className}>
    <input {...fromInputProps} type="date" value={from} onChange={event=>onFromChange(event.target.value)}/>
    <span aria-hidden={separatorAriaHidden} className={separatorClassName}>~</span>
    <input {...toInputProps} type="date" value={to} onChange={event=>onToChange(event.target.value)}/>
  </span>;
}