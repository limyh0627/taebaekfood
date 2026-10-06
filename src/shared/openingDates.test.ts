import { describe, expect, it } from 'vitest';
import { cashOpeningStatement } from './cashOpening';
import { loanOpeningStatement } from './loanOpening';
import { inventoryOpeningStatement } from './inventoryOpening';
import { openingPartnerStatement } from './openingPartnerBalance';
import type { CashAccount, Item, Partner } from './types';
import type { LoanContract } from './loanLedger';

const drafts = (date: string) => [
  () => cashOpeningStatement({ id: 'cash', name: '통장', type: '통장', companyId: 'punghoe', openingDate: date, openingBalance: 100 } as CashAccount),
  () => loanOpeningStatement({ id: 'loan', name: '대출', companyId: 'punghoe', accountCode: '293', openingDate: date, openingPrincipal: 100 } as LoanContract),
  () => inventoryOpeningStatement('punghoe', date, { id: 'item', name: '재고' } as Item, 1, 100),
  () => openingPartnerStatement('punghoe', date, { id: 'partner', name: '거래처', companyId: 'punghoe' } as Partner, '108', 100),
];

describe('기초자료의 실제 달력 기준일', () => {
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-31'])('%s은 모든 기초 전표에서 거절한다', date => {
    for (const build of drafts(date)) expect(build).toThrow();
  });
  it('윤년 말일은 날짜를 바꾸지 않고 같은 기준일로 저장한다', () => {
    for (const build of drafts('2028-02-29')) expect(build().tradeDate).toBe('2028-02-29');
  });
});
