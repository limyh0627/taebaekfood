import { describe, it, expect } from 'vitest';
import { makeCodeToGroup, computeMonthPL, computeCashFlowMonth, addMonthStr, filterCodesForContext } from './financials';
import type { IssuedStatement, AccountCode, AccountGroup, FixedCostEntry, CashEntry } from '../../shared/types';

describe('filterCodesForContext', () => {
  const gs: AccountGroup[] = [
    { id: 'ag-revenue', name: '총매출', type: '수익' } as AccountGroup,
    { id: 'ag-cogs', name: '총매출원가', type: '비용' } as AccountGroup,
    { id: 'ag-asset', name: '자산', type: '자산' } as AccountGroup,
    { id: 'ag-liability', name: '부채', type: '부채' } as AccountGroup,
  ];
  const cs: AccountCode[] = [
    { id: '800', code: '800', name: '일반매출', groupId: 'ag-revenue' },
    { id: '520', code: '520', name: '전기세', groupId: 'ag-cogs' },
    { id: '206', code: '206', name: '기계장치', groupId: 'ag-asset' },
    { id: '260', code: '260', name: '단기차입금', groupId: 'ag-liability' },
    { id: '605', code: '605', name: '운임' },                       // 그룹 미지정
  ];
  const names = (ctx: '매출' | '매입' | '자금') => filterCodesForContext(cs, gs, ctx).map(c => c.code);

  it('매출전표에는 수익 계정만 (단기차입금·기계장치 안 뜸)', () => {
    expect(names('매출')).toEqual(['800', '605']);
  });
  it('매입전표에는 비용·자산 계정만 (단기차입금 안 뜸)', () => {
    expect(names('매입')).toEqual(['520', '206', '605']);
  });
  it('자금 전표는 전부 — 돈이 나가는 이유는 뭐든 될 수 있다', () => {
    expect(names('자금')).toEqual(['800', '520', '206', '260', '605']);
  });
  it('그룹 미지정 계정은 감추지 않는다 (기존 전표를 고칠 수 있어야 한다)', () => {
    expect(names('매출')).toContain('605');
    expect(names('매입')).toContain('605');
  });
});

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

  // ── 자금원장(cashEntries) 전환 ──
  const grpCf = [
    { id: 'g-asset', name: '유형자산', type: '자산' } as AccountGroup,
    { id: 'g-liab', name: '차입금', type: '부채' } as AccountGroup,
    { id: 'g-ap', name: '매입채무', type: '부채', cfSection: 'operating' } as AccountGroup,
    { id: 'g-exp', name: '판관비', type: '비용', plLine: 'sgna' } as AccountGroup,
  ];
  const cdsCf = [
    { id: 'a1', code: 'M', name: '기계장치', groupId: 'g-asset' } as AccountCode,
    { id: 'a2', code: 'L', name: '단기차입금', groupId: 'g-liab' } as AccountCode,
    { id: 'a3', code: 'AP', name: '매입채무', groupId: 'g-ap' } as AccountCode,
  ];
  const c2gCf = makeCodeToGroup(cdsCf, grpCf, grpCf);
  const cash = (id: string, date: string, dir: '입금' | '출금', amount: number, accountCode?: string): CashEntry =>
    ({ id, date, cashAccountId: 'a1', dir, amount, accountCode, createdAt: '' });

  it('자금원장에서 투자·재무를 집계한다 (기계 구입 출금, 차입 입금)', () => {
    const cf = computeCashFlowMonth('2026-07', {}, {
      issuedStatements: [], inventorySnapshots: [], monthPL, codeToGroup: c2gCf, accountCodes: cdsCf,
      cashEntries: [cash('c1', '2026-07-10', '출금', 5000, 'M'), cash('c2', '2026-07-11', '입금', 2000, 'L')],
    });
    expect(cf.assetBuy).toBe(5000);
    expect(cf.finIn).toBe(2000);
    expect(cf.net).toBe(-2700); // 영업300 − 투자5000 + 재무2000
  });

  // 매입채무는 부채지만 영업 — 성격만으로 추측하면 재무로 잘못 간다. cfSection이 이겨야 한다.
  it('cfSection=operating이면 부채라도 재무활동에 안 잡힌다', () => {
    const cf = computeCashFlowMonth('2026-07', {}, {
      issuedStatements: [], inventorySnapshots: [], monthPL, codeToGroup: c2gCf, accountCodes: cdsCf,
      cashEntries: [cash('c1', '2026-07-10', '출금', 9000, 'AP')],
    });
    expect(cf.debtRepay).toBe(0);
    expect(cf.fin).toBe(0);
  });

  it('cfSection이 없으면 기존 추측(자산→투자, 부채→재무)으로 폴백한다', () => {
    const cf = computeCashFlowMonth('2026-07', {}, {
      issuedStatements: [], inventorySnapshots: [], monthPL, codeToGroup: c2gCf, accountCodes: cdsCf,
      cashEntries: [cash('c1', '2026-07-10', '출금', 5000, 'M')],  // g-asset엔 cfSection 없음
    });
    expect(cf.assetBuy).toBe(5000);
  });

  // 결제 경로가 둘(구 payments[] / 신 settlements)이라도 매입채무는 한 번만 줄어야 한다.
  it('결제를 settlements로 기록해도 매입채무가 맞게 떨어진다', () => {
    const buy = stmt('매입', '2026-07-01', 10000);
    const cf = computeCashFlowMonth('2026-07', {}, {
      issuedStatements: [buy], inventorySnapshots: [], monthPL, codeToGroup: c2gCf, accountCodes: cdsCf,
      cashEntries: [cash('c1', '2026-07-20', '출금', 6000, 'AP')],
      settlements: [{ id: 's1', cashEntryId: 'c1', statementId: buy.id, amount: 6000, createdAt: '' }],
    });
    expect(cf.apChg).toBe(4000);  // 발생 10000 − 결제 6000
  });

  it('구 payments[]와 신 settlements가 섞여 있어도 둘 다 결제로 인정한다', () => {
    const buy = { ...stmt('매입', '2026-07-01', 10000), payments: [{ id: 'p1', amount: 3000, date: '2026-07-15' }] } as IssuedStatement;
    const cf = computeCashFlowMonth('2026-07', {}, {
      issuedStatements: [buy], inventorySnapshots: [], monthPL, codeToGroup: c2gCf, accountCodes: cdsCf,
      cashEntries: [cash('c1', '2026-07-20', '출금', 6000, 'AP')],
      settlements: [{ id: 's1', cashEntryId: 'c1', statementId: buy.id, amount: 6000, createdAt: '' }],
    });
    expect(cf.apChg).toBe(1000);  // 10000 − (3000 + 6000)
  });
});
