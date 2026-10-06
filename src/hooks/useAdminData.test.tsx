/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAdminData } from './useAdminData';

const listeners = vi.hoisted(() => [] as Array<{ company: string; callback: (rows: any[]) => void; stop: ReturnType<typeof vi.fn> }>);
vi.mock('../shared/firebase', () => ({ authReady: Promise.resolve() }));
vi.mock('firebase/firestore', () => ({ where: (_f: string, _o: string, value: string) => value }));
vi.mock('../services/firebaseService', () => ({
  subscribeToCollection: (_name: string, callback: (rows: any[]) => void, constraints: string[]) => {
    const stop = vi.fn(); listeners.push({ company: constraints[0], callback, stop }); return stop;
  },
}));
beforeEach(() => { listeners.length = 0; });

it('직원에게 관리자 구독을 시작하지 않는다', async () => {
  const { result } = renderHook(() => useAdminData(false, 'taebaek'));
  await act(async () => {});
  expect(listeners).toHaveLength(0);
  expect(result.current).toEqual({ fixedCosts: [], productionRecords: [] });
});

it('회사 전환·권한 해제 즉시 옛 자료를 숨기고 늦은 구독 응답을 무시한다', async () => {
  const { result, rerender } = renderHook(({ enabled, company }) => useAdminData(enabled, company), {
    initialProps: { enabled: true, company: 'taebaek' as 'taebaek' | 'punghoe' },
  });
  await waitFor(() => expect(listeners).toHaveLength(2));
  act(() => listeners[0].callback([{ id: 'old' }]));
  expect(result.current.fixedCosts).toHaveLength(1);
  rerender({ enabled: true, company: 'punghoe' });
  expect(result.current.fixedCosts).toEqual([]);
  await waitFor(() => expect(listeners).toHaveLength(4));
  act(() => { listeners[0].callback([{ id: 'late' }]); listeners[2].callback([{ id: 'new' }]); });
  expect(result.current.fixedCosts.map(row => row.id)).toEqual(['new']);
  expect(listeners[0].stop).toHaveBeenCalled();
  rerender({ enabled: false, company: 'punghoe' });
  act(() => listeners[2].callback([{ id: 'late' }]));
  expect(result.current.fixedCosts).toEqual([]);
});
