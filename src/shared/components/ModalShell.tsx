import React from 'react';
import { X } from 'lucide-react';

export interface ModalShellProps {
  /** 모달은 무엇을 하는 창인지 항상 머리에 적는다. */
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 이미 열린 모달 위에 다른 모달을 띄우는 경우에만 겹침 순서를 높인다. */
  layer?: number;
  /** LargeModalShell만 내부에서 사용한다. 일반 화면에서는 지정하지 않는다. */
  size?: 'standard' | 'large';
}

/**
 * 앱의 기본 업무 모달.
 * 거래처 주문 수정창을 기준으로 폭·모서리·머리줄·모바일 배치를 한 벌로 고정한다.
 */
const ModalShell: React.FC<ModalShellProps> = ({
  title,
  subtitle,
  onClose,
  children,
  footer,
  className = '',
  bodyClassName = '',
  layer,
  size = 'standard',
}) => {
  const titleId = React.useId();
  return (
  <div
    className="fixed inset-0 z-[1090] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:p-4"
    style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', ...(layer ? { zIndex: layer } : {}) }}
    onClick={onClose}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`flex max-h-full w-full ${size === 'large' ? 'max-w-6xl' : 'max-w-2xl'} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:max-h-[88vh] ${className}`}
      onClick={event => event.stopPropagation()}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[17px] font-black leading-6 text-slate-900">{title}</h3>
          {subtitle && <div className="mt-0.5 truncate text-xs font-semibold text-slate-400">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`${title} 닫기`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={18} />
        </button>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto p-4 md:p-5 ${bodyClassName}`}>{children}</div>
      {footer && <footer className="shrink-0 border-t border-slate-200 p-4 md:px-5">{footer}</footer>}
    </div>
  </div>
  );
};

export default ModalShell;
