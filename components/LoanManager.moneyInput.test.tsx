/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoanManager from './LoanManager';
import type { CashAccount } from '../src/shared/types';

const mocks = vi.hoisted(() => ({
  loans: [] as Record<string, unknown>[],
  addItem: vi.fn(),
}));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchWhere: async () => mocks.loans,
  addItem: mocks.addItem,
}));
vi.mock('../src/shared/components/appDialog', () => ({
  appConfirm: async () => true,
  appNotice: async () => {},
}));

const account = { id: 'bank', name: '농협', type: '통장', active: true } as CashAccount;
const view = (onAddCashEntry = vi.fn()) => render(<LoanManager companyId="taebaek"
  cashEntries={[]} cashAccounts={[account]} partners={[]} onAddCashEntry={onAddCashEntry} />);

beforeEach(() => { mocks.loans = []; mocks.addItem.mockReset(); });

describe('대출 금액 입력', () => {
  it.each(['1000.5', '-1000'])('시작 원금의 잘못된 붙여넣기 %s를 거절하고 저장을 막는다', async value => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '대출 등록' }));
    await user.type(screen.getByPlaceholderText('예: 운전자금 대출 1호'), '운전자금');
    await user.type(screen.getByPlaceholderText('은행명'), '농협');
    const input = screen.getByText('그날 시작 원금').parentElement!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue('1,000');
    expect(screen.getByRole('alert')).toHaveTextContent('소수와 음수');
    await user.click(screen.getByRole('button', { name: '등록' }));
    expect(mocks.addItem).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '2000' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith('loanContracts', expect.objectContaining({ openingPrincipal: 2000 })));
  });

  it.each([['원금 상환액', '1000.5'], ['원금 상환액', '-1000'], ['이자 비용', '1000.5'], ['이자 비용', '-1000']])('%s의 잘못된 붙여넣기 %s는 상환 저장을 막는다', async (label, value) => {
    const user = userEvent.setup();
    mocks.loans = [{ id: 'loan1', companyId: 'taebaek', name: '운전자금', lenderName: '농협', accountCode: '293', openingDate: '2026-01-01', openingPrincipal: 1_000_000 }];
    const save = vi.fn();
    view(save);
    await user.click(await screen.findByRole('button', { name: /운전자금/ }));
    await user.click(screen.getByRole('button', { name: '원금·이자 상환' }));
    fireEvent.change(screen.getByText('원금 상환액').parentElement!.querySelector('input')!, { target: { value: '1000' } });
    const input = screen.getByText(label).parentElement!.querySelector('input')!;
    const before = input.value;
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue(before);
    expect(screen.getByRole('alert')).toHaveTextContent('소수와 음수');
    await user.click(screen.getByRole('button', { name: '상환 전표 발행' }));
    expect(save).not.toHaveBeenCalled();
  });

  it('시작 원금을 쉼표로 보이고 숫자로 저장한다', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '대출 등록' }));
    await user.type(screen.getByPlaceholderText('예: 운전자금 대출 1호'), '운전자금');
    await user.type(screen.getByPlaceholderText('은행명'), '농협');
    const amount = screen.getByText('그날 시작 원금').parentElement!.querySelector('input')!;
    await user.clear(amount);
    await user.type(amount, '1428000');
    expect(amount).toHaveValue('1,428,000');
    await user.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith('loanContracts',
      expect.objectContaining({ openingPrincipal: 1_428_000 })));
  });

  it('상환 원금과 이자도 쉼표로 보이고 숫자 전표로 저장한다', async () => {
    const user = userEvent.setup();
    mocks.loans = [{ id: 'loan1', companyId: 'taebaek', name: '운전자금', lenderName: '농협',
      accountCode: '293', openingDate: '2026-01-01', openingPrincipal: 1_000_000 }];
    const onAddCashEntry = vi.fn();
    view(onAddCashEntry);
    await user.click(await screen.findByRole('button', { name: /운전자금/ }));
    await user.click(screen.getByRole('button', { name: '원금·이자 상환' }));
    const principal = screen.getByText('원금 상환액').parentElement!.querySelector('input')!;
    const interest = screen.getByText('이자 비용').parentElement!.querySelector('input')!;
    await user.type(principal, '123456');
    await user.clear(interest);
    await user.type(interest, '7890');
    expect(principal).toHaveValue('123,456');
    expect(interest).toHaveValue('7,890');
    await user.click(screen.getByRole('button', { name: '상환 전표 발행' }));
    await waitFor(() => expect(onAddCashEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 131_346 })));
  });
});
