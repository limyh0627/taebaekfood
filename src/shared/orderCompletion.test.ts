import { describe, expect, it } from 'vitest';
import { OrderStatus, type Order } from './types';
import { hasCompleteOrderItems, planOrderItemToggle, requiresCompleteItemsForStatusChange } from './orderCompletion';

const make = (status: OrderStatus, checked: boolean[]) => ({
  status, items: checked.map((value, i) => ({itemId: String(i), name: '품목', quantity: 1, price: 0, checked: value, checkedBy: '이전', checkedAt: '이전'})),
}) as Order;
describe('작업 체크의 승인 전 계획', () => {
  it('첫 체크는 작업중, 마지막 체크는 작업완료', () => {
    expect(planOrderItemToggle(make(OrderStatus.PENDING, [false,false]),0,'담당자','지금')?.status).toBe(OrderStatus.PROCESSING);
    expect(planOrderItemToggle(make(OrderStatus.PROCESSING, [true,false]),1,'담당자','지금')?.status).toBe(OrderStatus.DISPATCHED);
  });
  it('체크가 하나도 남지 않으면 대기중', () => {
    const plan=planOrderItemToggle(make(OrderStatus.PROCESSING,[true,false]),0,'담당자','지금')!;
    expect(plan.status).toBe(OrderStatus.PENDING);
    expect(plan.items[0]).not.toHaveProperty('checkedBy');
    expect(plan.items[0]).not.toHaveProperty('checkedAt');
  });
  it.each([OrderStatus.DISPATCHED,OrderStatus.SHIPPED,OrderStatus.DELIVERED,OrderStatus.ON_HOLD])('이미 넘어간 %s 상태는 체크로 역행시키지 않는다', status => {
    expect(planOrderItemToggle(make(status,[true]),0,'담당자','지금')?.status).toBe(status);
  });
  it('기록자·시각을 넣되 승인 전 원본은 바꾸지 않는다', () => {
    const order=make(OrderStatus.PENDING,[false]);
    const plan=planOrderItemToggle(order,0,'담당자','지금')!;
    expect(plan.items[0]).toMatchObject({checked:true,checkedBy:'담당자',checkedAt:'지금'});
    expect(order.items[0].checked).toBe(false);
    expect(planOrderItemToggle(order,2,'담당자','지금')).toBeNull();
  });
});

describe('작업완료 상태 진입 검증', () => {
  it('품목이 1개 이상이고 모두 체크됐을 때만 완료로 본다', () => {
    expect(hasCompleteOrderItems([])).toBe(false);
    expect(hasCompleteOrderItems(make(OrderStatus.PENDING, [true, true]).items)).toBe(true);
    expect(hasCompleteOrderItems(make(OrderStatus.PENDING, [true, false]).items)).toBe(false);
  });

  it('작업완료 이전에서 이후 단계로 건너뛰는 경로도 검증한다', () => {
    expect(requiresCompleteItemsForStatusChange(OrderStatus.PENDING, OrderStatus.DISPATCHED)).toBe(true);
    expect(requiresCompleteItemsForStatusChange(OrderStatus.PROCESSING, OrderStatus.SHIPPED)).toBe(true);
    expect(requiresCompleteItemsForStatusChange(OrderStatus.DISPATCHED, OrderStatus.SHIPPED)).toBe(false);
  });
});
