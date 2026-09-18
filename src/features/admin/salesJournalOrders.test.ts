import { describe, expect, it } from 'vitest';
import { OrderStatus, type Order } from '../../shared/types';
import { ordersPendingDocumentClose } from './salesJournalOrders';

const order = (status: OrderStatus, partnerName = '가득찬식품') => ({
  id: 'ORD-260917-007', status, partnerName, items: [{ itemId: 'raw-sesame', name: '들깨', quantity: 1000 }],
} as Order);

describe('생산판매일지 주문 마감 대상', () => {
  it('판매 표에서 제외되는 원료만 있는 출고 주문도 마감한다', () => {
    expect(ordersPendingDocumentClose([order(OrderStatus.SHIPPED)])).toHaveLength(1);
  });

  it('출고 전 주문과 내부 생산기록은 마감하지 않는다', () => {
    expect(ordersPendingDocumentClose([
      order(OrderStatus.PROCESSING),
      order(OrderStatus.SHIPPED, '생산기록'),
    ])).toEqual([]);
  });
});
