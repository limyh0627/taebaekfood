import { describe, expect, it } from 'vitest';
import { buildOrderDeletePlan, type OrderDeleteProgress } from './rollbackSummary';
import { OrderStatus, type Order, type Item } from '../../shared/types';

const items = [{ id: 'product', name: '제품', unit: '병' }, { id: 'cap', name: '캡', unit: '개' }] as Item[];
const snapshot = (stockDeltas = [{ itemId: 'product', delta: 10 }, { itemId: 'cap', delta: -10 }]) => ({ capturedAt: '2026-09-29', stockDeltas, bomLines: [] });
const raw = (ledgerOnly = false) => ({ material: '참기름', rawItemId: 'raw', operationId: 'use-1', supplierName: '공급', kg: 3, ledgerOnly });
const order = (over: Partial<Order> = {}) => ({ id: 'order', status: OrderStatus.DISPATCHED, items: [{ itemId: 'product', quantity: 999 }], producedAt: '2026-09-29', inventorySnapshots: { version: 1, production: snapshot() }, ...over }) as Order;
const line = (applied = true) => ({ version: 1 as const, lineId: 'line', itemId: 'product', applied, attempt: 1, rawConsumedLots: [raw()], producedUnits: [{ itemId: 'product', qty: 10 }], autoBuilt: [], production: snapshot() });
const progress = (over: Partial<OrderDeleteProgress> = {}): OrderDeleteProgress => ({ action: 'delete', state: 'failed', completedStages: [], inventoryApplied: 'none', retryable: true, error: '저장 실패', ...over });

describe('주문 삭제 경고', () => {
  it('출고 상태에서는 출고만 취소하고 생산과 주문을 유지한다', () => {
    const plan = buildOrderDeletePlan(order({ status: OrderStatus.SHIPPED, shippedOut: true, rawConsumedLots: [raw()], inventorySnapshots: { version: 1, production: snapshot(), shipment: snapshot([{ itemId: 'product', delta: -7 }]) } }), items);
    expect(plan.action).toBe('cancel-shipment');
    expect(plan.nextStatus).toBe('DISPATCHED');
    expect(plan.adjustments.map(row => [row.itemId, row.delta, row.reason])).toEqual([['product', 7, '출고 취소']]);
    expect(plan.subMessage).toContain('별도로 승인');
    expect(plan.subMessage).not.toContain('원료 로트 복원');
  });
  it('작업완료 삭제는 주문 수량 대신 당시 증감으로 안내한다', () => {
    const plan = buildOrderDeletePlan(order({ rawConsumedLots: [raw()] }), items);
    expect(plan.allowed).toBe(true);
    expect(plan.action).toBe('delete');
    expect(plan.adjustments.map(row => row.delta)).toEqual([-10, 10]);
    expect(plan.subMessage).toContain('참기름 3kg');
    expect(plan.subMessage).not.toContain('999');
  });
  it.each(['DELIVERED', 'SHIPPED'] as const)('근거 없는 %s는 차단한다', status => {
    expect(buildOrderDeletePlan(order({ status: status as OrderStatus }), items).allowed).toBe(false);
  });
  it('생산 근거 부재와 잘못된 수량은 현재 BOM으로 추정하지 않는다', () => {
    expect(buildOrderDeletePlan(order({ inventorySnapshots: undefined }), items).allowed).toBe(false);
    expect(buildOrderDeletePlan(order({ inventorySnapshots: { version: 1, production: snapshot([{ itemId: 'cap', delta: NaN }]) } }), items).allowed).toBe(false);
  });
  it('활성 줄만 읽고 상위 합계와 취소된 줄을 중복 계산하지 않는다', () => {
    const plan = buildOrderDeletePlan(order({ itemInventory: { active: line(), old: line(false) }, rawConsumedLots: [raw()] }), items);
    expect(plan.adjustments.map(row => row.delta)).toEqual([-10, 10]);
    expect(plan.subMessage.match(/원료 로트 복원/g)).toHaveLength(1);
  });
  it('전부 취소된 줄은 상위의 남은 기록으로 다시 복원하지 않는다', () => {
    expect(buildOrderDeletePlan(order({ itemInventory: { old: line(false) } }), items).adjustments).toEqual([]);
  });
  it('명시적인 생산량 0은 기존 재고 판매로서 추가 원복하지 않는다', () => {
    const plan = buildOrderDeletePlan(order({ producedUnits: [], inventorySnapshots: { version: 1, production: snapshot([]) } }), items);
    expect(plan.allowed).toBe(true);
    expect(plan.adjustments).toEqual([]);
  });
  it('현재 품목의 단위와 분류 변경은 당시 수량을 바꾸지 않는다', () => {
    const original = buildOrderDeletePlan(order(), items);
    const changed = buildOrderDeletePlan(order(), items.map(row => ({ ...row, unit: '박스', packSize: 100, category: 'RAW' })) as Item[]);
    expect(changed.adjustments.map(row => row.delta)).toEqual(original.adjustments.map(row => row.delta));
  });
  it('원장 전용 원료에는 실물 복원을 안내하지 않는다', () => {
    const plan = buildOrderDeletePlan(order({ rawConsumedLots: [raw(true)] }), items);
    expect(plan.subMessage).toContain('실물 재고 복원 없음');
    expect(plan.subMessage).not.toContain('원료 로트 복원');
  });
  it('원료 명령 번호가 없으면 차단한다', () => {
    expect(buildOrderDeletePlan(order({ rawConsumedLots: [{ ...raw(), operationId: undefined }] }), items).allowed).toBe(false);
  });
  it('기존 재고 처리 기록은 확인 없이 실행하지 않는다', () => {
    expect(buildOrderDeletePlan(order({ inventoryOperation: { id: 'op', targetStatus: OrderStatus.PENDING, state: 'failed', startedAt: 'today', actor: 'tester' } }), items).allowed).toBe(false);
  });
  it('처리 중에는 다른 상태 변경을 막고 재조회를 안내한다', () => {
    const plan = buildOrderDeletePlan(order(), items, progress({ state: 'processing' }));
    expect(plan.allowed).toBe(false);
    expect(plan.subMessage).toContain('다른 상태 변경');
  });
  it('반영 없는 실패는 엔진이 허용한 동일 작업만 재시도한다', () => {
    const plan = buildOrderDeletePlan(order(), items, progress());
    expect(plan.allowed).toBe(true);
    expect(plan.retryable).toBe(true);
    expect(plan.subMessage).toContain('저장 실패');
    expect(plan.subMessage).toContain('재고 반영 없음');
    expect(buildOrderDeletePlan(order(), items, progress({ action: 'cancel-shipment' })).allowed).toBe(false);
    expect(buildOrderDeletePlan(order(), items, progress({ retryable: false })).allowed).toBe(false);
  });
  it.each(['partial', 'unknown'] as const)('반영 %s는 차단하고 완료 단계는 재복원하지 않는다', inventoryApplied => {
    const plan = buildOrderDeletePlan(order({ rawConsumedLots: [raw()] }), items, progress({ state: 'partial', inventoryApplied, completedStages: ['production', 'raw'] }));
    expect(plan.allowed).toBe(false);
    expect(plan.adjustments).toEqual([]);
    expect(plan.subMessage).not.toContain('원료 로트 복원');
    expect(plan.subMessage).toContain('자동 재개는 보장되지 않습니다');
  });
  it('출고 취소 완료 후 연속 삭제하지 않는다', () => {
    const plan = buildOrderDeletePlan(order(), items, progress({ action: 'cancel-shipment', state: 'completed', completedStages: ['shipment'], inventoryApplied: 'complete' }));
    expect(plan.allowed).toBe(false);
    expect(plan.message).toBe('출고 취소가 완료되었습니다.');
    expect(plan.adjustments).toEqual([]);
    expect(plan.subMessage).toContain('별도의 사용자 승인');
  });
  it.each([OrderStatus.PENDING, OrderStatus.PROCESSING])('생산 없는 %s는 재고 변경 없이 주문만 삭제한다', status => {
    const plan = buildOrderDeletePlan(order({ status, producedAt: undefined, inventorySnapshots: undefined }), items);
    expect(plan.allowed).toBe(true);
    expect(plan.confirmText).toBe('주문 삭제');
    expect(plan.subMessage).toContain('재고는 변경하지 않고 주문만 삭제');
  });
  it('완료 단계는 한국어로 표시한다', () => {
    const plan = buildOrderDeletePlan(order(), items, progress({ state: 'partial', completedStages: ['production', 'raw'] }));
    expect(plan.subMessage).toContain('완료 단계: 생산 취소, 원료 복원');
    expect(plan.subMessage).not.toContain('production');
  });
  it('입력 주문과 진행 상태를 변경하지 않는다', () => {
    const data = { order: order({ itemInventory: { active: line() } }), items, progress: progress() };
    const before = JSON.stringify(data);
    buildOrderDeletePlan(data.order, data.items, data.progress);
    expect(JSON.stringify(data)).toBe(before);
  });
});
