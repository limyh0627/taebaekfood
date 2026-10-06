/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Order } from '../types';
import { today } from '../day';
import { useAppData } from './useAppData';

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ company: string; resolve: (orders: Order[]) => void }>,
  fetchCollection: vi.fn(),
  onOrders: null as null | ((orders: Order[]) => void),
  listeners: [] as Array<{ name: string; callback: (rows: any[]) => void }>,
}));

vi.mock('../firebase', () => ({ authReady: Promise.resolve() }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: unknown) => ({ field, op, value }) }));
vi.mock('../services/firebaseService', () => ({
  subscribeToCollection: (collection: string, callback: (orders: Order[]) => void) => {
    mock.listeners.push({ name: collection, callback });
    if (collection === 'orders') mock.onOrders = callback;
    return () => {};
  },
  subscribeToRecentCollection: () => () => {},
  subscribeToDocument: () => () => {},
  fetchDateRange: async () => [],
  fetchCollection: mock.fetchCollection,
}));

const order = (id: string, companyId: 'taebaek' | 'punghoe') => ({ id, companyId }) as Order;

describe('과거 주문 회사 전환', () => {
  beforeEach(() => {
    mock.requests.length = 0;
    mock.onOrders = null;
    mock.fetchCollection.mockImplementation((collection: string, clauses: Array<{ field: string; value: unknown }>) => {
      if (collection !== 'orders') return Promise.resolve([]);
      return new Promise<Order[]>(resolve => {
        mock.requests.push({ company: String(clauses.find(clause => clause.field === 'companyId')?.value), resolve });
      });
    });
  });

  it('동일 범위를 새 회사에서 다시 조회하고 늦게 끝난 옛 회사 요청을 버린다', async () => {
    const { result, rerender } = renderHook(({ company }) => useAppData(true, company, true), {
      initialProps: { company: 'taebaek' as 'taebaek' | 'punghoe' },
    });
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(1));

    rerender({ company: 'punghoe' });
    expect(result.current.historicalOrders).toEqual([]);
    let newRequest!: Promise<void>;
    act(() => { newRequest = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(2));
    expect(mock.requests.map(request => request.company)).toEqual(['taebaek', 'punghoe']);

    await act(async () => { mock.requests[0].resolve([order('old', 'taebaek')]); await oldRequest; });
    expect(result.current.historicalOrders).toEqual([]);
    await act(async () => { mock.requests[1].resolve([order('new', 'punghoe')]); await newRequest; });
    expect(result.current.historicalOrders.map(value => value.id)).toEqual(['new']);
  });

  it('로그아웃 뒤 같은 회사로 다시 로그인해도 전 세션 이력을 즉시 노출하지 않는다', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAppData(enabled, 'taebaek', true), {
      initialProps: { enabled: true },
    });
    let request!: Promise<void>;
    act(() => { request = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(1));
    await act(async () => { mock.requests[0].resolve([order('old', 'taebaek')]); await request; });
    expect(result.current.historicalOrders.map(value => value.id)).toEqual(['old']);
    rerender({ enabled: false });
    expect(result.current.historicalOrders).toEqual([]);
    rerender({ enabled: true });
    expect(result.current.historicalOrders).toEqual([]);
  });
});

it('직원은 재무 구독을 걸지 않고 회사 전환 뒤 늦은 업무 응답을 무시한다', async () => {
  mock.listeners.length = 0;
  mock.fetchCollection.mockResolvedValue([]);
  const { result, rerender } = renderHook(({ company }) => useAppData(true, company, false), {
    initialProps: { company: 'taebaek' as 'taebaek' | 'punghoe' },
  });
  await waitFor(() => expect(mock.listeners.some(row => row.name === 'items')).toBe(true));
  expect(mock.listeners.map(row => row.name)).not.toContain('issuedStatements');
  expect(mock.listeners.map(row => row.name)).not.toContain('cashEntries');
  const oldItems = mock.listeners.find(row => row.name === 'items')!;
  act(() => oldItems.callback([{ id: 'old', companyId: 'taebaek' }]));
  expect(result.current.items.map(row => row.id)).toEqual(['old']);
  rerender({ company: 'punghoe' });
  expect(result.current.items).toEqual([]);
  await waitFor(() => expect(mock.listeners.filter(row => row.name === 'items')).toHaveLength(2));
  const newItems = mock.listeners.filter(row => row.name === 'items')[1];
  act(() => newItems.callback([{ id: 'new', companyId: 'punghoe' }]));
  act(() => oldItems.callback([{ id: 'late', companyId: 'taebaek' }]));
  expect(result.current.items.map(row => row.id)).toEqual(['new']);
});

it('구독 월을 줄여도 오래된 진행 주문은 남기고 완료 주문만 완료일로 제한한다', async () => {
  const { result } = renderHook(() => useAppData(true, 'taebaek', true));
  await waitFor(() => expect(mock.onOrders).not.toBeNull());
  act(() => result.current.setOrdersMonths(1));
  await waitFor(() => expect(mock.onOrders).not.toBeNull());
  const active = [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DISPATCHED, OrderStatus.ON_HOLD]
    .map(status => ({ ...order(status, 'taebaek'), status, createdAt: '2020-01-01T00:00:00Z' }));
  const recentDone = { ...order('recent-done', 'taebaek'), status: OrderStatus.DELIVERED, createdAt: '2020-01-01T00:00:00Z', deliveredAt: today() };
  const oldDone = { ...order('old-done', 'taebaek'), status: OrderStatus.DELIVERED, createdAt: '2020-01-01T00:00:00Z', deliveredAt: '2020-01-02' };
  act(() => mock.onOrders!([...active, recentDone, oldDone]));
  expect(result.current.orders.map(value => value.id)).toEqual([...active.map(value => value.id), 'recent-done']);
});
