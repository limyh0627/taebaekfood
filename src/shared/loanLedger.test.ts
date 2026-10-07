import { describe, expect, it } from 'vitest';
import type { CashEntry } from './types';
import { loanBalance, loanMovements, loanOpeningPrincipalForBalance, type LoanContract } from './loanLedger';

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
  it('새 시작일 이후 원금만 역산하여 목표 현재잔액에 맞춘다', () => {
    const entries = [
      entry('old', { date: '2026-08-31', dir: '입금', amount: 500 }),
      entry('draw', { date: '2026-09-01', dir: '입금', amount: 5_000 }),
      entry('repay', { lines: [{ accountCode: '260', amount: 1_000 }, { accountCode: '831', amount: 100 }] }),
      entry('other-company', { companyId: 'punghoe', dir: '입금', amount: 99_000 }),
      entry('other-loan', { loanId: 'other', dir: '입금', amount: 99_000 }),
    ];
    const input = structuredClone(entries);
    const principal = loanOpeningPrincipalForBalance(loan, entries, '2026-09-01', 20_000);
    expect(principal).toBe(16_000);
    expect(loanBalance({ ...loan, openingPrincipal: principal }, entries)).toBe(20_000);
    expect(loanOpeningPrincipalForBalance(loan, entries, '2026-09-02', 20_000)).toBe(21_000);
    expect(entries).toEqual(input);
    expect(loan.openingPrincipal).toBe(10_000);
  });
  it('연결 거래가 없으면 현재잔액이 기초원금이며 신규등록 날짜 제약은 적용하지 않는다', () => {
    expect(loanOpeningPrincipalForBalance(loan, [], '2025-01-01', 100_000_000)).toBe(100_000_000);
    expect(loanOpeningPrincipalForBalance(loan, [], '2026-09-01', 0)).toBe(0);
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('잘못된 현재잔액 %s를 거절한다', amount => {
    expect(() => loanOpeningPrincipalForBalance(loan, [], '2026-09-01', amount)).toThrow('정수 잔액');
  });
  it('유효하지 않은 날짜와 음수로 역산되는 기초원금을 거절한다', () => {
    expect(() => loanOpeningPrincipalForBalance(loan, [], '2026-02-30', 10)).toThrow('시작일');
    expect(() => loanOpeningPrincipalForBalance(loan, [entry('draw', { dir: '입금', amount: 500 })], '2026-09-01', 100)).toThrow('음수');
  });
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
