import { OrderStatus, type Order, type Item } from '../../../shared/types';
import { queryDateKey } from './deliveryQueryDate';

export function buildDeliverySchedules(orders: Order[], items: Item[], sortMode: 'delivery' | 'order' | 'stock' | 'workLow' | 'workHigh') {
    const schedules: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (order.deliveryDate && order.partnerName !== '생산기록' && order.status !== OrderStatus.DELIVERED) {
        const date = queryDateKey(order.deliveryDate);
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    /*  **날짜 안의 차례도 검색조건의 정렬을 따른다**(2026-09-11 사장님).
        재고 여유는 "재고 − 주문량"이 적은 것부터 — 모자랄 것 같은 주문을 먼저 본다. */
    const 여유 = (order: Order) => Math.min(...order.items.map(line => {
      const product = items.find(candidate => candidate.id === line.itemId);
      return product ? (product.stock ?? 0) - line.quantity : Number.POSITIVE_INFINITY;
    }));
    for (const date of Object.keys(schedules)) {
      schedules[date].sort((a, b) => {
        if (sortMode === 'order') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortMode === 'stock') return 여유(a) - 여유(b);
        return (a.partnerName || '').localeCompare(b.partnerName || '', 'ko');
      });
    }
    return schedules;
  }

export function buildDeliveredSchedules(orders: Order[]) {
    const schedules: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (order.deliveryDate && order.partnerName !== '생산기록' && order.status === OrderStatus.DELIVERED) {
        const date = queryDateKey(order.deliveryDate);
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    return schedules;
  }
