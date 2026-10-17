import type React from 'react';

export const 달력열기 = (event: React.MouseEvent<HTMLInputElement>) => {
  event.stopPropagation();
  const 칸 = event.currentTarget;
  칸.focus({ preventScroll: true });
  try { 칸.showPicker?.(); } catch { /* 브라우저가 막으면 칸에 직접 치면 된다 */ }
};
