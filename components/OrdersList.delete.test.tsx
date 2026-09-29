/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Item, type Order } from '../types';
import OrdersList from './OrdersList';
import fs from 'node:fs';
import ts from 'typescript';

afterEach(() => { cleanup(); localStorage.clear(); });
const order = {
  id: 'delete-ui-order', partnerId: 'partner', partnerName: '삭제검수', status: OrderStatus.PENDING,
  source: '일반', createdAt: '2026-09-29T00:00:00+09:00', deliveryDate: '2026-09-29',
  totalAmount: 0, email: '', items: [{ itemId: 'p1', name: '검수품목', quantity: 1, price: 0 }],
} as Order;
function openEditor(onDeleteOrder: (id: string) => Promise<boolean>) {
  render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status"
    allowedStatuses={[OrderStatus.PENDING]} orders={[order]} partners={[]}
    items={[{ id: 'p1', name: '검수품목', type: 'product', unit: '개', stock: 1 } as Item]}
    onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={onDeleteOrder}
    onAddClick={vi.fn()} />);
  fireEvent.click(screen.getAllByRole('button', { name: '삭제검수 주문 수정' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '주문 전체 삭제' }));
}
describe('주문 전체 삭제 화면 연결', () => {
  it('두 번째 확인창 없이 중앙 처리에 위임하고 완료 전에는 편집창을 유지한다', async () => {
    let resolve!: (value: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    openEditor(handler);
    expect(handler).toHaveBeenCalledExactlyOnceWith(order.id);
    expect(screen.getByText('거래처 주문 수정')).toBeTruthy();
    expect(screen.queryByText('이 거래처 주문을 삭제하시겠습니까?')).toBeNull();
    await act(async () => resolve(false));
    expect(screen.getByText('거래처 주문 수정')).toBeTruthy();
  });
  it('취소·실패·출고취소의 false 결과에서는 편집창을 닫지 않는다', async () => {
    const handler = vi.fn(async () => false);
    openEditor(handler);
    await waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(screen.getByText('거래처 주문 수정')).toBeTruthy();
  });
  it('실제 삭제가 완료됐다는 true 결과를 받은 뒤에만 닫는다', async () => {
    openEditor(vi.fn(async () => true));
    await waitFor(() => expect(screen.queryByText('거래처 주문 수정')).toBeNull());
  });
});

// 거대한 앱 전체를 띄우지 않고 실제 핸들러를 추출한다. 별도 복제 로직을 시험하지 않는다.
const adminSource = fs.readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
const ast = ts.createSourceFile('AdminApp.tsx', adminSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handlerSource = '';
function findHandler(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDeleteOrder') {
    handlerSource = node.initializer!.getText(ast);
  }
  ts.forEachChild(node, findHandler);
}
findHandler(ast);
function handlerHarness(status = OrderStatus.DISPATCHED) {
  const ticket = { orderId: order.id, companyId: 'taebaek', action: status === OrderStatus.SHIPPED ? 'cancel-shipment' : 'delete', evidence: 'abc', operationId: 'op-1' };
  const context = {
    deletingOrders: { current: new Set<string>() }, setProcessingCancellationIds: vi.fn(),
    cancellationScope: { current: 'taebaek:employee' }, setCancellationRevision: vi.fn(),
    auth: { currentUser: { uid: 'test-user' } }, companyId: 'taebaek', localStorage,
    allOrders: [{ ...order, status }], orders: [], allItems: [], OrderStatus,
    appConfirm: vi.fn(async (_options?: unknown) => true), awaitNotice: vi.fn(async () => {}), deleteItem: vi.fn(),
    prepareOrderCancellation: vi.fn(async () => ({ order: { ...order, status }, ticket, recordOnly: status === OrderStatus.DELIVERED })),
    buildOrderDeletePlan: vi.fn(() => ({ allowed: true, action: ticket.action, message: '확인', subMessage: '영향', confirmText: '처리' })),
    readOrderCancellation: vi.fn(async (): Promise<any> => null),
    executeOrderCancellation: vi.fn(async (): Promise<any> => ({ status: 'completed', deleted: ticket.action === 'delete' })),
  };
  const js = ts.transpile(`const handler = ${handlerSource};`, { target: ts.ScriptTarget.ES2022 });
  const invoke = new Function(...Object.keys(context), `${js}; return handler;`)(...Object.values(context)) as (id: string) => Promise<boolean>;
  return { context, ticket, invoke, key: `order-cancellation:test-user:taebaek:${order.id}` };
}
describe('관리자 실제 주문 삭제 핸들러 경계', () => {
  it('예전 주문도 fresh prepare와 원자 서비스만 사용하고 기록전용 경고를 표시한다', async () => {
    const { context, invoke } = handlerHarness(OrderStatus.DELIVERED);
    expect(await invoke(order.id)).toBe(true);
    expect(context.prepareOrderCancellation).toHaveBeenCalledOnce();
    expect(context.executeOrderCancellation).toHaveBeenCalledOnce();
    expect(context.buildOrderDeletePlan).not.toHaveBeenCalled();
    expect(context.appConfirm.mock.calls[0][0]).toMatchObject({ confirmText: '기록 삭제' });
    expect(context.deleteItem).not.toHaveBeenCalled();
  });
  it.each(['APPROVAL_EVIDENCE_CHANGED', 'COMPANY_MISMATCH', 'OTHER_INVENTORY_OPERATION'])('예전 주문의 최종 %s 차단을 직접 삭제로 우회하지 않는다', async code => {
    const { context, invoke, key } = handlerHarness(OrderStatus.DELIVERED);
    context.executeOrderCancellation.mockResolvedValue({ status: 'blocked', code, affectedItemIds: [], inventoryApplied: 'none', retryable: false, deleted: false });
    expect(await invoke(order.id)).toBe(false);
    expect(context.deleteItem).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ code, retryable: false });
  });
  it('출고 취소 성공은 주문 삭제를 호출하지 않고 편집 유지 결과를 준다', async () => {
    const { context, invoke, key } = handlerHarness(OrderStatus.SHIPPED);
    expect(await invoke(order.id)).toBe(false);
    expect(context.executeOrderCancellation).toHaveBeenCalledOnce();
    expect(context.deleteItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('삭제는 서비스 완료만 사용하고 별도 문서 삭제를 이어 호출하지 않는다', async () => {
    const { context, invoke } = handlerHarness();
    expect(await invoke(order.id)).toBe(true);
    expect(context.deleteItem).not.toHaveBeenCalled();
  });
  it('응답 미확인 실패는 ticket을 보존하고 창을 유지한다', async () => {
    const { context, invoke, key } = handlerHarness();
    context.executeOrderCancellation.mockResolvedValue({ status: 'failed', inventoryApplied: 'unknown', retryable: true, affectedItemIds: [], code: 'UNKNOWN' });
    expect(await invoke(order.id)).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ operationId: 'op-1', retryable: true });
    expect(context.deleteItem).not.toHaveBeenCalled();
  });
  it('재접속한 완료 ticket은 조회만 하며 원복을 다시 실행하지 않는다', async () => {
    const { context, ticket, invoke, key } = handlerHarness();
    localStorage.setItem(key, JSON.stringify(ticket));
    context.readOrderCancellation.mockResolvedValue({ status: 'completed', deleted: true });
    expect(await invoke(order.id)).toBe(true);
    expect(context.executeOrderCancellation).not.toHaveBeenCalled();
    expect(context.prepareOrderCancellation).not.toHaveBeenCalled();
  });
  it('다른 회사 ticket에서는 재고 쓰기를 시작하지 않는다', async () => {
    const { context, ticket, invoke, key } = handlerHarness();
    localStorage.setItem(key, JSON.stringify({ ...ticket, companyId: 'punghoe' }));
    expect(await invoke(order.id)).toBe(false);
    expect(context.executeOrderCancellation).not.toHaveBeenCalled();
    expect(context.readOrderCancellation).not.toHaveBeenCalled();
  });
  it('승인 대기 중 회사가 바뀌면 실행하지 않는다', async () => {
    const { context, invoke } = handlerHarness();
    context.appConfirm.mockImplementation(async () => { context.cancellationScope.current = 'punghoe:employee'; return true; });
    expect(await invoke(order.id)).toBe(false);
    expect(context.executeOrderCancellation).not.toHaveBeenCalled();
  });
});
