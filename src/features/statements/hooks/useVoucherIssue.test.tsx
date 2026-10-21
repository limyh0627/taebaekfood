/** @vitest-environment jsdom */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IssuedStatement } from '../../../shared/types';
import { useVoucherIssue, type VoucherIssueOptions } from './useVoucherIssue';
import { storeVoucherPending, voucherPendingKey, type VoucherIssuePending } from '../infrastructure/voucherIssuePending';

const io = vi.hoisted(() => ({ auth: { currentUser: { uid: 'A' } as { uid: string } | null }, listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('../../../shared/firebase', () => ({ auth: io.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => {
  io.listeners.add(listener); listener(io.auth.currentUser); return () => { io.listeners.delete(listener); };
} }));
const deferred = () => {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const entry = (id = 'cash-1', uid = 'A', companyId: 'taebaek' | 'punghoe' = 'taebaek'): VoucherIssuePending => ({
  version: 1, companyId, userId: uid, kind: 'cashEntries',
  document: { id, companyId, date: '2026-10-21', createdAt: 'fixed', dir: '출금', amount: 1000, cashAccountId: 'bank', accountCode: '811', note: '원문' },
});
const key = voucherPendingKey('taebaek', 'A');
const emit = (uid: string | null) => { io.auth.currentUser = uid ? { uid } : null; io.listeners.forEach(listener => listener(io.auth.currentUser)); };
function setup(options: Partial<VoucherIssueOptions> = {}, strict = false) {
  const onApplied = vi.fn(), save = vi.fn().mockResolvedValue({ id: 'saved' });
  const initial: VoucherIssueOptions = { companyId: 'taebaek', onApplied, onIssueCashEntry: save, ...options };
  const hook = renderHook((props: VoucherIssueOptions) => useVoucherIssue(props), { initialProps: initial,
    ...(strict ? { wrapper: ({ children }: { children: React.ReactNode }) => <React.StrictMode>{children}</React.StrictMode> } : {}) });
  return { ...hook, onApplied, save, initial };
}
beforeEach(() => { localStorage.clear(); io.auth.currentUser = { uid: 'A' }; vi.spyOn(window, 'alert').mockImplementation(() => {}); });

it('첫 보관 요청을 읽고 같은 전체 원문으로만 재시도한다', async () => {
  const original = entry(); storeVoucherPending(key, original);
  const { result, save, onApplied } = setup();
  expect(result.current.pending).toEqual(original);
  await act(async () => { await result.current.retry(); });
  expect(save).toHaveBeenCalledExactlyOnceWith(original.document);
  expect(onApplied).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBeNull();
});
it('동일 tick 중복 submit은 동기 잠금으로 한 번만 보내고 ACK 뒤 해제한다', async () => {
  const wait = deferred(), save = vi.fn(() => wait.promise);
  const { result, onApplied } = setup({ onIssueCashEntry: save });
  let pending!: Promise<void>;
  act(() => { pending = result.current.submit(entry()); void result.current.submit(entry()); expect(result.current.isBusy()).toBe(true); });
  expect(save).toHaveBeenCalledTimes(1); expect(result.current.saving).toBe(true);
  await act(async () => { wait.resolve({}); await pending; });
  expect(result.current.isBusy()).toBe(false); expect(onApplied).toHaveBeenCalledTimes(1);
});
it.each(['success', 'failure'] as const)('UID 왕복 후 이전 %s는 원문·오류·현재 실행 잠금을 건드리지 않는다', async outcome => {
  const old = deferred(), fresh = deferred(), save = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const { result, onApplied } = setup({ onIssueCashEntry: save });
  let oldRun!: Promise<void>, freshRun!: Promise<void>;
  act(() => { oldRun = result.current.submit(entry()); });
  const raw = localStorage.getItem(key);
  act(() => { emit('B'); }); expect(result.current.actorUid).toBe('B'); expect(result.current.saving).toBe(false); expect(result.current.pending).toBeNull();
  act(() => { emit('A'); });
  act(() => { freshRun = result.current.retry(); }); expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { if (outcome === 'success') old.resolve({}); else old.reject(Error('이전 오류')); await oldRun; });
  expect(result.current.saving).toBe(true); expect(result.current.isBusy()).toBe(true);
  expect(result.current.error).toBe(''); expect(onApplied).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(raw);
  await act(async () => { fresh.resolve({}); await freshRun; }); expect(onApplied).toHaveBeenCalledTimes(1);
});
it('회사 왕복은 같은 이름의 회사라도 이전 실행을 되살리지 않는다', async () => {
  const wait = deferred(); const { result, rerender, initial, onApplied } = setup({ onIssueCashEntry: () => wait.promise });
  let pending!: Promise<void>; act(() => { pending = result.current.submit(entry()); });
  rerender({ ...initial, companyId: 'punghoe' }); expect(result.current.pending).toBeNull();
  rerender(initial);
  await act(async () => { wait.resolve({}); await pending; });
  expect(onApplied).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).not.toBeNull(); expect(result.current.saving).toBe(false);
});
it.each(['success', 'failure'] as const)('unmount 뒤 %s는 callback·사본·알림을 바꾸지 않는다', async outcome => {
  const wait = deferred(), { result, unmount, onApplied } = setup({ onIssueCashEntry: () => wait.promise });
  let pending!: Promise<void>; act(() => { pending = result.current.submit(entry()); }); unmount();
  await act(async () => { if (outcome === 'success') wait.resolve({}); else wait.reject(Error('old')); await pending; });
  expect(onApplied).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).not.toBeNull(); expect(window.alert).not.toHaveBeenCalled();
});
it('StrictMode 설치 정리 뒤 현재 저장은 정상 처리한다', async () => {
  const { result, onApplied } = setup({}, true);
  await act(async () => { await result.current.submit(entry()); }); expect(onApplied).toHaveBeenCalledTimes(1);
});
it('실제 UID가 이벤트보다 먼저 바뀌면 이전 handler도 송신하지 않는다', async () => {
  const { result, save } = setup(); io.auth.currentUser = { uid: 'B' };
  await act(async () => { await result.current.submit(entry()); }); expect(save).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBeNull();
});
it('손상 보관은 새 요청을 보내지 않고 손상 안내를 유지한다', async () => {
  localStorage.setItem(key, '{bad'); const { result, save } = setup(); expect(result.current.corrupt).toBe(true);
  await act(async () => { await result.current.submit(entry()); }); expect(save).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe('{bad');
});
it('로그아웃은 과거 원문과 오류를 새 계정 화면에 노출하지 않는다', async () => {
  storeVoucherPending(key, entry()); const { result } = setup(); act(() => { emit(null); });
  expect(result.current.actorUid).toBe(''); expect(result.current.pending).toBeNull(); expect(result.current.error).toBe('');
});
it('최초 무쓰기 증거는 사본을 정리하지만 재시도 거절은 이전 요청을 보존한다', async () => {
  const proof = Object.assign(Error('계좌 확인'), { details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: 'cash-1' } });
  const save = vi.fn().mockRejectedValue(proof), first = setup({ onIssueCashEntry: save });
  await act(async () => { await first.result.current.submit(entry()); }); expect(localStorage.getItem(key)).toBeNull(); expect(first.result.current.pending).toBeNull();
  first.unmount(); storeVoucherPending(key, entry()); const second = setup({ onIssueCashEntry: save });
  await act(async () => { await second.result.current.retry(); }); expect(localStorage.getItem(key)).not.toBeNull(); expect(second.result.current.pending).not.toBeNull();
});
it('발행전표 branch도 최초 문서 그대로 보내고 정상 ACK만 종결한다', async () => {
  const save = vi.fn().mockResolvedValue({}); const { result, onApplied } = setup({ onAddIssuedStatement: save });
  const pending: VoucherIssuePending = { version: 1, companyId: 'taebaek', userId: 'A', kind: 'issuedStatements', document: {
    id: 'statement-1', companyId: 'taebaek', type: '비용', tradeDate: '2026-10-21', issuedAt: '2026-10-21T00:00:00Z', partnerId: 'p1', partnerName: '거래처', orderId: '', docNo: '261021-001', totalAmount: 1000, totalSupply: 1000, totalTax: 0,
    items: [{ name: '수수료', spec: '', qty: 1, price: 1000, supply: 1000, tax: 0, total: 1000, isTaxExempt: true }],
  } satisfies IssuedStatement };
  await act(async () => { await result.current.submit(pending); }); expect(save).toHaveBeenCalledExactlyOnceWith(pending.document); expect(onApplied).toHaveBeenCalledTimes(1);
});
it('보관 원문이 다른 사본으로 교체되면 재시도 송신 없이 그 사본을 보존한다', async () => {
  storeVoucherPending(key, entry()); const { result, save } = setup();
  const replacement = JSON.stringify(entry('cash-other'));
  localStorage.setItem(key, replacement);
  await act(async () => { await result.current.retry(); });
  expect(save).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(replacement);
  expect(result.current.error).toContain('이전에 저장 중이던 전표');
});
