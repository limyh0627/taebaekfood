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
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const topDialog = (exclude?: HTMLElement) => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .filter(node => node !== exclude)
      .sort((a, b) => (Number(getComputedStyle(a.parentElement!).zIndex) || 0) - (Number(getComputedStyle(b.parentElement!).zIndex) || 0)).at(-1);
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(node => node.tabIndex >= 0 && node.closest('[role="dialog"]') === dialog && !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const focusFirst = () => (controls()[0] ?? dialog).focus();
    const onFocus = (event: FocusEvent) => {
      if (topDialog() === dialog && !dialog.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || topDialog() !== dialog) return;
      const nodes = controls();
      const first = nodes[0], last = nodes.at(-1);
      if (!first || !dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
      }
    };
    if (topDialog() === dialog && !dialog.contains(document.activeElement)) focusFirst();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      const remaining = topDialog(dialog);
      if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus();
    };
  }, []);
  return (
  <div
    className="fixed inset-0 z-[1090] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:p-4"
    style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', ...(layer ? { zIndex: layer } : {}) }}
    onClick={onClose}
  >
    <div
      ref={dialogRef}
      tabIndex={-1}
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
