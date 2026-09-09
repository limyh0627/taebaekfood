import React from 'react';
import { statusBg, statusLabel, statusText } from '../orderStatusStyle';

interface OrderStatusDotProps {
  status?: string;
  className?: string;
}

/** 주문 상태는 칠한 글상자 대신 기존 주문 화면의 공용 색 점과 글자로 표시한다. */
const OrderStatusDot: React.FC<OrderStatusDotProps> = ({ status, className = '' }) => {
  const label = statusLabel(status);
  return (
    <span aria-label={`상태 ${label}`} className={`inline-flex items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusBg(status)}`} />
      <span className={`text-[10px] font-bold whitespace-nowrap ${statusText(status)}`}>{label}</span>
    </span>
  );
};

export default OrderStatusDot;
