/** @vitest-environment jsdom */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import { openingDocId } from '../src/shared/types';

const calls = vi.hoisted(() => ({ fetchWhere: vi.fn(), projection: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchWhere: calls.fetchWhere }));
vi.mock('../src/features/admin/profitPeriodProjection', async importOriginal => {
  const original = await importOriginal<typeof import('../src/features/admin/profitPeriodProjection')>();
  return { buildProfitPeriodProjection: (...args: Parameters<typeof original.buildProfitPeriodProjection>) => {
    calls.projection(...args);
    return original.buildProfitPeriodProjection(...args);
  } };
});
const deferred = () => {
  let resolve!: (value: unknown[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const doc = (companyId: 'taebaek' | 'punghoe', amount: number) => [{ id: openingDocId(companyId), date: '2026-09-30', amounts: { '120': amount } }];
const props = { issuedStatements: [], cashEntries: [], initialTab: 'partners' as const };
const latestOpening = () => calls.projection.mock.calls.at(-1)?.[0].opening;
beforeEach(() => { calls.fetchWhere.mockReset(); calls.projection.mockClear(); });

it('회사 변경 후 새 기초잔액을 읽는 동안 이전 회사 잔액을 계산에 전달하지 않는다', async () => {
  const first = deferred(); const second = deferred();
  calls.fetchWhere.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<ProfitAnalysis {...props} companyId="taebaek" />);
  await act(async () => first.resolve(doc('taebaek', 111)));
  expect(latestOpening()?.lines).toEqual([{ accountCode: '120', amount: 111 }]);
  view.rerender(<ProfitAnalysis {...props} companyId="punghoe" />);
  expect(latestOpening()).toBeNull();
  await act(async () => second.resolve(doc('punghoe', 222)));
  expect(latestOpening()?.lines).toEqual([{ accountCode: '120', amount: 222 }]);
});

it('이전 회사의 늦은 응답이 현재 회사 기초잔액을 덮어쓰지 않는다', async () => {
  const first = deferred(); const second = deferred();
  calls.fetchWhere.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<ProfitAnalysis {...props} companyId="taebaek" />);
  view.rerender(<ProfitAnalysis {...props} companyId="punghoe" />);
  await act(async () => second.resolve(doc('punghoe', 222)));
  expect(latestOpening()?.lines).toEqual([{ accountCode: '120', amount: 222 }]);
  await act(async () => first.resolve(doc('taebaek', 111)));
  expect(latestOpening()?.lines).toEqual([{ accountCode: '120', amount: 222 }]);
});

it('이전 회사 조회의 늦은 실패도 현재 잔액에 영향을 주지 않는다', async () => {
  const first = deferred(); const second = deferred();
  calls.fetchWhere.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<ProfitAnalysis {...props} companyId="taebaek" />);
  view.rerender(<ProfitAnalysis {...props} companyId="punghoe" />);
  await act(async () => second.resolve(doc('punghoe', 222)));
  await act(async () => first.reject(new Error('이전 회사 조회 실패')));
  expect(latestOpening()?.lines).toEqual([{ accountCode: '120', amount: 222 }]);
});

it('현재 회사에 기초잔액이 없거나 조회가 실패하면 이전 잔액을 복구하지 않는다', async () => {
  const first = deferred(); const second = deferred(); const third = deferred();
  calls.fetchWhere.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const view = render(<ProfitAnalysis {...props} companyId="taebaek" />);
  await act(async () => first.resolve(doc('taebaek', 111)));
  view.rerender(<ProfitAnalysis {...props} companyId="punghoe" />);
  await act(async () => second.resolve([]));
  expect(latestOpening()).toBeNull();
  view.rerender(<ProfitAnalysis {...props} companyId="taebaek" />);
  await act(async () => third.reject(new Error('현재 조회 실패')));
  expect(latestOpening()).toBeNull();
});
