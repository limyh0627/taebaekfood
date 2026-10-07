/** @vitest-environment jsdom */
import { useEffect, useState } from 'react';
import { readFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
type Row = { id: string; date: string };
const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
const start = source.indexOf('  useEffect(() => {', source.indexOf('// 원료수불부/재고관리 화면에'));
const end = source.indexOf('  }, [docTab, currentView, ledgerReloadKey, companyId]);', start);
if (start < 0 || end < start) throw new Error('원료 이력 조회 효과를 찾지 못했습니다.');
const body = source.slice(start + '  useEffect(() => {'.length, end).replace("fetchCollection<import('../../shared/types').RawMaterialEntry>", 'fetchCollection');
const runEffect = new Function('fetchCollection', 'where', 'today', 'companyId', 'setExtraRawMaterialLedger', 'docTab', 'currentView', body);
const fetchCollection = vi.fn();
const deferred = () => { let resolve!: (rows: Row[]) => void; let reject!: (e: Error) => void; const promise = new Promise<Row[]>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function useHistory(companyId: string, reload: number, currentView = 'inventory') {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => runEffect(fetchCollection, (_f: string, _op: string, value: string) => ({ value }), () => '2026-10-07', companyId, setRows, '', currentView), [companyId, reload, currentView]);
  return rows;
}
beforeEach(() => fetchCollection.mockReset());
afterEach(() => vi.restoreAllMocks());
it('회사 전환 뒤 이전 응답이 새 회사 이력을 지우지 않는다', async () => {
  const a = deferred(), b = deferred(); fetchCollection.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view = renderHook(({ company }) => useHistory(company, 0), { initialProps: { company: 'taebaek' } });
  view.rerender({ company: 'punghoe' });
  await act(async () => b.resolve([{ id: 'b', date: '2026-09-30' }]));
  await act(async () => a.resolve([{ id: 'a', date: '2026-09-30' }]));
  expect(view.result.current.map(r => r.id)).toEqual(['b']);
});
it('같은 회사 재조회와 화면 이탈의 늦은 결과를 무시한다', async () => {
  const old = deferred(), next = deferred(); fetchCollection.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = renderHook(({ reload, screen }) => useHistory('taebaek', reload, screen), { initialProps: { reload: 0, screen: 'inventory' } });
  view.rerender({ reload: 1, screen: 'inventory' });
  await act(async () => next.resolve([{ id: 'new', date: '2026-10-07' }]));
  await act(async () => old.resolve([{ id: 'old', date: '2026-10-07' }]));
  expect(view.result.current.map(r => r.id)).toEqual(['new']);
  const late = deferred(); fetchCollection.mockReturnValueOnce(late.promise);
  view.rerender({ reload: 2, screen: 'inventory' }); view.rerender({ reload: 2, screen: 'home' });
  await act(async () => late.resolve([{ id: 'late', date: '2026-10-07' }]));
  expect(view.result.current.map(r => r.id)).toEqual(['new']);
});
it('기존 회사 조회 및 날짜 경계를 유지한다', async () => {
  fetchCollection.mockResolvedValue(['2019-12-31', '2020-01-01', '2026-10-07', '2026-10-08'].map(date => ({ id: date, date })));
  const view = renderHook(() => useHistory('punghoe', 0)); await act(async () => {});
  expect(fetchCollection.mock.calls[0]).toEqual(['rawMaterialLedger', [{ value: 'punghoe' }]]);
  expect(view.result.current.map(r => r.date)).toEqual(['2020-01-01', '2026-10-07']);
});
it('현재 실패는 알리고 언마운트 뒤 늦은 실패는 무시한다', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const current = deferred(), late = deferred(); fetchCollection.mockReturnValueOnce(current.promise).mockReturnValueOnce(late.promise);
  const view = renderHook(({ reload }) => useHistory('taebaek', reload), { initialProps: { reload: 0 } });
  await act(async () => current.reject(new Error('현재 실패'))); expect(spy).toHaveBeenCalledTimes(1);
  view.rerender({ reload: 1 }); view.unmount();
  await act(async () => late.reject(new Error('늦은 실패'))); expect(spy).toHaveBeenCalledTimes(1);
});
