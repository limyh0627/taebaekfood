import { describe, it, expect } from 'vitest';
import { makeCodeToGroup, computeMonthPL, computeCashFlowMonth, addMonthStr } from './financials';
import type { IssuedStatement, AccountCode, AccountGroup, FixedCostEntry } from '../../shared/types';

const groups: AccountGroup[] = [
  { id: 'g-rev', name: '총매출', type: '수익', plLine: 'revenue' } as AccountGroup,
];
const codes: AccountCode[] = [
  { id: 'ac-400', code: '400', name: '제품매출', groupId: 'g-rev' } as AccountCode,
];
const stmt = (type: '매출' | '매입' | '비용', tradeDate: string, total: number, accountCode?: string): IssuedStatement =>
  ({ id: `${type}-${tradeDate}-${total}`, type, tradeDate, issuedAt: '', partnerId: '', partnerName: '', orderId: '', docNo: '', totalSupply: total, totalTax: 0, totalAmount: total, items: [{ name: 'x', spec: '', qty: 1, price: total, supply: total, tax: 0, total, isTaxExempt: true, accountCode }] } as IssuedStatement);

describe('addMonthStr', () => {
  it('월 가감(연도 넘김 포함)', () => {
    expect(addMonthStr('2026-07', -1)).toBe('2026-06');
    expect(addMonthStr('2026-01', -1)).toBe('2025-12');
    expect(addMonthStr('2026-12', 1)).toBe('2027-01');
  });
});

describe('makeCodeToGroup', () => {
  const c2g = makeCodeToGroup(codes, groups, groups);
  it('코드→그룹, 없으면 undefined', () => {
    expect(c2g('400')?.plLine).toBe('revenue');
    expect(c2g(undefined)).toBeUndefined();
    expect(c2g('999')).toBeUndefined();
  });
});

describe('computeMonthPL', () => {
  const c2g = makeCodeToGroup(codes, groups, groups);
  it('매출은 계정(revenue)로, 매입은 계정없어도 전표 type로 cogs', () => {
    const statements = [stmt('매출', '2026-07-05', 1000, '400'), stmt('매입', '2026-07-06', 600)];
    const fixed: FixedCostEntry[] = [{ id: 'fc1', yearMonth: '2026-07', category: '기타', label: '임차', amount: 100, createdAt: '' }];
    const pl = computeMonthPL('2026-07', statements, fixed, c2g);
    expect(pl.sales).toBe(1000);
    expect(pl.cogs).toBe(600);
    expect(pl.fixed).toBe(100);
    expect(pl.grossProfit).toBe(400);
    expect(pl.operatingProfit).toBe(300); // 400 - 0 - 100
    expect(pl.netIncome).toBe(300);
  });
  it('다른 달 전표는 제외', () => {
    const pl = computeMonthPL('2026-08', [stmt('매출', '2026-07-05', 1000, '400')], [], c2g);
    expect(pl.sales).toBe(0);
  });
});

describe('computeCashFlowMonth — 간접법 라인', () => {
  const monthPL = () => ({ sales: 0, cogs: 0, sgna: 0, fixed: 0, grossProfit: 0, operatingProfit: 300, otherIncome: 0, otherExpense: 0, netIncome: 300 });
  it('영업=순이익+감가상각, 투자=매각−취득, 재무=조달−상환, 총합 (수동)', () => {
    const cf = computeCashFlowMonth('2026-07', { depreciation: 50, assetBuy: 200, financeIn: 1000 },
      { issuedStatements: [], inventorySnapshots: [], monthPL });
    expect(cf.netAdj).toBe(300);
    expect(cf.dep).toBe(50);
    expect(cf.op).toBe(350);   // 300 + 50
    expect(cf.inv).toBe(-200); // 0 - 200
    expect(cf.fin).toBe(1000); // 1000 - 0
    expect(cf.net).toBe(1150); // 350 - 200 + 1000
  });

  it('자금 전표에서 투자·재무·감가상각 자동 집계 (계정그룹 타입 + cashDir)', () => {
    const grp = [
      { id: 'g-asset', name: '유형자산', type: '자산' } as AccountGroup,
      { id: 'g-liab', name: '차입금', type: '부채' } as AccountGroup,
      { id: 'g-exp', name: '판관비', type: '비용', plLine: 'sgna' } as AccountGroup,
    ];
    const cds = [
      { id: 'a1', code: 'M', name: '기계장치', groupId: 'g-asset' } as AccountCode,
      { id: 'a2', code: 'L', name: '단기차입금', groupId: 'g-liab' } as AccountCode,
      { id: 'a3', code: 'D', name: '감가상각비', groupId: 'g-exp' } as AccountCode,
    ];
    const c2g = makeCodeToGroup(cds, grp, grp);
    const fund = (dir: '입금' | '출금', code: string, total: number): IssuedStatement =>
      ({ id: `f-${code}-${dir}`, type: '비용', cashDir: dir, tradeDate: '2026-07-10', issuedAt: '', partnerId: '', partnerName: '', orderId: '', docNo: '', totalSupply: total, totalTax: 0, totalAmount: total, items: [{ name: 'x', spec: '', qty: 1, price: total, supply: total, tax: 0, total, isTaxExempt: true, accountCode: code }] } as IssuedStatement);
    const statements = [
      fund('출금', 'M', 5000), // 자산취득 → 투자 −5000
      fund('입금', 'L', 2000), // 차입 → 재무 +2000
      fund('출금', 'D', 300),  // 감가상각비 → 영업 가산 +300
    ];
    const cf = computeCashFlowMonth('2026-07', {}, { issuedStatements: statements, inventorySnapshots: [], monthPL, codeToGroup: c2g, accountCodes: cds });
    expect(cf.assetBuy).toBe(5000);
    expect(cf.inv).toBe(-5000);
    expect(cf.finIn).toBe(2000);
    expect(cf.fin).toBe(2000);
    expect(cf.dep).toBe(300);
    expect(cf.op).toBe(600); // 순이익300 + 감가300
  });
});
