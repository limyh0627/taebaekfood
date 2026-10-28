export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  ON_HOLD = 'ON_HOLD'
}

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
export function hasCompleteOrderItems(items: readonly {checked?:boolean}[]) {
  return items.length > 0 && items.every(item => item.checked === true);
}

