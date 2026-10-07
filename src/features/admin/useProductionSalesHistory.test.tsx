/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductionSalesHistory } from './useProductionSalesHistory';
import type { CompanyId, ProductionSalesLog } from '../../shared/types';
const { fetchDateRange } = vi.hoisted(() => ({ fetchDateRange: vi.fn() }));
vi.mock('../../shared/services/firebaseService', () => ({ fetchDateRange }));
const row = (id: string, companyId?: CompanyId, name = id) => ({ id, companyId, date: '2026-09-30', name }) as unknown as ProductionSalesLog;
const deferred = () => { let resolve!: (value: ProductionSalesLog[]) => void; let reject!: (error: Error) => void; const promise = new Promise<ProductionSalesLog[]>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
describe('회사별 과거 생산판매일지', () => {
  beforeEach(() => { fetchDateRange.mockReset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T03:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('이전 회사 이력을 즉시 감추고 늦은 이전 응답은 새 회사 응답을 덮어쓰지 않는다', async () => {
    const a = deferred(), b = deferred();
    fetchDateRange.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const view = renderHook(({ companyId, live }) => useProductionSalesHistory(companyId, live), { initialProps: { companyId: 'taebaek' as CompanyId, live: [row('live-a', 'taebaek')] } });
    view.rerender({ companyId: 'punghoe', live: [row('live-a', 'taebaek')] });
    expect(view.result.current).toEqual([]);
    await act(async () => b.resolve([row('b', 'punghoe')]));
    await act(async () => a.resolve([row('a', 'taebaek')]));
    expect(view.result.current.map(x => x.id)).toEqual(['b']);
  });
  it('기존 회사 조회가 이미 끝난 뒤 전환해도 과거 이력을 즉시 제거한다', async () => {
    const a = deferred(), b = deferred();
    fetchDateRange.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const view = renderHook(({ companyId }) => useProductionSalesHistory(companyId, []), { initialProps: { companyId: 'taebaek' as CompanyId } });
    await act(async () => a.resolve([row('a', 'taebaek')]));
    expect(view.result.current.map(x => x.id)).toEqual(['a']);
    view.rerender({ companyId: 'punghoe' });
    expect(view.result.current).toEqual([]);
  });
  it('동일 ID 최신 구독을 우선하고 회사 없는 옛 문서는 태백으로만 읽는다', async () => {
    fetchDateRange.mockResolvedValue([row('same', 'taebaek', 'old'), row('legacy'), row('foreign', 'punghoe')]);
    const view = renderHook(() => useProductionSalesHistory('taebaek', [row('same', 'taebaek', 'new'), row('foreign-live', 'punghoe')]));
    await act(async () => {});
    expect(view.result.current.map(x => x.id)).toEqual(['same', 'legacy']);
    expect((view.result.current[0] as any).name).toBe('new');
    const foreign = renderHook(() => useProductionSalesHistory('punghoe', [row('legacy-live')]));
    await act(async () => {});
    expect(foreign.result.current.map(x => x.id)).toEqual(['foreign']);
  });
  it('기존 24개월 기간과 회사 조건을 유지하고 조회 실패에도 현재 구독을 보존한다', async () => {
    const request = deferred();
    fetchDateRange.mockReturnValue(request.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderHook(() => useProductionSalesHistory('taebaek', [row('live', 'taebaek')]));
    const args = fetchDateRange.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(['productionSalesLogs', 'date', '2024-10-07', '2026-10-07']);
    expect(args[4][0]).toEqual(expect.objectContaining({ type: 'where', _op: '==', _value: 'taebaek' }));
    await act(async () => request.reject(new Error('조회 실패')));
    expect(view.result.current.map(x => x.id)).toEqual(['live']);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
  it('언마운트 뒤의 조회 실패는 로그나 상태를 갱신하지 않는다', async () => {
    const request = deferred(); fetchDateRange.mockReturnValue(request.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderHook(() => useProductionSalesHistory('taebaek', [])); view.unmount();
    await act(async () => request.reject(new Error('늦은 실패')));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
