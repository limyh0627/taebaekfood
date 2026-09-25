/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../types';
import { useAppData } from './useAppData';

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ company: string; resolve: (orders: Order[]) => void }>,
  fetchCollection: vi.fn(),
}));

vi.mock('../firebase', () => ({ authReady: Promise.resolve() }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: unknown) => ({ field, op, value }) }));
vi.mock('../services/firebaseService', () => ({
  subscribeToCollection: () => () => {},
  subscribeToRecentCollection: () => () => {},
  subscribeToDocument: () => () => {},
  fetchDateRange: async () => [],
  fetchCollection: mock.fetchCollection,
}));

const order = (id: string, companyId: 'taebaek' | 'punghoe') => ({ id, companyId }) as Order;

describe('과거 주문 회사 전환', () => {
  beforeEach(() => {
    mock.requests.length = 0;
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
