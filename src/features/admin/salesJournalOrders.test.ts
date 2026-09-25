import { describe, expect, it } from 'vitest';
import { OrderStatus, type Order } from '../../shared/types';
import { ordersFarFromJournalDate, ordersPendingDocumentClose } from './salesJournalOrders';

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

describe('판매일지 날짜 저장 전 확인', () => {
  it('주문 생성일과 서류 날짜가 7일을 넘게 벌어질 때만 주문을 돌려준다', () => {
    const orders = [
      { cardNo: 'ORD-1', partnerName: '첫째', createdAt: '2026-09-18T09:00:00+09:00' },
      { cardNo: 'ORD-2', partnerName: '둘째', createdAt: '2026-09-17T09:00:00+09:00' },
      { cardNo: 'ORD-3', partnerName: '셋째', createdAt: '2026-10-03T09:00:00+09:00' },
    ];
    expect(ordersFarFromJournalDate(orders, '2026-09-25')).toEqual([
      { cardNo: 'ORD-2', partnerName: '둘째', orderDate: '2026-09-17', days: 8 },
      { cardNo: 'ORD-3', partnerName: '셋째', orderDate: '2026-10-03', days: 8 },
    ]);
  });

  it('시각이 없는 옛 주문은 경고를 임의로 만들지 않는다', () => {
    expect(ordersFarFromJournalDate([
      { cardNo: 'OLD', partnerName: '옛 거래처', createdAt: '' },
    ], '2026-09-25')).toEqual([]);
  });
});
