import { describe, expect, it } from 'vitest';
import { OrderStatus, type Order } from './types';
import { canResumeFailedInventoryOperation, hasCompleteOrderItems, planOrderItemToggle, requiresCompleteItemsForStatusChange, workStatusFromItems } from './orderCompletion';

const make = (status: OrderStatus, checked: boolean[]) => ({
  status, items: checked.map((value, i) => ({itemId: String(i), name: '품목', quantity: 1, price: 0, checked: value, checkedBy: '이전', checkedAt: '이전'})),
}) as Order;
describe('작업 체크의 승인 전 계획', () => {
  it('작업 상태는 체크 수로만 정한다', () => {
    expect(workStatusFromItems(make(OrderStatus.PROCESSING, [false, false]).items)).toBe(OrderStatus.PENDING);
    expect(workStatusFromItems(make(OrderStatus.PENDING, [true, false]).items)).toBe(OrderStatus.PROCESSING);
    expect(workStatusFromItems(make(OrderStatus.PENDING, [true, true]).items)).toBe(OrderStatus.DISPATCHED);
    expect(workStatusFromItems([])).toBe(OrderStatus.PENDING);
  });
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
  //  출고완료·배송완료·보류는 그대로 — 물건이 나간 뒤라 체크 한 번으로 되돌릴 일이 아니다.
  it.each([OrderStatus.SHIPPED,OrderStatus.DELIVERED,OrderStatus.ON_HOLD])('이미 넘어간 %s 상태는 체크로 역행시키지 않는다', status => {
    expect(planOrderItemToggle(make(status,[true]),0,'담당자','지금')?.status).toBe(status);
  });
  /*  **작업완료는 되돌아간다**(2026-09-12 사장님) — 상태가 안 바뀌면 되돌리기 경로를 안 타고
      생산에 쓴 부자재·원료가 빠진 채로 남는다. */
  it('작업완료에서 체크를 풀면 작업중(하나도 안 남으면 대기중)으로 내려간다', () => {
    expect(planOrderItemToggle(make(OrderStatus.DISPATCHED,[true,true]),0,'담당자','지금')?.status).toBe(OrderStatus.PROCESSING);
    expect(planOrderItemToggle(make(OrderStatus.DISPATCHED,[true]),0,'담당자','지금')?.status).toBe(OrderStatus.PENDING);
  });
  it('작업완료에서 다시 체크하면 작업완료 그대로', () => {
    expect(planOrderItemToggle(make(OrderStatus.DISPATCHED,[true,false]),1,'담당자','지금')?.status).toBe(OrderStatus.DISPATCHED);
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

describe('실패한 재고 작업 재개 범위', () => {
  const op = (id: string, kind?: 'line' | 'status') => ({
    id, kind, targetStatus: OrderStatus.PROCESSING, state: 'failed' as const,
    startedAt: '2026-09-17T00:00:00.000Z', actor: '담당자',
  });

  it('품목 작업은 새 형식과 옛 order-line 실패 기록 모두 재개한다', () => {
    expect(canResumeFailedInventoryOperation(op('new', 'line'), { ...op('retry', 'line'), state: 'processing' })).toBe(true);
    expect(canResumeFailedInventoryOperation(op('order-line-failed-old'), { ...op('retry', 'line'), state: 'processing' })).toBe(true);
  });

  it('주문 전체 상태 작업과 종류가 다른 재시도는 자동으로 풀지 않는다', () => {
    expect(canResumeFailedInventoryOperation(op('status', 'status'), { ...op('retry', 'line'), state: 'processing' })).toBe(false);
    expect(canResumeFailedInventoryOperation(op('line', 'line'), { ...op('retry', 'status'), state: 'processing' })).toBe(false);
  });
});
