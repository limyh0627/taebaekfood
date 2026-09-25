import { describe, expect, it } from 'vitest';
import type { CashEntry } from './types';
import { loanBalance, loanMovements, type LoanContract } from './loanLedger';

const loan: LoanContract = {
  id: 'loan-1', companyId: 'taebaek', name: '운전자금', lenderName: '기업은행',
  accountCode: '260', openingDate: '2026-09-01', openingPrincipal: 10_000,
  createdAt: '2026-09-01T00:00:00Z',
};
const entry = (id: string, extra: Partial<CashEntry>): CashEntry => ({
  id, companyId: 'taebaek', loanId: loan.id, date: '2026-09-02', createdAt: '2026-09-02T00:00:00Z',
  cashAccountId: 'bank', dir: '출금', amount: 1_100, accountCode: '260', ...extra,
});

describe('대출별 보조원장', () => {
  it('차입은 더하고 원금상환만 뺀다. 이자는 잔액에 넣지 않는다', () => {
    const rows = [
      entry('draw', { dir: '입금', amount: 5_000 }),
      entry('repay', { amount: 1_100, accountCode: undefined, lines: [
        { accountCode: '260', amount: 1_000, side: '차변' },
        { accountCode: '831', amount: 100, side: '차변' },
      ] }),
    ];
    expect(loanMovements(loan, rows).map(r => r.principalDelta)).toEqual([5_000, -1_000]);
    expect(loanBalance(loan, rows)).toBe(14_000);
  });

  it('다른 대출·다른 회사·기준일 이전 전표는 섞지 않는다', () => {
    expect(loanBalance(loan, [
      entry('other', { loanId: 'loan-2', amount: 50_000 }),
      entry('company', { companyId: 'punghoe', amount: 50_000 }),
      entry('old', { date: '2026-08-31', amount: 50_000 }),
    ])).toBe(10_000);
  });

  it('대출 계정이 다른 전표는 원금 변동으로 잡지 않는다', () => {
    expect(loanBalance(loan, [entry('wrong', { accountCode: '293' })])).toBe(10_000);
  });
});
