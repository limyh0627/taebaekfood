/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CashLedger, { AccountModal } from './CashLedger';
import type { CashAccount } from '../src/shared/types';

vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true, appNotice: async () => {} }));

describe('자금전표 금액 입력', () => {
  it('계좌 기초잔액은 쉼표로 보이지만 숫자로 저장한다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AccountModal accounts={[]} onClose={vi.fn()} onAdd={onAdd} onUpdate={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('기업은행 1234-56'), '농협');
    const balance = screen.getByPlaceholderText('기초 잔액');
    await user.type(balance, '1428000');
    expect(balance).toHaveValue('1,428,000');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 1_428_000 }));
  });

  it('계좌 저장 실패 후 입력을 유지하고 같은 요청 ID로 재시도한다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('네트워크 실패')).mockResolvedValueOnce(undefined);
    render(<AccountModal accounts={[]} onClose={vi.fn()} onAdd={onAdd} onUpdate={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('기업은행 1234-56'), '농협');
    await user.type(screen.getByPlaceholderText('기초 잔액'), '1000');
    await user.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled());
    expect(screen.getByPlaceholderText('기초 잔액')).toHaveValue('1,000');
    await user.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][0].id).toBe(onAdd.mock.calls[0][0].id);
  });

  it('일반 자금전표 금액도 입력 중 쉼표로 보인다', async () => {
    const user = userEvent.setup();
    const account = { id: 'bank', name: '농협', type: '통장', openingBalance: 0, openingDate: '2026-09-01', active: true } as CashAccount;
    render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[]}
      accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[]}
      onAddCashAccount={vi.fn()} onUpdateCashAccount={vi.fn()} onAddCashEntry={vi.fn()}
      onDeleteCashEntry={vi.fn()} onAddSettlement={vi.fn()} onDeleteSettlement={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '일반전표' }));
    const amount = screen.getByPlaceholderText('0');
    await user.type(amount, '1234567');
    expect(amount).toHaveValue('1,234,567');
  });
});
