import React from 'react';

interface CalendarDayCountBadgeProps {
  count: number;
}

/** 주문·배송 캘린더의 날짜별 건수는 같은 정보 위계이므로 한 모양으로 유지한다. */
const CalendarDayCountBadge: React.FC<CalendarDayCountBadgeProps> = ({ count }) => (
  <span className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-black ${count > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
    총 {count}건
  </span>
);

export default CalendarDayCountBadge;
