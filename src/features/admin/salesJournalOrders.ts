import { OrderStatus, type Order } from '../../shared/types';
import { dateOfLocal } from '../../shared/day';

/**
 * 생산판매일지에 표시할 줄이 없는 원료 주문도 서류 처리 뒤 주문 이력으로 보내야 한다.
 * 품목 유형 필터는 표의 판매 줄에만 적용하고, 마감 대상 주문 자체에는 적용하지 않는다.
 */
export const ordersPendingDocumentClose = (orders: Order[]): Order[] => orders.filter(order =>
  order.status === OrderStatus.SHIPPED && order.partnerName !== '생산기록',
);

/** 서류 기준일이 주문 생성일과 한 주 넘게 어긋나면 저장 전에 사람에게 확인한다. */
export const ordersFarFromJournalDate = (
  orders: readonly Pick<Order, 'createdAt' | 'cardNo' | 'partnerName'>[],
  documentDate: string,
): Array<{ cardNo: string; partnerName: string; orderDate: string; days: number }> => {
  const target = Date.parse(`${documentDate}T00:00:00.000Z`);
  if (!Number.isFinite(target)) return [];
  return orders.flatMap(order => {
    const orderDate = dateOfLocal(order.createdAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return [];
    const source = Date.parse(`${orderDate}T00:00:00.000Z`);
    const days = Math.round(Math.abs(target - source) / 86_400_000);
    return days > 7 ? [{ cardNo: order.cardNo ?? '', partnerName: order.partnerName ?? '', orderDate, days }] : [];
  });
};
