/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import LoanManager from './LoanManager';
import type { CashEntry } from '../src/shared/types';
import type { LoanContract } from '../src/shared/loanLedger';

const calls = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn(), notice: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchWhere: calls.fetch, updateLoanOpening: calls.update, createLoanWithOpening: vi.fn(),
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true, appNotice: calls.notice }));
const loan: LoanContract = { id: 'loan', companyId: 'taebaek', name: '운전자금', lenderName: '은행', accountCode: '293',
  openingDate: '2026-09-01', openingPrincipal: 10_000, createdAt: '2026-09-01T00:00:00Z' };
const entries: CashEntry[] = [
  { id: 'draw', companyId: 'taebaek', loanId: loan.id, date: '2026-09-01', createdAt: '', dir: '입금', amount: 5_000, accountCode: '293', cashAccountId: 'bank' },
  { id: 'repay', companyId: 'taebaek', loanId: loan.id, date: '2026-09-02', createdAt: '', dir: '출금', amount: 1_100, cashAccountId: 'bank',
    lines: [{ accountCode: '293', amount: 1_000 }, { accountCode: '831', amount: 100 }] },
];
beforeEach(() => { calls.fetch.mockReset().mockResolvedValue([loan]); calls.update.mockReset(); calls.notice.mockReset(); });
async function openEditor(cashEntries = entries) {
  const view = render(<LoanManager companyId="taebaek" cashEntries={cashEntries} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /운전자금/ }));
  fireEvent.click(screen.getByRole('button', { name: '시작일·원금 수정' }));
  return { date: screen.getByLabelText('시작일'), balance: screen.getByLabelText('현재 원금 잔액'), rerender: view.rerender };
}

it('기존 시작일·계산된 현재잔액을 채우고 새 날짜 이후 원금만 미리보기로 역산한다', async () => {
  const { date, balance } = await openEditor();
  expect(date).toHaveValue('2026-09-01');
  expect(balance).toHaveValue('14,000');
  expect(screen.getByText('시작 원금 미리보기:').parentElement).toHaveTextContent('10,000원');
  fireEvent.change(date, { target: { value: '2026-09-02' } });
  fireEvent.change(balance, { target: { value: '20000' } });
  expect(screen.getByText('시작 원금 미리보기:').parentElement).toHaveTextContent('21,000원');
});

it.each(['-100', '100.5'])('현재잔액의 잘못된 입력 %s는 원래값을 보존하고 저장을 막는다', async value => {
  const { balance } = await openEditor();
  fireEvent.change(balance, { target: { value } });
  expect(balance).toHaveValue('14,000');
  expect(screen.getByRole('alert')).toHaveTextContent('소수와 음수');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  expect(calls.update).not.toHaveBeenCalled();
});

it('저장 실패는 수정 날짜·금액을 보존하고 같은 입력으로 다시 저장할 수 있다', async () => {
  calls.update.mockRejectedValueOnce(new Error('원본 변경'));
  const { date, balance } = await openEditor();
  fireEvent.change(date, { target: { value: '2026-08-01' } });
  fireEvent.change(balance, { target: { value: '25000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.notice).toHaveBeenCalledWith(expect.stringContaining('원본 변경'), '저장 실패'));
  expect(date).toHaveValue('2026-08-01');
  expect(balance).toHaveValue('25,000');
  calls.update.mockImplementationOnce(async () => { calls.fetch.mockResolvedValue([{ ...loan, openingDate: '2026-08-01', openingPrincipal: 21_000 }]); });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '수정 저장' })).toBeNull());
  expect(calls.update).toHaveBeenNthCalledWith(1, 'taebaek', loan, '2026-08-01', 25_000);
  expect(calls.update).toHaveBeenNthCalledWith(2, 'taebaek', loan, '2026-08-01', 25_000);
  expect(calls.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('25,000원').length).toBeGreaterThan(0);
});

it('저장 중 버튼과 입력을 잠그며 연결 거래 없는 계약도 새 시작일로 수정한다', async () => {
  let resolve!: () => void;
  calls.update.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const { date, balance } = await openEditor([]);
  fireEvent.change(date, { target: { value: '2025-01-01' } });
  fireEvent.change(balance, { target: { value: '100000000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, '2025-01-01', 100_000_000));
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
  expect(date).toBeDisabled();
  expect(balance).toBeDisabled();
  await act(async () => { resolve(); });
  expect(screen.queryByRole('button', { name: '수정 저장' })).toBeNull();
});

it.each(['성공', '실패'])('이전 회사 저장의 늦은 %s는 새 회사 수정창과 조회를 건드리지 않는다', async outcome => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  calls.update.mockReturnValue(new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
  const { rerender } = await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
  const otherLoan = { ...loan, id: 'other-loan', name: '풍회 대출', companyId: 'punghoe', openingDate: '2025-01-01', openingPrincipal: 30_000 };
  calls.fetch.mockResolvedValue([otherLoan]);
  rerender(<LoanManager companyId="punghoe" cashEntries={[]} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /풍회 대출/ }));
  fireEvent.click(screen.getByRole('button', { name: '시작일·원금 수정' }));
  await act(async () => { if (outcome === '성공') resolve(); else reject(new Error('태백 저장 실패')); });
  expect(screen.getByLabelText('시작일')).toHaveValue('2025-01-01');
  expect(screen.getByLabelText('현재 원금 잔액')).toHaveValue('30,000');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
  expect(calls.fetch).toHaveBeenCalledTimes(2);
  expect(calls.notice).not.toHaveBeenCalled();
});


it('시작 원금 직접 수정은 연결 원금만 반영해 현재잔액을 바꾸고 기존 API로 저장한다', async () => {
  const { balance } = await openEditor();
  const opening = screen.getByLabelText('시작일 원금 잔액');
  expect(opening).toHaveValue('10,000');
  fireEvent.change(opening, { target: { value: '20000' } });
  expect(balance).toHaveValue('24,000');
  fireEvent.change(balance, { target: { value: '30000' } });
  expect(opening).toHaveValue('26,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, loan.openingDate, 30_000));
});


it.each(['-1', '100.5', '9007199254740992'])('시작 원금의 잘못된 입력 %s는 저장을 막고 현재잔액을 보존한다', async value => {
  const { balance } = await openEditor();
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value } });
  if (value !== '9007199254740992') expect(balance).toHaveValue('14,000');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  expect(calls.update).not.toHaveBeenCalled();
});

it('시작일 변경은 현재 잔액을 유지하고 직접 입력 0원도 기존 거래로 현재액을 계산한다', async () => {
  const { date, balance } = await openEditor();
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '20000' } });
  expect(balance).toHaveValue('24,000');
  fireEvent.change(date, { target: { value: '2026-09-02' } });
  expect(balance).toHaveValue('24,000');
  expect(screen.getByLabelText('시작일 원금 잔액')).toHaveValue('25,000');
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '500' } });
  expect(balance).toHaveValue('-500');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  fireEvent.change(balance, { target: { value: '24000' } });
  fireEvent.change(date, { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '0' } });
  expect(balance).toHaveValue('4,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, '2026-09-01', 4000));
});


it('상환 거래가 있어도 시작 원금을 비우고 한 자리씩 다시 입력할 수 있다', async () => {
  const user = userEvent.setup();
  const repayments: CashEntry[] = [{ ...entries[1], amount: 2000, lines: [{ accountCode: '293', amount: 2000 }] }];
  const { balance } = await openEditor(repayments);
  const opening = screen.getByLabelText('시작일 원금 잔액');
  await user.clear(opening);
  expect(opening).toHaveValue(''); expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  await user.type(opening, '12000');
  expect(opening).toHaveValue('12,000'); expect(balance).toHaveValue('10,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, loan.openingDate, 10000));
});
