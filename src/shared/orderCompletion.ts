import { OrderStatus, type Order } from './types';

const WORK_COMPLETION_STATES = new Set<OrderStatus>([
  OrderStatus.DISPATCHED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
]);

export function isWorkCompletedState(status: OrderStatus) {
  return WORK_COMPLETION_STATES.has(status);
}

/** 작업완료 이전 주문이 작업완료 이후 단계로 진입할 때만 새 검증을 적용한다. */
export function requiresCompleteItemsForStatusChange(from: OrderStatus, to: OrderStatus) {
  return !isWorkCompletedState(from) && isWorkCompletedState(to);
}

/** 빈 주문은 완료로 간주하지 않는다. */
export function hasCompleteOrderItems(items: Order['items']) {
  return items.length > 0 && items.every(item => item.checked === true);
}

/** 조회 효과가 아니라 클릭 한 번의 결과만 계산한다. 생산·재고 처리는 호출자가 기존 승인 경로로 넘긴다. */
export function planOrderItemToggle(order: Order, index: number, actor: string | undefined, now: string) {
  if (!order.items[index]) return null;
  const items = order.items.map((item, i) => {
    if (i !== index) return item;
    const { checkedBy: _by, checkedAt: _at, ...rest } = item;
    return item.checked ? { ...rest, checked: false }
      : { ...rest, checked: true, checkedAt: now, ...(actor ? { checkedBy: actor } : {}) };
  });
  let status = order.status;
  if (status === OrderStatus.PENDING || status === OrderStatus.PROCESSING) {
    const checked = items.filter(item => item.checked).length;
    status = checked === items.length ? OrderStatus.DISPATCHED
      : checked ? OrderStatus.PROCESSING : OrderStatus.PENDING;
  }
  return { items, status };
}
