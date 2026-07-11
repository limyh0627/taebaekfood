import { IssuedStatement, FixedCostEntry, AccountCode, AccountGroup, CashFlowManual, InventorySnapshot } from '../../shared/types';

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

/** YYYY-MM에 d개월 더한/뺀 YYYY-MM */
export function addMonthStr(ym: string, d: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export interface CashFlowMonth {
  netAdj: number; dep: number; invInc: number; arInc: number; apChg: number; prepaid: number; op: number;
  assetBuy: number; assetSell: number; inv: number; finIn: number; debtRepay: number; fin: number; net: number;
}

/**
 * 특정 월의 간접법 현금흐름 라인. 순수 함수 — manual(그 달 수동입력, 편집중이면 draft 병합본)은 호출부가 해결해 넘김.
 * 영업 = 순이익(재고반영) + 감가상각 − 재고증가 − 매출채권증가 + 매입채무증감 − 선급금증가.
 * 투자 = 자산매각 − 자산취득. 재무 = 자본조달 − 부채상환.
 */
export function computeCashFlowMonth(
  ym: string,
  manual: Partial<CashFlowManual>,
  deps: { issuedStatements: IssuedStatement[]; inventorySnapshots: InventorySnapshot[]; monthPL: (ym: string) => MonthPL },
): CashFlowMonth {
  const { issuedStatements, inventorySnapshots, monthPL } = deps;
  const snapVal = (m: string) => inventorySnapshots.find(s => s.yearMonth === m)?.value;
  const payIn = (m: string, type: '매출' | '매입') => issuedStatements.filter(s => s.type === type).flatMap(s => s.payments ?? []).filter(p => (p.date || '').startsWith(m)).reduce((a, p) => a + p.amount, 0);
  const accrual = (m: string, type: '매출' | '매입') => issuedStatements.filter(s => s.type === type && s.tradeDate.startsWith(m)).reduce((a, s) => a + s.totalAmount, 0);
  const pl = monthPL(ym);
  const sa = snapVal(ym), sp = snapVal(addMonthStr(ym, -1));
  const invInc = (sa != null && sp != null) ? sa - sp : 0;      // 재고자산 증가
  const netAdj = pl.netIncome + invInc;                          // 재고 반영 순이익
  const arInc = accrual(ym, '매출') - payIn(ym, '매출');          // 매출채권 증가
  const apChg = accrual(ym, '매입') - payIn(ym, '매입');          // 매입채무 증감(+증가)
  const dep = manual.depreciation || 0, prepaid = manual.prepaidInc || 0;
  const op = netAdj + dep - invInc - arInc + apChg - prepaid;
  const assetBuy = manual.assetBuy || 0, assetSell = manual.assetSell || 0, inv = assetSell - assetBuy;
  const finIn = manual.financeIn || 0, debtRepay = manual.debtRepay || 0, fin = finIn - debtRepay;
  return { netAdj, dep, invInc, arInc, apChg, prepaid, op, assetBuy, assetSell, inv, finIn, debtRepay, fin, net: op + inv + fin };
}
