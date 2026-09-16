import React from 'react';
import { statusLabel, statusText } from '../orderStatusStyle';

interface OrderStatusDotProps {
  status?: string;
  className?: string;
}

/**
 * 주문 상태는 칠한 글상자 대신 주문 화면의 공용 **글자 색**으로 표시한다.
 *
 * **점은 뺐다**(2026-09-16 사장님: "예전주문 대기중 앞에 점 빼버려"). 글자가 이미
 * 상태 색으로 칠해져 있어 점은 같은 말을 두 번 하는 것이었고, 줄마다 점이 서서
 * 거래처명·날짜를 세로로 훑는 눈을 끊었다. 색은 `statusText` 한 곳이 정한다 —
 * 배송 캘린더에서 상태 글자를 빼고 색만 남긴 것과 같은 규칙이다.
 */
const OrderStatusDot: React.FC<OrderStatusDotProps> = ({ status, className = '' }) => {
  const label = statusLabel(status);
  return (
    <span aria-label={`상태 ${label}`} className={`inline-flex items-center ${className}`}>
      <span className={`text-[10px] font-bold whitespace-nowrap ${statusText(status)}`}>{label}</span>
    </span>
  );
};

export default OrderStatusDot;
