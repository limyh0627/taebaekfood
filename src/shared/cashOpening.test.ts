import { describe, expect, it } from 'vitest';
import type { CashAccount } from './types';
import { cashOpeningStatement } from './cashOpening';
import { journalizeTransfer } from './autoJournal';

const account = (type: CashAccount['type']): CashAccount => ({
  id: 'bank1', companyId: 'punghoe', name: '기초 계좌', type,
  openingDate: '2026-07-31', openingBalance: 100_000, active: true,
  createdAt: '2026-08-01T00:00:00+09:00',
});

describe('계좌 기초 전표', () => {
  it.each([['통장', '103'], ['현금', '102']] as const)('%s은 %s 자산과 자본 상대변으로 차대가 맞는다', (type, code) => {
    const journal = journalizeTransfer(cashOpeningStatement(account(type)))!;
    expect(journal.lines).toEqual([
      { accountCode: code, debit: 100_000, credit: 0 },
      { accountCode: '375', debit: 0, credit: 100_000 },
    ]);
  });
  it('카드 또는 0원은 자산 기초 전표를 만들지 않는다', () => {
    expect(() => cashOpeningStatement(account('카드'))).toThrow();
    expect(() => cashOpeningStatement({ ...account('통장'), openingBalance: 0 })).toThrow();
  });
});
