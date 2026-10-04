import { describe, expect, it } from 'vitest';
import { loanOpeningStatement } from './loanOpening';
import { journalizeTransfer } from './autoJournal';
import type { LoanContract } from './loanLedger';

const loan: LoanContract = {
  id: 'loan1', companyId: 'punghoe', name: '기초 대출', lenderName: '은행',
  accountCode: '293', openingDate: '2026-07-31', openingPrincipal: 1_000_000,
  createdAt: '2026-08-01T00:00:00+09:00',
};

describe('대출 시작 원금 기초 전표', () => {
  it('원금은 대출부채 대변과 이월이익잉여금 차변으로 한 번만 잡힌다', () => {
    const voucher = loanOpeningStatement(loan);
    const journal = journalizeTransfer(voucher)!;
    expect(voucher.type).toBe('비용');
    expect(journal.lines).toEqual([
      { accountCode: '375', debit: 1_000_000, credit: 0 },
      { accountCode: '293', debit: 0, credit: 1_000_000 },
    ]);
  });
  it('시작 원금 0원에는 기초 전표를 만들지 않는다', () => {
    expect(() => loanOpeningStatement({ ...loan, openingPrincipal: 0 })).toThrow();
  });
});
