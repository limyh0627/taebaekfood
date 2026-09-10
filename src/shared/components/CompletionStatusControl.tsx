import React from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';

interface CompletionStatusControlProps {
  completed: boolean;
  onChange?: (completed: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
}

/** 결과표의 완료 여부를 동일한 아이콘·텍스트 위계로 표시하고, 필요할 때만 조작을 허용한다. */
const CompletionStatusControl: React.FC<CompletionStatusControlProps> = ({
  completed,
  onChange,
  disabled = false,
  ariaLabel,
  title,
}) => {
  const content = (
    <>
      {completed
        ? <CheckCircle2 size={13} aria-hidden="true" />
        : <CircleAlert size={13} aria-hidden="true" />}
      <span>{completed ? '완료' : '미완료'}</span>
    </>
  );
  const className = `flex min-h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[10px] font-bold leading-none transition-colors ${
    completed ? 'text-emerald-600' : 'text-red-600'
  }`;

  if (!onChange || disabled) {
    return <span className={className} aria-label={ariaLabel} title={title}>{content}</span>;
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-label={ariaLabel}
      title={title}
      onClick={() => onChange(!completed)}
      className={`${className} ${completed ? 'hover:bg-emerald-50' : 'hover:bg-red-50'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
    >
      {content}
    </button>
  );
};

export default CompletionStatusControl;
