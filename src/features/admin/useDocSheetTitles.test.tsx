/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompanyId } from '../../shared/types';
import { useDocSheetTitles } from './useDocSheetTitles';

const calls = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock('../../shared/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (collection: string, ...clauses: unknown[]) => ({ collection, clauses }),
  getDocs: calls.getDocs,
}));
const deferred = () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof snapshot>>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const snapshot = (title: string) => ({ docs: [{ id: '참기름', data: () => ({ title }) }] });
beforeEach(() => { calls.getDocs.mockReset(); });

it('회사 전환 후 이전 회사의 늦은 제목 응답이 현재 제목을 덮어쓰지 않는다', async () => {
  const oldRequest = deferred();
  const nextRequest = deferred();
  calls.getDocs.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(nextRequest.promise);
  const { result, rerender } = renderHook(({ companyId }: { companyId: CompanyId }) => useDocSheetTitles(companyId), {
    initialProps: { companyId: 'taebaek' as CompanyId },
  });
  rerender({ companyId: 'punghoe' });
  await act(async () => { nextRequest.resolve(snapshot('풍회 제목')); });
  expect(result.current[0]).toEqual({ 참기름: '풍회 제목' });
  await act(async () => { oldRequest.resolve(snapshot('태백 제목')); });
  expect(result.current[0]).toEqual({ 참기름: '풍회 제목' });
  expect(calls.getDocs.mock.calls.map(([value]) => value.clauses[0].value)).toEqual(['taebaek', 'punghoe']);
});

it('회사 전환 직후 이전 제목을 비우고 새 회사 조회 실패 시 기본 제목을 사용한다', async () => {
  const oldRequest = deferred();
  const nextRequest = deferred();
  calls.getDocs.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(nextRequest.promise);
  const { result, rerender } = renderHook(({ companyId }: { companyId: CompanyId }) => useDocSheetTitles(companyId), {
    initialProps: { companyId: 'taebaek' as CompanyId },
  });
  await act(async () => { oldRequest.resolve(snapshot('태백 제목')); });
  expect(result.current[0]).toEqual({ 참기름: '태백 제목' });
  rerender({ companyId: 'punghoe' });
  expect(result.current[0]).toEqual({});
  await act(async () => { nextRequest.reject(new Error('조회 실패')); });
  expect(result.current[0]).toEqual({});
});

it('이전 회사 요청 오류는 새 회사 제목을 변경하지 않는다', async () => {
  const oldRequest = deferred();
  const nextRequest = deferred();
  calls.getDocs.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(nextRequest.promise);
  const { result, rerender } = renderHook(({ companyId }: { companyId: CompanyId }) => useDocSheetTitles(companyId), {
    initialProps: { companyId: 'taebaek' as CompanyId },
  });
  rerender({ companyId: 'punghoe' });
  await act(async () => { nextRequest.resolve(snapshot('풍회 제목')); });
  await act(async () => { oldRequest.reject(new Error('이전 조회 실패')); });
  expect(result.current[0]).toEqual({ 참기름: '풍회 제목' });
  // 기존 renameSheet가 사용하는 setter도 유지한다.
  act(() => { result.current[1]({ 참기름: '직접 고친 제목' }); });
  expect(result.current[0]).toEqual({ 참기름: '직접 고친 제목' });
});

it('언마운트 뒤 도착한 응답은 제목 자료도 읽지 않는다', async () => {
  const request = deferred();
  calls.getDocs.mockReturnValueOnce(request.promise);
  const { unmount } = renderHook(() => useDocSheetTitles('taebaek'));
  unmount();
  const data = vi.fn(() => ({ title: '늦은 제목' }));
  await act(async () => { request.resolve({ docs: [{ id: '참기름', data }] }); });
  expect(data).not.toHaveBeenCalled();
});
