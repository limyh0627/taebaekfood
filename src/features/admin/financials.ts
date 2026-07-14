import {
  IssuedStatement, FixedCostEntry, AccountCode, AccountGroup, AccountGroupCfSection,
  CashFlowManual, InventorySnapshot, CashEntry, Settlement,
} from '../../shared/types';

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

/**
 * 전표 문맥에 맞는 계정과목만 추린다 — 매출전표에 '단기차입금'이 뜨는 걸 막는다.
 * 계정과목 마스터는 하나로 두되, 고르는 자리에서 성격으로 거른다.
 *
 *  매출: 수익
 *  매입: 비용·자산
 *  자금: 전부 (돈이 나가는 이유는 비용·자산·부채 뭐든 될 수 있다)
 *  대체: 비현금 계정만 (감가상각·퇴직충당금) — 현금도 거래처도 없는 분개라 오용을 원천 차단한다
 *
 * 그룹이 없는 계정은 감추지 않고 통과시킨다 — 숨겨버리면 기존 전표를 고칠 수도 없다.
 */
export function filterCodesForContext(
  codes: AccountCode[],
  groups: AccountGroup[],
  context: '매출' | '매입' | '자금' | '대체',
): AccountCode[] {
  if (context === '자금') return codes;
  if (context === '대체') return codes.filter(c => isNoncashCode(c.code, codes));
  const allow: AccountGroup['type'][] = context === '매출' ? ['수익'] : ['비용', '자산'];
  const groupType = new Map(groups.map(g => [g.id, g.type]));
  return codes.filter(c => {
    if (!c.groupId) return true;                 // 그룹 미지정 — 거르지 않고 노출
    const t = groupType.get(c.groupId);
    return !t || allow.includes(t);
  });
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
 * 계정그룹의 현금흐름표 위치. cfSection이 지정돼 있으면 그걸 쓴다.
 *
 * 미지정이면 계정 성격으로 추측하는데(자산→투자, 부채·자본→재무) 이건 정확하지 않다 —
 * 매입채무는 부채지만 영업이고, 선급금은 자산이지만 영업이다. 영업성 자산·부채는
 * AccountGroup.cfSection에 'operating'을 박아서 이 추측에서 빼내야 한다.
 */
/**
 * 비현금 비용인가 — 손익엔 잡히지만 현금이 안 나가는 것(감가상각비, 퇴직급여충당금).
 * 현금흐름표에서 순이익에 다시 가산해야 한다.
 * 계정에 noncash 플래그가 있으면 그걸 쓰고, 없으면 계정명으로 폴백(구 데이터).
 */
export function isNoncashCode(code: string | undefined, accountCodes: AccountCode[] = []): boolean {
  if (!code) return false;
  const ac = accountCodes.find(a => a.code === code);
  if (ac?.noncash != null) return ac.noncash;
  return /감가상각|퇴직급여|퇴직충당|충당금/.test(ac?.name ?? '');
}

export function cfSectionOf(g?: AccountGroup): AccountGroupCfSection | undefined {
  if (!g) return undefined;
  if (g.cfSection) return g.cfSection;
  if (g.type === '자산') return 'investing';
  if (g.type === '부채' || g.type === '자본') return 'financing';
  return 'operating';
}

/**
 * 특정 월의 간접법 현금흐름 라인. 순수 함수.
 *
 * 결제액은 구 payments[]와 신 settlements를 합쳐서 본다 — 두 경로 중 어디에 기록됐든
 * 매출채권·매입채무가 맞게 떨어진다.
 *
 * 투자·재무는 자금원장(cashEntries)의 계정과목 cfSection에서 집계한다. 부호는 dir(입금 +/출금 −).
 * 구 '비용' 전표(cashDir)도 자금원장 이관 전까지 같은 규칙으로 함께 본다.
 * 감가상각은 현금이 안 움직이므로 자금원장에 없다 — 전표(계정명에 '감가상각')와 manual에서만 온다.
 *
 * 영업 = 순이익(재고반영) + 감가상각 − 재고증가 − 매출채권증가 + 매입채무증감 − 선급금증가.
 */
export function computeCashFlowMonth(
  ym: string,
  manual: Partial<CashFlowManual>,
  deps: {
    issuedStatements: IssuedStatement[];
    inventorySnapshots: InventorySnapshot[];
    monthPL: (ym: string) => MonthPL;
    codeToGroup?: (code: string | undefined) => AccountGroup | undefined;
    accountCodes?: AccountCode[];
    cashEntries?: CashEntry[];
    settlements?: Settlement[];
    fixedCosts?: FixedCostEntry[];
  },
): CashFlowMonth {
  const { issuedStatements, inventorySnapshots, monthPL, codeToGroup, accountCodes } = deps;
  const cashEntries = deps.cashEntries ?? [];
  const settlements = deps.settlements ?? [];
  const fixedCosts = deps.fixedCosts ?? [];

  const snapVal = (m: string) => inventorySnapshots.find(s => s.yearMonth === m)?.value;

  /**
   * 영업성 거래인가 — 매출채권·매입채무에 넣을 것인가.
   * 기계 구입처럼 자산 계정만 달린 매입전표는 영업이 아니라 투자다. 여기에 넣으면
   * 미지급금이 영업활동에 잡히고 자금원장에서 투자활동에도 잡혀 이중계상된다.
   * 실제 지급액은 자금원장이 투자활동으로 처리한다.
   */
  const isOperating = (s: IssuedStatement): boolean => {
    if (!codeToGroup) return true;
    const types = (s.items ?? []).map(i => codeToGroup(i.accountCode)?.type).filter(Boolean);
    if (types.length === 0) return true;                       // 계정 없음 → 영업으로 본다
    return types.some(t => t === '비용' || t === '수익');        // 손익 계정이 하나라도 있으면 영업
  };
  const operating = issuedStatements.filter(isOperating);
  const opIds = new Set(operating.map(s => s.id));

  const accrual = (m: string, type: '매출' | '매입') =>
    operating.filter(s => s.type === type && s.tradeDate.startsWith(m)).reduce((a, s) => a + s.totalAmount, 0);

  // 결제 = 전표에 매달린 구 payments[] + 자금원장 매칭(settlements). 둘을 합쳐 하나의 결제 소스로 본다.
  const stmtType = new Map(issuedStatements.map(s => [s.id, s.type]));
  const entryDate = new Map(cashEntries.map(e => [e.id, e.date]));
  const payIn = (m: string, type: '매출' | '매입') => {
    const legacy = operating
      .filter(s => s.type === type)
      .flatMap(s => s.payments ?? [])
      .filter(p => (p.date || '').startsWith(m))
      .reduce((a, p) => a + p.amount, 0);
    const matched = settlements
      .filter(st => opIds.has(st.statementId)
        && stmtType.get(st.statementId) === type
        && (entryDate.get(st.cashEntryId) || '').startsWith(m))
      .reduce((a, st) => a + st.amount, 0);
    return legacy + matched;
  };

  const pl = monthPL(ym);
  const sa = snapVal(ym), sp = snapVal(addMonthStr(ym, -1));
  const invInc = (sa != null && sp != null) ? sa - sp : 0;      // 재고자산 증가
  const netAdj = pl.netIncome + invInc;                          // 재고 반영 순이익
  const arInc = accrual(ym, '매출') - payIn(ym, '매출');          // 매출채권 증가
  const apChg = accrual(ym, '매입') - payIn(ym, '매입');          // 매입채무 증감(+증가)

  let assetOut = 0, assetIn = 0, finInStmt = 0, finOutStmt = 0, depStmt = 0;

  // 자금원장 — 실제로 돈이 움직인 기록에서 투자·재무를 집계
  if (codeToGroup) {
    for (const e of cashEntries) {
      if (!(e.date || '').startsWith(ym)) continue;
      const section = cfSectionOf(codeToGroup(e.accountCode));
      const inflow = e.dir === '입금';
      if (section === 'investing') { if (inflow) assetIn += e.amount; else assetOut += e.amount; }
      else if (section === 'financing') { if (inflow) finInStmt += e.amount; else finOutStmt += e.amount; }
    }
  }

  // '비용' 전표 — 정기비용 자동 생성분(대체전표 성격: 감가상각·퇴직충당금)과
  // 아직 자금원장으로 안 옮긴 구 수동 비용/자금 전표가 섞여 있다.
  // 비현금 계정은 순이익에 가산하고, 자산·부채 계정은 투자·재무로 보낸다.
  if (codeToGroup) {
    for (const s of issuedStatements) {
      if (s.type !== '비용' || !(s.tradeDate || '').startsWith(ym)) continue;
      const inflow = s.cashDir === '입금';
      for (const it of s.items) {
        if (isNoncashCode(it.accountCode, accountCodes)) { depStmt += it.total; continue; }
        const section = cfSectionOf(codeToGroup(it.accountCode));
        if (section === 'investing') { if (inflow) assetIn += it.total; else assetOut += it.total; }
        else if (section === 'financing') { if (inflow) finInStmt += it.total; else finOutStmt += it.total; }
      }
    }
  }

  // 수동 입력한 정기비용(fixedCosts) 중 비현금 계정도 가산 — 손익에서만 빠지고 현금은 안 나갔다.
  const fixedNoncash = fixedCosts
    .filter(c => c.yearMonth === ym && isNoncashCode(c.accountCode, accountCodes))
    .reduce((a, c) => a + c.amount, 0);

  const dep = depStmt + fixedNoncash + (manual.depreciation || 0);
  const prepaid = manual.prepaidInc || 0;
  const op = netAdj + dep - invInc - arInc + apChg - prepaid;
  const assetBuy = assetOut + (manual.assetBuy || 0);
  const assetSell = assetIn + (manual.assetSell || 0);
  const finIn = finInStmt + (manual.financeIn || 0);
  const debtRepay = finOutStmt + (manual.debtRepay || 0);
  const inv = assetSell - assetBuy;
  const fin = finIn - debtRepay;
  return { netAdj, dep, invInc, arInc, apChg, prepaid, op, assetBuy, assetSell, inv, finIn, debtRepay, fin, net: op + inv + fin };
}
