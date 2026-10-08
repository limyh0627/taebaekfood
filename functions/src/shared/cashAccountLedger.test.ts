import { describe, expect, it } from 'vitest';
import { buildAccountLedger, signedAmount, type LedgerCashEntry } from './cashAccountLedger';
const account = { id: 'bank', companyId: 'taebaek' as const, openingDate: '2026-07-31', openingBalance: 100 };
const cash = (id: string, date: string, dir: LedgerCashEntry['dir'], amount: number, extra: Partial<LedgerCashEntry> = {}): LedgerCashEntry => ({ id, date, dir, amount, cashAccountId: 'bank', companyId: 'taebaek', createdAt: `${date}T00:00:00Z`, ...extra });
describe('shared exact account ledger', () => {
  it('retains dated movements, negative closing and period opening', () => {
    const entries = [cash('a', '2026-08-01', '입금', 20), cash('b', '2026-09-01', '출금', 150), cash('offset', '2026-09-01', '대체', 100)];
    expect(buildAccountLedger(account, entries, '2026-09-01', '2026-09-30')).toMatchObject({ opening: 120, totalIn: 0, totalOut: 150, totalAdjustment: 0, closing: -30 });
    expect(signedAmount(entries[2])).toBe(0);
  });
  it('runs real movements before same-day cash and account anchors in stable creation order', () => {
    const entries = [cash('early-anchor', '2026-08-31', '입금', 1, { createdAt: '2026-08-31T01:00:00Z', balanceAdjustment: { before: 0, target: 200, delta: 200, reason: '이전', confirmedBalance: true } }),
      cash('late-movement', '2026-08-31', '출금', 40, { createdAt: '2026-08-31T23:00:00Z' })];
    const result = buildAccountLedger({ ...account, confirmedBalances: [{ date: '2026-08-31', balance: 300, recordedAt: '2026-08-31T02:00:00Z', reason: '확정' }] }, entries, '', '2026-08-31');
    expect(result.rows.map(row => row.balance)).toEqual([60, 200, 300]);
    expect(result.totalOut).toBe(40); expect(result.totalAdjustment).toBe(240); expect(result.closing).toBe(300);
    expect(result.rows[2].confirmedAccountBalance).toBe(true);
  });
  it('uses the latest recorded date confirmation including zero and keeps later movements', () => {
    const result = buildAccountLedger({ ...account, confirmedBalances: [
      { date: '2026-08-31', balance: 300, recordedAt: '2026-09-01T00:00:00Z', reason: '옛값' },
      { date: '2026-08-31', balance: 0, recordedAt: '2026-09-02T00:00:00Z', reason: '최신' }] },
      [cash('after', '2026-09-01', '입금', 20)], '2026-09-01', '2026-09-30');
    expect(result).toMatchObject({ opening: 0, totalIn: 20, totalAdjustment: 0, closing: 20 });
  });
  it('preserves legacy delta meaning and excludes a different account or before-opening movement', () => {
    const result = buildAccountLedger(account, [cash('old', '2026-07-30', '입금', 900), cash('other', '2026-08-01', '입금', 900, { cashAccountId: 'other' }),
      cash('delta', '2026-08-01', '출금', 20, { balanceAdjustment: { before: 100, target: 80, delta: -20, reason: '차액' } })], '', '2026-08-31');
    expect(result).toMatchObject({ totalIn: 0, totalOut: 0, totalAdjustment: -20, closing: 80 });
  });
});
