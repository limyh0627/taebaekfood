import { IssuedStatement, FixedCostEntry, AccountCode, AccountGroup } from '../../shared/types';

/**
 * 손익 계산 순수 도메인 모듈 — 부수효과 없음(입력 → 값). 단위 테스트 용이.
 */

// 계산결과 그룹(집계용) / 구 판매비·관리비 그룹 id
export const COMPUTED_GROUP_IDS = new Set(['ag-gross-profit', 'ag-op-profit']);
export const SGNA_LEGACY_IDS = new Set(['ag-selling', 'ag-admin']);

/** 계정코드(code) → AccountGroup 조회기. 구 판매비/관리비 id는 판관비(ag-sgna)로 매핑. */
export function makeCodeToGroup(
  accountCodes: AccountCode[],
  accountGroups: AccountGroup[],
  rawAccountGroups: AccountGroup[],
): (code: string | undefined) => AccountGroup | undefined {
  const codeMap = new Map(accountCodes.map(ac => [ac.code, ac]));
  const groupMap = new Map(accountGroups.map(g => [g.id, g]));
  const sgnaGroup = groupMap.get('ag-sgna') ?? rawAccountGroups.find(g => SGNA_LEGACY_IDS.has(g.id));
  return (code) => {
    if (!code) return undefined;
    const ac = codeMap.get(code);
    if (!ac?.groupId) return undefined;
    if (SGNA_LEGACY_IDS.has(ac.groupId)) return sgnaGroup ? { ...sgnaGroup, id: 'ag-sgna', name: '판관비' } : undefined;
    return groupMap.get(ac.groupId);
  };
}

export interface MonthPL {
  sales: number; cogs: number; sgna: number; fixed: number;
  grossProfit: number; operatingProfit: number;
  otherIncome: number; otherExpense: number; netIncome: number;
}

/**
 * 특정 월(YYYY-MM)의 손익. cogs = 당기 매입액(재고 미반영 — 재고 조정은 기간 summary에서).
 * 전표 항목의 계정그룹 plLine으로 매출/매출원가/판관비/영업외를 분류, 계정 없으면 전표 type로 폴백.
 */
export function computeMonthPL(
  ym: string,
  issuedStatements: IssuedStatement[],
  fixedCosts: FixedCostEntry[],
  codeToGroup: (code: string | undefined) => AccountGroup | undefined,
): MonthPL {
  let sales = 0, cogs = 0, sgna = 0, otherIncome = 0, otherExpense = 0;
  issuedStatements
    .filter(s => s.tradeDate.startsWith(ym))
    .forEach(s => {
      s.items.forEach(item => {
        const group = codeToGroup(item.accountCode);
        const pl = group?.plLine;
        if (pl === 'revenue') sales += item.total;
        else if (pl === 'cogs') cogs += item.total;
        else if (pl === 'sgna') sgna += item.total;
        else if (pl === 'other-income') otherIncome += item.total;
        else if (pl === 'other-expense') otherExpense += item.total;
        else if (!pl && group?.type === '수익') sales += item.total;
        else if (!pl && group?.type === '비용') cogs += item.total;
        else if (!group) {
          if (s.type === '매출') sales += item.total;
          else if (s.type === '비용') sgna += item.total;
          else if (s.type === '매입') cogs += item.total;
        }
      });
    });
  // 정기비용은 '비용' 전표로 끊겨 sgna에 잡히므로 fixedCosts만 별도 합산(이중계상 방지)
  const fixed = fixedCosts.filter(c => c.yearMonth === ym).reduce((a, c) => a + c.amount, 0);
  const grossProfit = sales - cogs;
  const operatingProfit = grossProfit - sgna - fixed;
  const netIncome = operatingProfit + otherIncome - otherExpense;
  return { sales, cogs, sgna, fixed, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome };
}
