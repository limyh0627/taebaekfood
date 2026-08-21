import { describe, it, expect } from 'vitest';
import { buildJournals } from './buildJournals';
import { computeMonthPLFromJournals, makeCodeToGroup } from '../features/admin/financials';
import type { AccountCode, AccountGroup, CashEntry, IssuedStatement } from './types';

/**
 * 손익에는 **전표와 자금원장이 둘 다** 들어가야 한다.
 *
 * 실제로 손익분석 화면이 자금원장을 안 받고 있었다(prop 미전달 + 기본값 []).
 * 급여·이자비용은 전표 없이 자금으로만 나가는 비용이라, 계정도 전표도 멀쩡한데
 * 화면에서 통째로 0으로 잡혔다. 노무비 그룹은 줄 자체가 사라졌다.
 */
const CODES: AccountCode[] = [
  { id: '800', code: '800', name: '일반매출', type: '수익', normalBalance: 'credit', groupId: 'ag-revenue' },
  { id: '515', code: '515', name: '급여', type: '비용', normalBalance: 'debit', groupId: 'ag-labor' },
  { id: '951', code: '951', name: '이자비용', type: '비용', normalBalance: 'debit', groupId: 'ag-other-expense' },
  { id: '103', code: '103', name: '보통예금', type: '자산', normalBalance: 'debit', groupId: 'ag-asset' },
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit', groupId: 'ag-asset' },
  { id: '255', code: '255', name: '부가세예수금', type: '부채', normalBalance: 'credit', groupId: 'ag-liability' },
] as AccountCode[];
const GROUPS: AccountGroup[] = [
  { id: 'ag-revenue', name: '총매출', type: '수익', plLine: 'revenue' },
  { id: 'ag-labor', name: '노무비', type: '비용', plLine: 'cogs' },
  { id: 'ag-other-expense', name: '영업외비용', type: '비용', plLine: 'other-expense' },
  { id: 'ag-asset', name: '자산', type: '자산' },
  { id: 'ag-liability', name: '부채', type: '부채' },
] as AccountGroup[];

const 매출: IssuedStatement = {
  id: 's1', issuedAt: '2026-08-10T00:00:00.000Z', tradeDate: '2026-08-10', type: '매출',
  partnerId: 'p1', partnerName: '가득찬식품', orderId: '', docNo: '260810-01',
  totalSupply: 10_000_000, totalTax: 0, totalAmount: 10_000_000,
  items: [{ name: '참기름', spec: '', qty: 1, price: 10_000_000, supply: 10_000_000, tax: 0, total: 10_000_000, isTaxExempt: true, accountCode: '800' }],
};
const 급여: CashEntry = { id: 'c1', date: '2026-08-11', dir: '출금', amount: 3_200_000, accountCode: '515', cashAccountId: '', note: '급여' } as CashEntry;
const 이자: CashEntry = { id: 'c2', date: '2026-08-19', dir: '출금', amount: 1_300_000, accountCode: '951', cashAccountId: '', note: '수협 (이자)' } as CashEntry;

const codeToGroup = makeCodeToGroup(CODES, GROUPS, GROUPS);
const pl = (cashEntries: CashEntry[]) =>
  computeMonthPLFromJournals('2026-08',
    buildJournals({ statements: [매출], cashEntries, accounts: CODES }).entries,
    CODES, codeToGroup);

describe('자금원장에만 있는 비용', () => {
  it('자금원장을 넘기면 급여가 매출원가(노무비)에 잡힌다', () => {
    expect(pl([급여, 이자]).cogs).toBe(3_200_000);
  });

  it('자금원장을 넘기면 이자가 영업외비용에 잡힌다', () => {
    expect(pl([급여, 이자]).otherExpense).toBe(1_300_000);
  });

  it('자금원장을 빠뜨리면 둘 다 0이 된다 — 화면이 실제로 이랬다', () => {
    const 없이 = pl([]);
    expect(없이.cogs).toBe(0);
    expect(없이.otherExpense).toBe(0);
    expect(없이.sales).toBe(10_000_000);          // 매출은 전표라 멀쩡히 보인다
    expect(없이.netIncome).toBe(10_000_000);      // 그래서 이익이 부풀어 보인다
  });

  it('빠뜨리면 순이익이 4,500,000원 부풀어 보인다', () => {
    expect(pl([]).netIncome - pl([급여, 이자]).netIncome).toBe(4_500_000);
  });
});
