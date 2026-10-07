/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoanManager from './LoanManager';
import type { CashAccount } from '../src/shared/types';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), notice: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchWhere: async () => ['taebaek', 'punghoe'].map(companyId => ({ id: companyId, companyId, name: `${companyId} 대출`, lenderName: '은행', accountCode: '293', openingDate: '2026-01-01', openingPrincipal: 10000 })),
  createLoanWithOpening: vi.fn(), updateLoanOpening: vi.fn(),
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: mocks.confirm, appNotice: mocks.notice }));
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const accounts = ['taebaek', 'punghoe'].map(companyId => ({ id: `bank-${companyId}`, companyId, name: '은행', type: '통장', active: true })) as CashAccount[];
const props = { cashEntries: [], cashAccounts: accounts, partners: [] };
beforeEach(() => { mocks.confirm.mockReset(); mocks.notice.mockReset(); });
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
