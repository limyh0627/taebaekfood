import { describe, expect, it } from 'vitest';
import { buildProfitPeriodProjection } from './profitPeriodProjection';
import { buildJournals } from '../../shared/buildJournals';
import { computeMonthPLFromJournals } from './financials';
import { AR, AP, INVENTORY } from '../../shared/autoJournal';
import type { AccountCode, AccountGroup, CashEntry, CompanyId, IssuedStatement } from '../../shared/types';

const groups = [
  { id: 'revenue', plLine: 'revenue' }, { id: 'cogs', plLine: 'cogs' }, { id: 'sgna', plLine: 'sgna' },
] as AccountGroup[];
const accounts = [
  { id: '400', code: '400', name: '매출', type: '수익', normalBalance: 'credit', groupId: 'revenue' },
  { id: '500', code: '500', name: '매입', type: '비용', normalBalance: 'debit', groupId: 'cogs' },
  { id: '520', code: '520', name: '관리비', type: '비용', normalBalance: 'debit', groupId: 'sgna' },
  ...[AR, AP, INVENTORY, '103', '331'].map(code => ({ id: code, code, name: code, type: '자산', normalBalance: 'debit' })),
] as AccountCode[];
const codeToGroup = (code: string | undefined) => groups.find(group => group.id === accounts.find(account => account.code === code)?.groupId);
const statement = (companyId: CompanyId, type: '매출' | '매입', amount: number, date: string): IssuedStatement => ({
  id: `${companyId}-${type}-${amount}`, companyId, type, tradeDate: date, issuedAt: date, partnerId: 'partner',
  partnerName: '검수 거래처', orderId: '', docNo: '', totalSupply: amount, totalTax: 0, totalAmount: amount,
  items: [{ name: '품목', spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode: type === '매출' ? '400' : '500' }],
} as IssuedStatement);
const fixture = (companyId: CompanyId) => ({
  statements: [statement(companyId, '매출', 1000, '2025-12-31'), statement(companyId, '매출', -100, '2026-01-01'),
    statement(companyId, '매입', 300, '2026-01-02')],
  cashEntries: [{ id: `${companyId}-cash`, companyId, date: '2026-01-03', dir: '출금', amount: 200,
    accountCode: '520', cashAccountId: 'bank', note: '관리비' }] as CashEntry[],
  accounts, opening: { date: '2025-12-01', lines: [{ accountCode: INVENTORY, amount: 1000 }] },
  inventorySnapshots: [{ id: `${companyId}-2025-12`, yearMonth: '2025-12', value: 1000 },
    { id: `${companyId}-2026-01`, yearMonth: '2026-01', value: 900 }],
  periodMonths: ['2025-12', '2026-01'], codeToGroup,
});

describe('손익 기간 순수 투영', () => {
  it.each(['taebaek', 'punghoe'] as CompanyId[])('%s 회사별 화면 입력은 기존 분개·월별 계산과 같다', companyId => {
    const input = fixture(companyId);
    const original = structuredClone({ ...input, codeToGroup: undefined });
    const result = buildProfitPeriodProjection(input);
    const entries = buildJournals(input).entries;
    expect(result).toEqual({ journalEntries: entries, monthlyData: input.periodMonths.map(ym => ({
      month: `${Number(ym.split('-')[1])}월`, ym, ...computeMonthPLFromJournals(ym, entries, accounts, codeToGroup),
    })) });
    expect(result.monthlyData.map(row => row.sales)).toEqual([1000, -100]);
    expect(result.monthlyData[1].sgna).toBe(200);
    expect(result.monthlyData.map(row => row.month)).toEqual(['12월', '1월']);
    expect(result.journalEntries.some(entry => entry.id.includes(companyId))).toBe(true);
    expect({ ...input, codeToGroup: undefined }).toEqual(original);
  });
  it('선택 기간 순서를 유지하며 빈 기간도 분개를 제거하지 않는다', () => {
    const input = fixture('taebaek');
    expect(buildProfitPeriodProjection({ ...input, periodMonths: ['2026-01', '2025-12'] }).monthlyData.map(row => row.ym))
      .toEqual(['2026-01', '2025-12']);
    const empty = buildProfitPeriodProjection({ ...input, periodMonths: [] });
    expect(empty.monthlyData).toEqual([]);
    expect(empty.journalEntries).toEqual(buildJournals(input).entries);
  });
});
