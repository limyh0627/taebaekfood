import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FixedCostTemplate } from '../../shared/types';
import * as autoVoucher from '../../shared/autoVoucher';
import { issueNumberedCashEntry, issueNumberedStatement } from '../statements/infrastructure/issueTradeStatementCommand';
import { issueRecurringVouchers } from './recurringVoucherIssue';

vi.mock('../statements/infrastructure/issueTradeStatementCommand', () => ({
  issueNumberedCashEntry: vi.fn(), issueNumberedStatement: vi.fn(),
}));

const template = (patch: Partial<FixedCostTemplate> = {}): FixedCostTemplate => ({
  id: 'rent', name: '임대료', amount: 1100, category: '기타', active: true,
  dir: '출금', mode: '일반', accountCode: '510', autoIssue: true, issueDay: 31, ...patch,
});
const input = (templates = [template()]): Parameters<typeof issueRecurringVouchers>[0] => ({
  ym: '2026-02', companyId: 'punghoe', createdBy: '담당자', templates,
  cashEntries: [], issuedStatements: [], accountCodes: [{ code: '510', name: '임차료' }],
  cashAccounts: [
    { id: 'inactive', active: false, type: '통장' },
    { id: 'card', active: true, type: '카드' },
    { id: 'bank', active: true, type: '통장' },
  ],
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.mocked(issueNumberedCashEntry).mockResolvedValue({ id: 'saved', docNo: '260228-001' });
  vi.mocked(issueNumberedStatement).mockResolvedValue({ id: 'saved', docNo: '260228-002' });
});

describe('정기 전표 서버 발행', () => {
  it('현금과 채무 전표의 기존 본문·회사·담당자를 서버 발행 함수에 전달한다', async () => {
    expect(await issueRecurringVouchers(input([
      template(), template({ id: 'due', dir: '줄돈', partnerId: 'landlord' }),
    ]))).toBe(2);
    expect(issueNumberedCashEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'AUTO-rent-2026-02', date: '2026-02-28', dir: '출금', amount: 1100,
      cashAccountId: 'bank', accountCode: '510', companyId: 'punghoe', createdBy: '담당자',
    }));
    expect(vi.mocked(issueNumberedCashEntry).mock.calls[0][0]).not.toHaveProperty('docNo');
    expect(issueNumberedStatement).toHaveBeenCalledWith(expect.objectContaining({
      id: 'AUTO-due-2026-02', orderId: 'AUTO-due-2026-02', tradeDate: '2026-02-28',
      type: '매입', partnerId: 'landlord', docNo: '', totalSupply: 1000, totalTax: 100,
      totalAmount: 1100, companyId: 'punghoe', createdBy: '담당자',
      items: [expect.objectContaining({ name: '임차료', accountCode: '510' })],
    }));
  });

  it('onlyId와 발행기간·수동 대상 제한을 그대로 적용한다', async () => {
    const templates = [template(), template({ id: 'disabled', autoIssue: false }),
      template({ id: 'future', startYm: '2026-03' }), template({ id: 'ended', endYm: '2026-01' }),
      template({ id: 'loan', mode: '상환', loanId: 'loan-1' }),
      template({ id: 'transfer', dir: '회사이체' }), template({ id: 'bare', dir: '대체' })];
    expect(await issueRecurringVouchers({ ...input(templates), onlyId: 'rent' })).toBe(1);
    vi.mocked(issueNumberedCashEntry).mockClear();
    expect(await issueRecurringVouchers(input(templates.slice(1)))).toBe(0);
    expect(issueNumberedCashEntry).not.toHaveBeenCalled();
    expect(issueNumberedStatement).not.toHaveBeenCalled();
  });

  it.each(['AUTO-rent-2026-02', 'RC-rent-2026-02'])('자금의 기존 ID %s를 다시 발행하지 않는다', async id => {
    expect(await issueRecurringVouchers({ ...input(), cashEntries: [{ id }] })).toBe(0);
    expect(issueNumberedCashEntry).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'AUTO-rent-2026-02', orderId: '' },
    { id: 'RC-rent-2026-02', orderId: '' },
    { id: 'existing', orderId: 'AUTO-rent-2026-02' },
    { id: 'existing', orderId: 'RC-rent-2026-02' },
  ])('채무 전표의 기존 ID·주문 키를 다시 발행하지 않는다: %j', async statement => {
    expect(await issueRecurringVouchers({ ...input(), issuedStatements: [statement] })).toBe(0);
    expect(issueNumberedCashEntry).not.toHaveBeenCalled();
  });

  it('통장이 없으면 활성 카드, 계좌가 없으면 기존 빈 계좌값을 유지한다', async () => {
    await issueRecurringVouchers({ ...input(), cashAccounts: [{ id: 'card', active: true, type: '카드' }] });
    expect(issueNumberedCashEntry).toHaveBeenLastCalledWith(expect.objectContaining({ cashAccountId: 'card' }));
    await issueRecurringVouchers({ ...input(), cashAccounts: [] });
    expect(issueNumberedCashEntry).toHaveBeenLastCalledWith(expect.objectContaining({ cashAccountId: '' }));
  });

  it('보호계정 서버 거절을 전파하고 뒤 전표를 발행하지 않으며 재시도 ID를 유지한다', async () => {
    const args = input([template({ accountCode: '293' }), template({ id: 'later', dir: '줄돈', partnerId: 'p1' })]);
    vi.mocked(issueNumberedCashEntry).mockRejectedValue(new Error('원자 명령이 필요합니다'));
    await expect(issueRecurringVouchers(args)).rejects.toThrow('원자 명령이 필요합니다');
    await expect(issueRecurringVouchers(args)).rejects.toThrow('원자 명령이 필요합니다');
    expect(issueNumberedStatement).not.toHaveBeenCalled();
    expect(vi.mocked(issueNumberedCashEntry).mock.calls.map(([entry]) => entry.id))
      .toEqual(['AUTO-rent-2026-02', 'AUTO-rent-2026-02']);
    const semantic = (entry: Record<string, unknown>) => {
      const { createdAt, createdBy, ...body } = entry;
      return body;
    };
    expect(semantic({ ...vi.mocked(issueNumberedCashEntry).mock.calls[0][0] }))
      .toEqual(semantic({ ...vi.mocked(issueNumberedCashEntry).mock.calls[1][0] }));
  });

  it.each(['계정 누락', '합계 불일치'])('기존 분개 검증을 보존한다: %s', async kind => {
    const due = template({ dir: '줄돈', partnerId: 'p1' });
    const statement = autoVoucher.buildStatementVoucher(due, '2026-02');
    if (kind === '계정 누락') statement.items[0].accountCode = undefined;
    else statement.items[0].supply = 100;
    vi.spyOn(autoVoucher, 'buildStatementVoucher').mockReturnValue(statement);
    await expect(issueRecurringVouchers(input([due]))).rejects.toThrow('전표를 만들 수 없습니다');
    expect(issueNumberedStatement).not.toHaveBeenCalled();
  });

  it('화면은 회사별 자료를 정기 발행 함수에 넘긴다', () => {
    const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
    const start = source.indexOf('  const generateRecurringCosts =');
    const end = source.indexOf('  });', start) + '  });'.length;
    const body = source.slice(start, end);
    expect(body).toContain('issueRecurringVouchers({');
    expect(body).toContain('templates: companyTemplates');
    expect(body).toContain('cashEntries: companyCashEntries');
    expect(body).toContain('cashAccounts: companyCashAccounts');
    expect(body).not.toMatch(/addItem|addCashEntry|claimDocNo/);
  });
});
