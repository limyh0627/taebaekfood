import { OrderStatus, type Order } from '../../shared/types';

/**
 * 생산판매일지에 표시할 줄이 없는 원료 주문도 서류 처리 뒤 주문 이력으로 보내야 한다.
 * 품목 유형 필터는 표의 판매 줄에만 적용하고, 마감 대상 주문 자체에는 적용하지 않는다.
 */
export const ordersPendingDocumentClose = (orders: Order[]): Order[] => orders.filter(order =>
  order.status === OrderStatus.SHIPPED && order.partnerName !== '생산기록',
);
