/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderStatus, type Item, type Order } from '../types';
import { today } from '../src/shared/day';
import OrdersList from './OrdersList';

const statuses = [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DISPATCHED, OrderStatus.ON_HOLD];
const item = { id: 'p1', name: '검수품목', type: 'product', unit: '개', stock: 100 } as Item;
const makeOrder = (id: string, status: OrderStatus, deliveredAt?: string): Order => ({
  id, partnerId: id, partnerName: id, status, source: '일반', createdAt: '2020-01-01T00:00:00Z',
  deliveryDate: today(), deliveredAt, totalAmount: 0, email: '',
  items: [{ itemId: item.id, name: item.name, quantity: 1, price: 0 }],
}) as Order;

it('오래된 진행 주문은 보드·리스트에 남고 완료 이력만 완료일로 거른다', () => {
  const active = statuses.map(status => makeOrder(`active-${status}`, status));
  active[0].cardNo = 'ORD-260922-004';
  render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status"
    allowedStatuses={statuses} orders={[...active, makeOrder('recent-done', OrderStatus.DELIVERED, today()), makeOrder('old-done', OrderStatus.DELIVERED, '2020-01-02')]}
    partners={[]} items={[item]} onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()}
    onDeleteOrder={vi.fn()} onAddClick={vi.fn()} />);

  for (const order of active) expect(document.getElementById(`order-card-${order.id}`)).not.toBeNull();
  expect(screen.getByText('진행 중 주문 전체 · 날짜 제한 없음')).toBeTruthy();
  expect(screen.queryByLabelText('완료일 시작')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '리스트' }));
  const list = screen.getByRole('table', { name: '주문 리스트' });
  for (const order of active) expect(list.textContent).toContain(order.partnerName);
  expect(list.querySelector('[role="columnheader"]')?.parentElement?.textContent).not.toContain('주문일');
  fireEvent.change(screen.getByLabelText('진행 주문일 시작'), { target: { value: today() } });
  expect(list.textContent).not.toContain(active[0].partnerName);
  fireEvent.click(screen.getByRole('button', { name: '기간 전체' }));
  expect(list.textContent).toContain(active[0].partnerName);

  fireEvent.change(screen.getByRole('searchbox', { name: '전체 검색' }), { target: { value: 'ORD-260922-004' } });
  expect(list.textContent).toContain('260922-004');
  expect(list.textContent).not.toContain(active[1].partnerName);
  fireEvent.change(screen.getByRole('searchbox', { name: '전체 검색' }), { target: { value: '' } });

  fireEvent.click(screen.getAllByRole('button', { name: '이력' }).find(button => button.hasAttribute('aria-pressed'))!);
  expect(screen.getByLabelText('완료일 시작')).toBeTruthy();
  expect(screen.getByText('recent-done')).toBeTruthy();
  expect(screen.queryByText('old-done')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '보드' }));
  for (const order of active) expect(document.getElementById(`order-card-${order.id}`)).not.toBeNull();
});
