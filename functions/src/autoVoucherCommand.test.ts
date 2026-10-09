import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ loan: vi.fn(), issue: vi.fn() }));
vi.mock('./loanMovementCommand', () => ({ recordScheduledLoanMovement: calls.loan }));
vi.mock('./voucherIssue', () => ({ issueVoucher: calls.issue }));
import { issueScheduledVoucher } from './autoVoucherCommand';
const template = { id: 'repay', companyId: 'taebaek', autoIssue: true, mode: '상환', dir: '출금', accountCode: '260',
  loanId: 'contract', loanCode: '260', amount: 110, principal: 100, interest: 10, issueDay: 9 };
const db = {} as Parameters<typeof issueScheduledVoucher>[0];
beforeEach(() => { calls.loan.mockReset(); calls.issue.mockReset(); calls.loan.mockResolvedValue({ result: { docNo: '261009-001' } }); });
describe('scheduler loan dispatch', () => {
  it('uses the atomic loan command rather than generic numbered cash', async () => {
    expect(await issueScheduledVoucher(db, template, '2026-10', '2026-10-09', 'release')).toEqual({ result: { docNo: '261009-001' } });
    expect(calls.loan).toHaveBeenCalledExactlyOnceWith(db, 'repay', 'taebaek', '2026-10', '2026-10-09', 'release');
    expect(calls.issue).not.toHaveBeenCalled();
  });
  it('lets the loan transaction inspect its saved monthly request before a now-disabled template', async () => {
    await issueScheduledVoucher(db, { ...template, autoIssue: false, principal: 999 }, '2026-10', '2026-10-09', 'release');
    expect(calls.loan).toHaveBeenCalledOnce();
    expect(calls.issue).not.toHaveBeenCalled();
  });
  it('preserves unsupported unlinked split skip and ordinary date skip', async () => {
    expect(await issueScheduledVoucher(db, { ...template, loanId: undefined }, '2026-10', '2026-10-09', 'release')).toEqual({ skip: '대출 상환 분할 필요' });
    expect(await issueScheduledVoucher(db, { ...template, mode: undefined, loanId: undefined, principal: 0, interest: 0 }, '2026-10', '2026-10-08', 'release')).toEqual({ skip: '발행일 아님' });
    expect(calls.loan).not.toHaveBeenCalled();
    expect(calls.issue).not.toHaveBeenCalled();
  });
});
