/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoanManager from './LoanManager';
import { recordLoanCashEntry } from '../src/shared/services/recordLoanCashEntry';
import type { CashEntry, CashAccount } from '../src/shared/types';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), notice: vi.fn(), call: vi.fn(), token: vi.fn(), auth: { currentUser: null as null | { uid: string; getIdTokenResult: () => Promise<unknown> } } }));
vi.mock('../src/shared/firebase', () => ({ auth: mocks.auth, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDoc: async ({ collection, id }: { collection: string; id: string }) => ({ id, exists: () => true, data: () => collection === 'appMeta' ? { status: 'active', releaseId: 'release-a' } : { companyId: 'taebaek', accountCode: '293', movementRevision: 0 } }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchWhere: async () => ['taebaek', 'punghoe'].map(companyId => ({ id: companyId, companyId, name: `${companyId} 대출`, lenderName: '은행', accountCode: '293', openingDate: '2026-01-01', openingPrincipal: 10000 })),
  createLoanWithOpening: vi.fn(), updateLoanOpening: vi.fn(),
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: mocks.confirm, appNotice: mocks.notice }));
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const accounts = ['taebaek', 'punghoe'].map(companyId => ({ id: `bank-${companyId}`, companyId, name: '은행', type: '통장', active: true })) as CashAccount[];
const props = { cashEntries: [], cashAccounts: accounts, partners: [] };
beforeEach(() => { localStorage.clear(); mocks.confirm.mockReset(); mocks.notice.mockReset(); mocks.call.mockReset(); mocks.token.mockReset().mockResolvedValue({ claims: { companyId: 'taebaek', isAdmin: true } }); mocks.auth.currentUser = { uid: 'admin', getIdTokenResult: mocks.token }; });
afterEach(cleanup);
async function begin(company: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${company} 대출`) }));
  fireEvent.click(screen.getByRole('button', { name: '차입 기록' }));
  fireEvent.change(screen.getByText('원금 차입액').parentElement!.querySelector('input')!, { target: { value: '1000' } });
}

it('확인 응답을 기다리는 동안 두 번 제출해도 확인과 저장은 한 번이다', async () => {
  const confirmation = deferred<boolean>(); mocks.confirm.mockReturnValue(confirmation.promise);
  const save = vi.fn().mockResolvedValue(undefined);
  render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  await begin('taebaek');
  const button = screen.getByRole('button', { name: '차입 전표 발행' });
  fireEvent.click(button); fireEvent.click(button);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  await act(async () => confirmation.resolve(true));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});

it('회사 전환 후 이전 확인이 승인되어도 이전 대출 저장을 시작하지 않는다', async () => {
  const confirmation = deferred<boolean>(); mocks.confirm.mockReturnValue(confirmation.promise);
  const save = vi.fn();
  const view = render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  await begin('taebaek'); fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  view.rerender(<LoanManager {...props} companyId="punghoe" onAddCashEntry={save} />);
  await begin('punghoe');
  await act(async () => confirmation.resolve(true));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '차입 전표 발행' })).toBeInTheDocument();
});

it('이전 회사 저장의 늦은 성공과 실패가 새 회사 입력을 닫거나 알림을 띄우지 않는다', async () => {
  mocks.confirm.mockResolvedValue(true);
  for (const fail of [false, true]) {
    const pending = deferred<unknown>(); const save = vi.fn().mockReturnValue(pending.promise);
    const view = render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
    await begin('taebaek'); fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    view.rerender(<LoanManager {...props} companyId="punghoe" onAddCashEntry={save} />);
    await begin('punghoe');
    await act(async () => { if (fail) pending.reject(new Error('이전 저장 실패')); else pending.resolve(undefined); });
    expect(screen.getByRole('button', { name: '차입 전표 발행' })).toBeInTheDocument();
    expect(screen.getByText('원금 차입액').parentElement!.querySelector('input')).toHaveValue('1,000');
    expect(mocks.notice).not.toHaveBeenCalled();
    view.unmount();
  }
});

it('상환 응답 유실 뒤 구독 잔액이 줄어도 최초 서버 요청 그대로 결과를 재확인한다', async () => {
  mocks.confirm.mockResolvedValue(true);
  mocks.call.mockRejectedValueOnce(Error('응답 유실')).mockImplementationOnce(async request => ({ data: { status: 'duplicate', id: request.operationId, docNo: '261021-001', balanceAfter: 2000 } }));
  let applied!: CashEntry;
  const save = vi.fn((entry: CashEntry) => { applied = entry; return recordLoanCashEntry('taebaek', entry); });
  const view = render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  fireEvent.click(await screen.findByRole('button', { name: /taebaek 대출/ }));
  fireEvent.click(screen.getByRole('button', { name: '원금·이자 상환' }));
  fireEvent.change(screen.getByText('원금 상환액').parentElement!.querySelector('input')!, { target: { value: '8000' } });
  fireEvent.click(screen.getByRole('button', { name: '상환 전표 발행' }));
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mocks.notice).toHaveBeenCalled());
  expect(mocks.notice).toHaveBeenCalledWith(expect.stringContaining('대출 전표의 처리 결과를 확인하지 못했습니다. 입력을 유지했습니다.'), '처리 결과 확인 필요');
  expect(mocks.notice.mock.calls[0][0]).toContain('응답 유실');
  expect(mocks.notice.mock.calls[0][0]).not.toContain('저장하지 못했습니다');
  expect(mocks.notice.mock.calls[0][0]).toContain('같은 내용으로 다시 확인');
  const first = structuredClone(mocks.call.mock.calls[0][0]);
  view.rerender(<LoanManager {...props} cashEntries={[applied]} companyId="taebaek" onAddCashEntry={save} />);
  expect(screen.getAllByText('2,000원').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '상환 전표 발행' }));
  await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
  expect(mocks.call.mock.calls[1][0]).toEqual(first);
  expect(localStorage.getItem('loan-movement-pending:taebaek:taebaek:admin')).toBeNull();
});

it('보관 요청 없는 새 과다 상환은 확인과 서버 송신 전에 차단한다', async () => {
  mocks.confirm.mockResolvedValue(true);
  const save = vi.fn();
  render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  fireEvent.click(await screen.findByRole('button', { name: /taebaek 대출/ }));
  fireEvent.click(screen.getByRole('button', { name: '원금·이자 상환' }));
  fireEvent.change(screen.getByText('원금 상환액').parentElement!.querySelector('input')!, { target: { value: '11000' } });
  fireEvent.click(screen.getByRole('button', { name: '상환 전표 발행' }));
  await waitFor(() => expect(mocks.notice).toHaveBeenCalledWith('상환 원금이 현재 대출 잔액보다 많습니다.'));
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
});
it.each(['deleted', 'replaced'] as const)('재확인 확인창을 기다리는 중 %s 요청은 새 발행으로 우회하지 않는다', async mode => {
  mocks.confirm.mockResolvedValueOnce(true);
  mocks.call.mockRejectedValueOnce(Error('응답 유실'));
  const save = vi.fn((entry: CashEntry) => recordLoanCashEntry('taebaek', entry));
  render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  await begin('taebaek'); fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  await waitFor(() => expect(mocks.notice).toHaveBeenCalled());
  const confirmation = deferred<boolean>(); mocks.confirm.mockReturnValueOnce(confirmation.promise);
  fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.confirm.mock.calls[1][0]).toMatchObject({ title: '이전 요청 결과 재확인' });
  const key = 'loan-movement-pending:taebaek:taebaek:admin';
  if (mode === 'deleted') localStorage.removeItem(key); else localStorage.setItem(key, 'replacement');
  await act(async () => { confirmation.resolve(true); });
  expect(save).toHaveBeenCalledTimes(1); expect(mocks.call).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(mode === 'deleted' ? null : 'replacement');
});

it.each(['confirmation', 'save'] as const)('화면 unmount 뒤 %s 응답은 새 송신과 전역 알림을 만들지 않는다', async phase => {
  const confirmation = deferred<boolean>(), saving = deferred<unknown>();
  mocks.confirm.mockReturnValue(phase === 'confirmation' ? confirmation.promise : Promise.resolve(true));
  const save = phase === 'save' ? vi.fn(() => saving.promise) : vi.fn().mockResolvedValue(undefined);
  const view = render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  await begin('taebaek');
  fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  if (phase === 'save') await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => { if (phase === 'confirmation') confirmation.resolve(true); else saving.reject(Error('제거된 화면 저장 실패')); });
  expect(save).toHaveBeenCalledTimes(phase === 'confirmation' ? 0 : 1);
  expect(mocks.notice).not.toHaveBeenCalled();
});
it.each(['confirmation', 'response'] as const)('관측 재확인 중 unmount 뒤 %s는 요청을 보내거나 보관 원문을 정리하지 않는다', async phase => {
  mocks.confirm.mockResolvedValue(true); mocks.call.mockRejectedValueOnce(Error('응답 유실'));
  const save = vi.fn((entry: CashEntry) => recordLoanCashEntry('taebaek', entry));
  const view = render(<LoanManager {...props} companyId="taebaek" onAddCashEntry={save} />);
  await begin('taebaek'); fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  await waitFor(() => expect(mocks.notice).toHaveBeenCalled());
  const key = 'loan-movement-pending:taebaek:taebaek:admin', raw = localStorage.getItem(key);
  const confirmation = deferred<boolean>(), response = deferred<unknown>();
  if (phase === 'confirmation') mocks.confirm.mockReturnValueOnce(confirmation.promise);
  else mocks.call.mockReturnValueOnce(response.promise);
  mocks.notice.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '차입 전표 발행' }));
  if (phase === 'response') await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
  view.unmount();
  await act(async () => { if (phase === 'confirmation') confirmation.resolve(true); else response.resolve({ data: { status: 'duplicate', id: mocks.call.mock.calls[0][0].operationId, docNo: 'fixed', balanceAfter: 11000 } }); });
  expect(mocks.call).toHaveBeenCalledTimes(phase === 'confirmation' ? 1 : 2);
  expect(save).toHaveBeenCalledTimes(1); expect(mocks.notice).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(raw);
});
