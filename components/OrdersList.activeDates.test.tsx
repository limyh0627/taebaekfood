/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi, afterEach } from 'vitest';
import { OrderStatus, type Item, type Order } from '../types';
import { today } from '../src/shared/day';
import OrdersList from './OrdersList';
import { mergeCompanyOrders } from '../src/features/admin/companyOrders';

afterEach(() => vi.useRealTimers());

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
  for (const order of active) expect(document.getElementById(`order-card-${order.id}`)?.textContent).toContain('이월');
  expect(screen.getByText('진행 중 주문 전체 · 날짜 제한 없음')).toBeTruthy();
  expect(screen.queryByLabelText('완료일 시작')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '리스트' }));
  const list = screen.getByRole('table', { name: '주문 리스트' });
  for (const order of active) expect(list.textContent).toContain(order.partnerName);
  expect(list.textContent?.match(/이월/g)).toHaveLength(5);
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

it('한국 월 경계와 회사 전환에서 이월 주문·검색 건수는 중복되지 않는다', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
  const previous = statuses.map((status, index) => ({ ...makeOrder(`old-${index}`, status), companyId: 'taebaek' as const,
    partnerName: '월경계 거래처', cardNo: `ORD-260930-00${index}`, createdAt: '2026-09-30T14:59:59Z' }));
  const current = { ...makeOrder('new-month', OrderStatus.PENDING), companyId: 'taebaek' as const, createdAt: '2026-09-30T15:00:00Z' };
  const foreign = { ...makeOrder('foreign', OrderStatus.ON_HOLD), companyId: 'punghoe' as const };
  const props = { companyId: 'taebaek' as const, title: '주문', subtitle: '', groupBy: 'status' as const, allowedStatuses: statuses,
    partners: [], items: [item], onUpdateStatus: vi.fn(), onUpdateDeliveryDate: vi.fn(), onDeleteOrder: vi.fn(), onAddClick: vi.fn() };
  const live = [...previous, current, foreign];
  const historical = [{ ...previous[0], partnerName: '오래된 스냅샷' }, foreign];
  const view = render(<OrdersList {...props} orders={mergeCompanyOrders(live, historical, 'taebaek')} />);
  expect(document.getElementById('order-card-old-0')?.textContent).toContain('이월');
  expect(document.getElementById('order-card-new-month')?.textContent).not.toContain('이월');
  expect(document.getElementById('order-card-foreign')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '리스트' }));
  expect(screen.getByRole('heading', { name: '조회 결과 6건' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '전체 검색' }), { target: { value: '월경계 거래처' } });
  expect(screen.getByRole('heading', { name: '조회 결과 5건' })).toBeTruthy();
  expect(screen.getByRole('table', { name: '주문 리스트' }).textContent?.match(/이월/g)).toHaveLength(5);
  fireEvent.change(screen.getByRole('searchbox', { name: '전체 검색' }), { target: { value: 'ORD-260930-000' } });
  expect(screen.getByRole('heading', { name: '조회 결과 1건' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '전체 검색' }), { target: { value: '' } });
  view.rerender(<OrdersList {...props} companyId="punghoe" orders={mergeCompanyOrders(live, historical, 'punghoe')} />);
  const list = screen.getByRole('table', { name: '주문 리스트' });
  expect(list.textContent).toContain('foreign');
  expect(list.textContent).not.toContain('월경계 거래처');
  expect(screen.getByRole('heading', { name: '조회 결과 1건' })).toBeTruthy();
});
