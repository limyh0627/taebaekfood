import React, {forwardRef} from 'react';

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'normal' | 'primary' | 'recovery';
}
const tones = {
  normal: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
  primary: 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700',
  recovery: 'border-amber-300 bg-white text-amber-800 hover:bg-amber-50',
};
/** 크기·글꼴만 공통화하며 권한·업무 상태·실제 실행은 소비자가 정한다. */
const ActionButton = forwardRef<HTMLButtonElement,ActionButtonProps>(function ActionButton({tone='normal',type='button',className='',...props},ref){
  return <button {...props} ref={ref} type={type} className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`} />;
});
export default ActionButton;
