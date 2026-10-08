import { describe, expect, it } from 'vitest';
import { planCashEdit, planCashSettlements, validCashDate, planLoanCashMutation } from './cashMutationPlan';
const current = { id: 'cash', companyId: 'taebaek', docNo: '260930-001', date: '2026-09-30', dir: '출금', amount: 100,
  cashAccountId: 'bank', accountCode: '802', createdAt: '2026-09-30T14:59:59Z' };
const codes = ['802', '254', '260', '931', '108', '251'];
describe('full cash mutation plan', () => {
  it('preserves identity/account and supports date, amount, direction and memo edits', () => {
    expect(planCashEdit(current, { date: '2026-10-01', dir: '입금', amount: 200, note: '수정' }, codes, undefined, 'taebaek'))
      .toMatchObject({ id: 'cash', docNo: '260930-001', cashAccountId: 'bank', date: '2026-10-01', dir: '입금', amount: 200 });
  });
  it('supports single to split and explicit empty-array clearing', () => {
    const split = planCashEdit(current, { lines: [{ accountCode: '260', amount: 80 }, { accountCode: '931', amount: 20 }], accountCode: '' }, codes, undefined, 'taebaek');
    expect(split.lines).toHaveLength(2);
    expect(planCashEdit(split, { lines: [], accountCode: '802' }, codes, undefined, 'taebaek').lines).toEqual([]);
  });
  it('retains signed payroll deduction and explicit side compatibility', () => {
    expect(planCashEdit(current, { lines: [{ accountCode: '802', amount: 120 }, { accountCode: '254', amount: -20 }], accountCode: '' }, codes, undefined, 'taebaek').amount).toBe(100);
    expect(planCashEdit(current, { lines: [{ accountCode: '802', amount: 120 }, { accountCode: '254', amount: 20, side: '대변' }], accountCode: '' }, codes, undefined, 'taebaek').amount).toBe(100);
  });
  it('supports balanced offsets and rejects direction rewriting', () => {
    const offset = { ...current, dir: '대체', lines: [{ accountCode: '251', amount: 100 }, { accountCode: '108', amount: -100 }] };
    expect(planCashEdit(offset, { note: '상계' }, codes, undefined, 'taebaek').dir).toBe('대체');
    expect(() => planCashEdit(offset, { dir: '출금' }, codes, undefined, 'taebaek')).toThrow();
    expect(() => planCashEdit(offset, { amount: 200 }, codes, undefined, 'taebaek')).toThrow();
  });
  it('validates company codes, money, calendar and immutable keys', () => {
    for (const patch of [{ amount: 0 }, { amount: 1.1 }, { date: '2026-02-30' }, { accountCode: 'foreign' }, { id: 'changed' }, { docNo: 'changed' }])
      expect(() => planCashEdit(current, patch, codes, undefined, 'taebaek')).toThrow();
    expect(validCashDate('2024-02-29')).toBe(true);
    expect(() => planCashEdit(current, {}, codes, undefined, 'punghoe')).toThrow();
  });
  it('allows a company-owned partner change or explicit clearing without trusting names', () => {
    const result = planCashEdit(current, { partnerId: 'p', partnerName: 'forged' }, codes, { id: 'p', companyId: 'taebaek', name: '실제' }, 'taebaek');
    expect(result.partnerName).toBe('실제');
    expect(planCashEdit(result, { partnerId: '' }, codes, undefined, 'taebaek').partnerName).toBe('');
    expect(() => planCashEdit(current, { partnerId: 'p' }, codes, { id: 'p', companyId: 'punghoe' }, 'taebaek')).toThrow();
  });
  it('synchronizes one fresh settlement and deletes all on cash deletion', () => {
    const entry = { ...current, partnerId: 'p' }, rows = [{ id: 's', companyId: 'taebaek', cashEntryId: 'cash', statementId: 'v', amount: 80 }];
    const statements = [{ id: 'v', companyId: 'taebaek', partnerId: 'p' }];
    expect(planCashSettlements(entry, { ...entry, amount: 120 }, rows, statements, 'taebaek')[0].amount).toBe(100);
    expect(planCashSettlements(entry, null, rows, statements, 'taebaek')).toEqual([]);
    expect(() => planCashSettlements(entry, { ...entry, amount: 10 }, rows, statements, 'taebaek')).toThrow();
  });
  it('keeps existing linked partner and multi-allocation edit boundaries', () => {
    const entry = { ...current, partnerId: 'old' }, row = { companyId: 'taebaek', statementId: 'v', amount: 20 };
    const statements = [{ id: 'v', companyId: 'taebaek', partnerId: 'new' }];
    expect(planCashSettlements(entry, { ...entry, partnerId: 'new' }, [row], statements, 'taebaek')).toHaveLength(1);
    expect(() => planCashSettlements(entry, { ...entry, partnerId: 'new', amount: 120 }, [row], statements, 'taebaek')).toThrow();
    expect(() => planCashSettlements(entry, { ...entry, amount: 120 }, [row, row], statements, 'taebaek')).toThrow();
    expect(() => planCashSettlements(entry, { ...entry, partnerId: 'new' }, [row], [], 'taebaek')).toThrow();
  });
});

it('대출 원금 수정·삭제는 이자를 더하지 않고 전체 원장 잔액을 다시 계산한다', () => {
  const loan = { id: 'loan', companyId: 'taebaek', accountCode: '260' as const, openingDate: '2026-07-31', openingPrincipal: 1000 };
  const payment = { id: 'cash', loanId: 'loan', companyId: 'taebaek', date: '2026-10-03', createdAt: '2026-10-03T00:00:00Z', dir: '출금' as const, amount: 120,
    lines: [{ accountCode: '260', amount: 100 }, { accountCode: '931', amount: 20 }] };
  expect(planLoanCashMutation(loan, [payment], 'cash', { ...payment, amount: 220, lines: [{ accountCode: '260', amount: 200 }, { accountCode: '931', amount: 20 }] }, 900)).toEqual({ balanceBefore: 900, balanceAfter: 800 });
  expect(planLoanCashMutation(loan, [payment], 'cash', null, 900).balanceAfter).toBe(1000);
  expect(() => planLoanCashMutation(loan, [payment], 'cash', { ...payment, amount: 2020, lines: [{ accountCode: '260', amount: 2000 }, { accountCode: '931', amount: 20 }] })).toThrow();
  expect(() => planLoanCashMutation(loan, [payment], 'cash', payment, 999)).toThrow();
});
