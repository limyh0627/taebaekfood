/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import type { AccountCode, IssuedStatement } from '../src/shared/types';

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
    const onAddCashEntry = vi.fn();
    render(<PartnerLedger
      issuedStatements={[전표]} cashEntries={[]} accountCodes={계정}
      onAddCashEntry={onAddCashEntry}
    />);

    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.click(screen.getByRole('button', { name: '1,428,000 수금' }));

    const amount = screen.getByRole('textbox', { name: '수금 금액' });
    expect(amount).toHaveValue('1,428,000');
    expect(screen.getByLabelText('수금 날짜')).toHaveValue('2026-08-10');

    fireEvent.change(amount, { target: { value: '1000000' } });
    expect(amount).toHaveValue('1,000,000');
    fireEvent.click(screen.getByRole('button', { name: '수금 기록' }));

    expect(onAddCashEntry).toHaveBeenCalledTimes(1);
    expect(onAddCashEntry.mock.calls[0][0]).toMatchObject({
      partnerId: 'partner-1', amount: 1_000_000, date: '2026-08-10', dir: '입금',
    });
  });
});
