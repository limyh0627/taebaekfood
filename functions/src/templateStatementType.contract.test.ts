import { describe, expect, it, vi } from 'vitest';
import { autoVoucherDraft } from './autoVoucherDraft';
import { buildStatementVoucher, canAutoIssue } from '../../src/shared/autoVoucher';
import type { FixedCostTemplate } from '../../src/shared/types';
const issue = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'issued', docNo: '261010-001' }));
vi.mock('./voucherIssue', () => ({ issueVoucher: issue }));
import { issueScheduledVoucher } from './autoVoucherCommand';

const base = { id: 'fee', companyId: 'taebaek' as const, name: '기장료', accountCode: '828',
  amount: 110000, autoIssue: true, issueDay: 10, dir: '대체', partnerId: 'bank' };
const lines = [{ accountCode: '828', side: '차변' as const }, { accountCode: '253', side: '대변' as const }];
describe('명시 전표 종류의 앱과 예약 계약', () => {
  it.each(['taebaek', 'punghoe'] as const)('양사 %s 명시 세 종류가 동일한 초안을 만든다', companyId => {
    for (const statementType of ['매입', '매출', '비용'] as const) {
      const template = { ...base, companyId, statementType, ...(statementType === '비용' ? { transferLines: lines } : {}) };
      const actual = autoVoucherDraft(template, '2026-10', '2026-10-10').draft!;
      const app = buildStatementVoucher(template as FixedCostTemplate, '2026-10');
      expect(canAutoIssue(template as FixedCostTemplate, '2026-10')).toBe(true);
      expect(actual.operationId).toBe(app.id);
      expect(actual.document).toMatchObject({ type: app.type, totalSupply: app.totalSupply, totalTax: app.totalTax, totalAmount: app.totalAmount, items: app.items });
    }
  });
  it('종류 충돌·불완전 대체·옛 양변 양식은 자동으로 발행하지 않는다', () => {
    for (const patch of [
      { dir: '줄돈', statementType: '매출' as const },
      { statementType: '비용' as const, transferLines: lines.slice(0, 1) },
      { transferLines: lines },
    ]) {
      const template = { ...base, ...patch };
      expect(canAutoIssue(template as FixedCostTemplate, '2026-10')).toBe(false);
      expect(autoVoucherDraft(template, '2026-10', '2026-10-10').draft).toBeUndefined();
    }
  });
  it.each(['taebaek', 'punghoe'] as const)('%s 명시 대체의 재시도는 같은 AUTO ID·내용·대체 접두사를 번호 명령에 전달한다', async companyId => {
    issue.mockClear();
    const db = { collection: () => ({ get: async () => ({ docs: ['828', '253'].map(code => ({ id: code, data: () => ({ companyId, code }) })) }) }) };
    const template = { ...base, companyId, statementType: '비용' as const, transferLines: lines };
    for (let i = 0; i < 2; i++) await issueScheduledVoucher(db as never, template, '2026-10', '2026-10-10', 'release');
    expect(issue).toHaveBeenCalledTimes(2);
    expect(issue.mock.calls[0][2]).toEqual(issue.mock.calls[1][2]);
    expect(issue.mock.calls[0][1]).toBe(companyId);
    expect(issue.mock.calls[0][2]).toMatchObject({ prefix: '대체', operationId: 'AUTO-fee-2026-10', document: { type: '비용' } });
  });
  it('명시 대체는 다른 회사의 계정만 존재할 때 발행하지 않는다', async () => {
    issue.mockClear();
    const db = { collection: () => ({ get: async () => ({ docs: ['828', '253'].map(code => ({ id: code, data: () => ({ companyId: 'punghoe', code }) })) }) }) };
    expect(await issueScheduledVoucher(db as never, { ...base, statementType: '비용', transferLines: lines }, '2026-10', '2026-10-10', 'release'))
      .toEqual({ skip: '현재 회사 계정표에 없는 계정: 828, 253' });
    expect(issue).not.toHaveBeenCalled();
  });
});
