import { describe, expect, it } from 'vitest';
import { planTaxIssue } from './taxIssue';
import type { IssuedStatement } from '../../../shared/types';

const statement = (id: string, exempt: boolean): IssuedStatement => ({
  id, issuedAt: '2026-09-14T00:00:00Z', tradeDate: '2026-09-14', type: '매출',
  partnerId: 'p1', partnerName: '거래처', orderId: '', docNo: id,
  totalSupply: 1000, totalTax: exempt ? 0 : 100, totalAmount: exempt ? 1000 : 1100,
  items: [{ name: '품목', spec: '', qty: 1, price: exempt ? 1000 : 1100, supply: 1000, tax: exempt ? 0 : 100, total: exempt ? 1000 : 1100, isTaxExempt: exempt }],
});

describe('세금계산서 원자 발행 계획', () => {
  it('과세·면세 기록과 대상 전표 표시를 한 쓰기 목록에 담는다', () => {
    const plan = planTaxIssue({ operationId: 'issue-1', companyId: 'taebaek',
      statements: [statement('tax', false), statement('free', true)], scope: 'all', issuedAt: '2026-09-14T01:00:00Z' });
    expect(plan.writes.filter(w => w.collection === 'taxIssueRecords').map(w => w.id))
      .toEqual(['issue-1_taxable', 'issue-1_exempt']);
    expect(plan.statementPatches).toEqual([
      { id: 'tax', data: { taxIssuedAt: '2026-09-14T01:00:00Z' } },
      { id: 'free', data: { exemptIssuedAt: '2026-09-14T01:00:00Z', taxIssuedAt: '2026-09-14T01:00:00Z' } },
    ]);
  });

  it('과세만 발행하면 면세 전표는 건드리지 않는다', () => {
    const plan = planTaxIssue({ operationId: 'issue-2', companyId: 'taebaek',
      statements: [statement('tax', false), statement('free', true)], scope: 'taxable', issuedAt: 'now' });
    expect(plan.statementPatches.map(p => p.id)).toEqual(['tax']);
  });
});
