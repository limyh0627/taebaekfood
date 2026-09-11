import React from 'react';

interface ModalActionFooterProps {
  onCancel: () => void;
  onPrimary?: () => void;
  primaryLabel?: React.ReactNode;
  primaryDisabled?: boolean;
  cancelLabel?: string;
}

/** 입력 모달 공통 CTA: 좌측 중립 행동, 우측 Primary 행동을 같은 크기와 위치로 유지한다. */
const ModalActionFooter: React.FC<ModalActionFooterProps> = ({
  onCancel,
  onPrimary,
  primaryLabel,
  primaryDisabled = false,
  cancelLabel = '취소',
}) => (
  <footer className={`grid gap-3 rounded-b-3xl border-t border-slate-200 bg-slate-50/70 p-4 sm:px-6 sm:py-5 ${onPrimary && primaryLabel ? 'grid-cols-2' : 'grid-cols-1'}`}>
    <button
      type="button"
      onClick={onCancel}
      className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      {cancelLabel}
    </button>
    {onPrimary && primaryLabel && <button
      type="button"
      onClick={onPrimary}
      disabled={primaryDisabled}
      className="min-h-12 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
    >
      {primaryLabel}
    </button>}
  </footer>
);

export default ModalActionFooter;
