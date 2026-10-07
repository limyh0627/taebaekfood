import { describe, expect, it } from 'vitest';
import { buildStatementVoucher, canAutoIssue } from './autoVoucher';
import { journalizeStatement } from './autoJournal';
import type { FixedCostTemplate } from './types';

const base = { id: 'fee', companyId: 'taebaek', name: '기장료', category: '기타', active: false,
  dir: '대체', accountCode: '828', partnerId: 'bank', amount: 110000, autoIssue: true } as FixedCostTemplate;
describe('명시한 정기 전표 종류', () => {
  it.each(['taebaek', 'punghoe'] as const)('거래처 연결과 무관하게 %s의 대체 양변을 보존한다', companyId => {
    const template = { ...base, companyId, statementType: '비용' as const,
      transferLines: [{ accountCode: '828', side: '차변' as const }, { accountCode: '253', side: '대변' as const }] };
    expect(canAutoIssue(template, '2026-10')).toBe(true);
    const statement = buildStatementVoucher(template, '2026-10');
    expect(statement).toMatchObject({ id: 'AUTO-fee-2026-10', type: '비용', totalSupply: 110000, totalTax: 0, totalAmount: 110000 });
    expect(statement.items).toEqual([
      expect.objectContaining({ accountCode: '828', side: '차변', total: 110000 }),
      expect.objectContaining({ accountCode: '253', side: '대변', total: 110000 }),
    ]);
  });
  it('은행 거래처에 명시 매출을 선택하면 매출 종류와 과세를 유지한다', () => {
    expect(buildStatementVoucher({ ...base, statementType: '매출' }, '2026-10')).toMatchObject({ type: '매출', totalSupply: 100000, totalTax: 10000 });
  });
  it('줄돈과 매출 종류가 충돌하면 자동 발행과 초안을 거절한다', () => {
    const template = { ...base, dir: '줄돈' as const, statementType: '매출' as const };
    expect(canAutoIssue(template, '2026-10')).toBe(false);
    expect(() => buildStatementVoucher(template, '2026-10')).toThrow('줄돈');
  });
  it('임차료 매입 분개는 기존 미지급금 계정을 유지한다', () => {
    const statement = buildStatementVoucher({ ...base, dir: '줄돈', accountCode: '819', statementType: '매입' }, '2026-10');
    expect(journalizeStatement(statement)?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '253', credit: 110000 })]));
  });
  it('명시 종류가 없는 옛 템플릿과 불완전 대체의 발행 조건을 유지한다', () => {
    expect(buildStatementVoucher(base, '2026-10').type).toBe('매입');
    expect(buildStatementVoucher({ ...base, dir: '받을돈' }, '2026-10').type).toBe('매출');
    expect(canAutoIssue({ ...base, statementType: '비용', transferLines: [{ accountCode: '828', side: '차변' }] }, '2026-10')).toBe(false);
  });
});
