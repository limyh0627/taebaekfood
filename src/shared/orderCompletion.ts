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

/** 작업 전 세 단계는 별도 선택값이 아니라 품목 체크 수의 결과다. */
export function workStatusFromItems(items: Order['items']): OrderStatus {
  const checked = items.filter(item => item.checked === true).length;
  if (items.length > 0 && checked === items.length) return OrderStatus.DISPATCHED;
  return checked > 0 ? OrderStatus.PROCESSING : OrderStatus.PENDING;
}

/** 결정적 작업번호가 있는 품목 작업끼리만 실패 지점에서 자동 재개한다. */
export function canResumeFailedInventoryOperation(
  previous: NonNullable<Order['inventoryOperation']>,
  next: NonNullable<Order['inventoryOperation']>,
) {
  return previous.state === 'failed'
    && next.kind === 'line'
    && (previous.kind === 'line' || previous.id.startsWith('order-line-'));
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
  /*  **작업완료도 체크를 풀면 되돌아간다**(2026-09-12 사장님: "작업완료된 주문이 해당 주문에
   *  주문품목 중 하나가 미완료로 변경 되거나 … 생산되는데 사용된 부자재 등등이 롤백 되도록").
   *
   *  전에는 대기중·작업중일 때만 상태를 다시 셈해서, **작업완료 주문의 체크를 풀어도 상태가
   *  그대로 남았다.** 상태가 안 바뀌니 되돌리기 경로를 안 타고, 생산에 쓴 부자재·원료가
   *  그대로 빠져 있었다 — 만든 적 없는 것을 만든 걸로 세는 셈이다.
   *
   *  출고완료·배송완료는 그대로 둔다. 이미 물건이 나간 뒤라 체크 한 번으로 되돌릴 일이 아니다
   *  (되돌리려면 상태를 직접 내리는 길로 간다 — 거기엔 원복 승인창이 붙어 있다).
   *  재고로 덮은 주문이면 생산한 게 없어 되돌릴 것도 없다 — 스냅샷이 비어 있어 저절로 넘어간다. */
  let status = order.status;
  if (status === OrderStatus.PENDING || status === OrderStatus.PROCESSING || status === OrderStatus.DISPATCHED) {
    status = workStatusFromItems(items);
  }
  return { items, status };
}
