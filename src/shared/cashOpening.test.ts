import { describe, expect, it } from 'vitest';
import type { CashAccount, CashEntry } from './types';
import { cashOpeningStatement, cashOpeningBalanceForCurrent } from './cashOpening';
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

describe('확정 잔액 이후 기초 역산 경계', () => {
  const anchor: CashEntry = { id: 'confirmed', companyId: 'punghoe', cashAccountId: 'bank1', date: '2026-08-31', dir: '입금', amount: 1, createdAt: '',
    balanceAdjustment: { before: 499, target: 500, delta: 1, reason: '확정', confirmedBalance: true } };
  it('새 기초일부터 조회일까지 확정 기준점이 있으면 불가능한 현재 잔액 역산을 거절한다', () => {
    expect(() => cashOpeningBalanceForCurrent(account('통장'), [anchor], '2026-07-31', 700, '2026-10-07')).toThrow('확정 잔액 기준점');
    expect(() => cashOpeningBalanceForCurrent(account('통장'), [anchor], '2026-08-31', 700, '2026-10-07')).toThrow('확정 잔액 기준점');
  });
  it('새 기초일이 기준점 이후면 연결 거래로 정상 역산한다', () => {
    const deposit: CashEntry = { id: 'deposit', companyId: 'punghoe', cashAccountId: 'bank1', date: '2026-09-02', dir: '입금', amount: 100, createdAt: '' };
    expect(cashOpeningBalanceForCurrent(account('통장'), [anchor, deposit], '2026-09-01', 700, '2026-10-07')).toBe(600);
  });
  it('다른 회사·계좌·조회일 이후 기준점과 기존 일반 delta는 역산을 막지 않는다', () => {
    const entries = [{ ...anchor, companyId: 'taebaek' as const }, { ...anchor, id: 'other', cashAccountId: 'other' }, { ...anchor, id: 'future', date: '2026-10-08' },
      { ...anchor, id: 'legacy', balanceAdjustment: { ...anchor.balanceAdjustment!, confirmedBalance: undefined } }];
    expect(cashOpeningBalanceForCurrent(account('통장'), entries, '2026-07-31', 700, '2026-10-07')).toBe(699);
  });
});

it('계좌 확정값도 현재 잔액 역산을 막고 새 기초일 이후에만 계산한다', () => {
  const confirmed = { ...account('통장'), confirmedBalances: [{ date: '2026-08-31', balance: 500, recordedAt: '2026-10-07T11:00:00Z', reason: '통장 확인' }] };
  expect(() => cashOpeningBalanceForCurrent(confirmed, [], '2026-08-31', 700, '2026-10-07')).toThrow('확정 잔액 기준점');
  expect(cashOpeningBalanceForCurrent(confirmed, [], '2026-09-01', 700, '2026-10-07')).toBe(700);
});
