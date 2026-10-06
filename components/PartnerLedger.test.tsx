/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import { recordPartnerPayment } from '../src/features/statements/infrastructure/issueTradeStatementCommand';
import type { AccountCode, IssuedStatement } from '../src/shared/types';

vi.mock('../src/features/statements/infrastructure/issueTradeStatementCommand', () => ({ recordPartnerPayment: vi.fn() }));
const accounts = [{ id: 'bank-1', companyId: 'taebaek' as const, name: '보통예금', active: true,
  type: '통장' as const, openingBalance: 0, openingDate: '2026-08-01', createdAt: '2026-08-01T00:00:00.000Z' }];

const 전표: IssuedStatement = {
  id: 'stmt-1', type: '매출', tradeDate: '2026-08-10', issuedAt: '2026-08-10T03:00:00.000Z',
  partnerId: 'partner-1', partnerName: '살림터', orderId: '', docNo: '260810-01',
  totalSupply: 1_428_000, totalTax: 0, totalAmount: 1_428_000,
  items: [{
    name: '참기름', spec: '', qty: 1, price: 1_428_000,
    supply: 1_428_000, tax: 0, total: 1_428_000, isTaxExempt: true, accountCode: '800',
  }],
};

const 계정 = [
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit' },
  { id: '800', code: '800', name: '제품매출', type: '수익', normalBalance: 'credit' },
] as AccountCode[];

describe('거래처 원장 수금 입력', () => {
  it('전표의 남은 금액은 쉼표로 보이고 날짜는 그 전표일로 열린다', async () => {
    vi.mocked(recordPartnerPayment).mockResolvedValue(undefined);
    render(<PartnerLedger
      companyId="taebaek" issuedStatements={[전표]} cashEntries={[]} cashAccounts={accounts} accountCodes={계정}
    />);

    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.click(screen.getByRole('button', { name: '1,428,000 수금' }));

    const amount = screen.getByRole('textbox', { name: '수금 금액' });
    expect(amount).toHaveValue('1,428,000');
    expect(screen.getByLabelText('수금 날짜')).toHaveValue('2026-08-10');

    fireEvent.change(amount, { target: { value: '1000000' } });
    expect(amount).toHaveValue('1,000,000');
    fireEvent.change(screen.getByRole('combobox', { name: '입출금 계좌' }), { target: { value: 'bank-1' } });
    fireEvent.click(screen.getByRole('button', { name: '수금 기록' }));

    await waitFor(() => expect(recordPartnerPayment).toHaveBeenCalledWith('taebaek', expect.objectContaining({
      partnerId: 'partner-1', amount: 1_000_000, tradeDate: '2026-08-10', direction: '입금', cashAccountId: 'bank-1',
    })));
  });

  it('저장 실패 시 입력창을 유지하고 오류를 알린다', async () => {
    vi.mocked(recordPartnerPayment).mockRejectedValue(new Error('permission-denied'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<PartnerLedger companyId="taebaek" issuedStatements={[전표]} cashEntries={[]} cashAccounts={accounts} accountCodes={계정} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.click(screen.getByRole('button', { name: '1,428,000 수금' }));
    fireEvent.change(screen.getByRole('combobox', { name: '입출금 계좌' }), { target: { value: 'bank-1' } });
    fireEvent.click(screen.getByRole('button', { name: '수금 기록' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('permission-denied')));
    expect(screen.getByRole('textbox', { name: '수금 금액' })).toHaveValue('1,428,000');
    alert.mockRestore();
  });
});
