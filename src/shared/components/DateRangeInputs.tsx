import type {InputHTMLAttributes} from 'react';

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