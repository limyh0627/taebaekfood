import React from 'react';
import { ChevronRight, X } from 'lucide-react';

interface OrderCreationModalHeaderProps {
  currentLabel?: string;
  description?: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
}

/** 주문 생성 모달 공통 헤더: 고정 제목 → FLOW 경로 → 보조 설명 순서로 위계를 고정한다. */
const OrderCreationModalHeader: React.FC<OrderCreationModalHeaderProps> = ({
  currentLabel,
  description,
  onBack,
  onClose,
}) => (
  <header className={`flex items-start justify-between gap-4 rounded-t-3xl border-b border-slate-200 bg-white px-5 py-4 sm:px-6 sm:py-5 ${description ? 'min-h-[108px]' : 'min-h-[84px]'}`}>
    <div className="min-w-0">
      <h2 className="text-lg font-black leading-6 text-slate-900 sm:text-xl">주문 생성</h2>
      <nav className="mt-2 flex min-w-0 items-center gap-1 text-xs font-bold" aria-label="주문 생성 단계">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded px-1 py-0.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="주문 생성 방식 선택으로 돌아가기"
          >
            주문 생성 방식 선택
          </button>
        ) : (
          <span className="shrink-0 font-black text-indigo-600" aria-current="step">주문 생성 방식 선택</span>
        )}
        {currentLabel && <ChevronRight size={13} className="shrink-0 text-slate-300" aria-hidden="true" />}
        {currentLabel && <span className="min-w-0 truncate font-black text-indigo-600" aria-current="step">{currentLabel}</span>}
      </nav>
      {description && <p className="mt-1.5 text-xs font-medium leading-5 text-slate-500">{description}</p>}
    </div>
    <button
      type="button"
      onClick={onClose}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      aria-label="주문 생성 닫기"
    >
      <X size={20} />
    </button>
  </header>
);

export default OrderCreationModalHeader;
