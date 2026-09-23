import React from 'react';
import { X } from 'lucide-react';

export interface ModalShellProps {
  /** 모달은 무엇을 하는 창인지 항상 머리에 적는다. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** LargeModalShell만 내부에서 사용한다. 일반 화면에서는 지정하지 않는다. */
  size?: 'standard' | 'large';
}

/**
 * 앱의 기본 업무 모달.
 * 거래처 주문 수정창을 기준으로 폭·모서리·머리줄·모바일 배치를 한 벌로 고정한다.
 */
const ModalShell: React.FC<ModalShellProps> = ({
  title,
  onClose,
  children,
  footer,
  className = '',
  bodyClassName = '',
  size = 'standard',
}) => (
  <div
    className="fixed inset-0 z-[1090] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm md:items-center md:p-4"
    style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    onClick={onClose}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-modal-title"
      className={`flex max-h-[90dvh] w-full ${size === 'large' ? 'max-w-6xl' : 'max-w-2xl'} flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl md:max-h-[88vh] md:rounded-2xl ${className}`}
      onClick={event => event.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <h3 id="app-modal-title" className="text-[17px] font-black leading-6 text-slate-900">{title}</h3>
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
      {footer && <footer className="border-t border-slate-200 p-4 md:px-5">{footer}</footer>}
    </div>
  </div>
);

export default ModalShell;
