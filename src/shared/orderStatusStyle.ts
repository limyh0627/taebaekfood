import { OrderStatus } from './types';

/**
 * 주문 상태의 이름과 색 — 화면끼리 같은 상태를 다른 말로 부르지 않게 한 곳에 둔다.
 * [TradeStatement](../../components/TradeStatement.tsx) 안에만 있던 것을 뺐다(2026-09-05).
 */
export const STATUS_LABEL: Record<string, string> = {
  [OrderStatus.PENDING]: '대기중', [OrderStatus.PROCESSING]: '작업중',
  [OrderStatus.DISPATCHED]: '작업완료', [OrderStatus.SHIPPED]: '출고완료',
  [OrderStatus.DELIVERED]: '배송완료',
};

export const STATUS_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-slate-100 text-slate-500',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-700',
  [OrderStatus.DISPATCHED]: 'bg-sky-100 text-sky-700',
  [OrderStatus.SHIPPED]: 'bg-indigo-100 text-indigo-700',
  [OrderStatus.DELIVERED]: 'bg-emerald-100 text-emerald-700',
};
