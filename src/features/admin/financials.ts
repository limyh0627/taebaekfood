import {
  IssuedStatement, FixedCostEntry, AccountCode, AccountGroup, AccountGroupCfSection,
  CashFlowManual, InventorySnapshot, CashEntry, Settlement, JournalEntry,
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
 *  매입: 비용 — 손익 나는 것만. 기계·차량 같은 자산 취득은 손익이 아니라 투자이므로
 *        자금원장에서 끊는다(손익에 닿는 건 그 자산의 감가상각뿐이다).
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
  // 계정번호(code) 오름차순 정렬 — 전표 발행 등 드롭다운에서 계정번호대로 보이게
  const byCode = (list: AccountCode[]) => [...list].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  if (context === '자금') return byCode(codes);
  if (context === '대체') return byCode(codes.filter(c => isNoncashCode(c.code, codes)));
  const allow: AccountGroup['type'][] = context === '매출' ? ['수익'] : ['비용'];
  const groupType = new Map(groups.map(g => [g.id, g.type]));
  return byCode(codes.filter(c => {
    if (!c.groupId) return true;                 // 그룹 미지정 — 거르지 않고 노출
    const t = groupType.get(c.groupId);
    return !t || allow.includes(t);
  }));
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

/**
 * 분개 기반 월별 손익 — 전표·자금원장이 모두 분개를 거쳐 들어오므로 원천이 어디든 한 번만 잡힌다.
 *
 * `computeMonthPL`(전표 직접 집계)과 두 가지가 다르다:
 *  - **부가세가 손익에서 빠진다.** 분개는 공급가만 수익·비용으로 세우고 부가세는
 *    예수금(부채)·대급금(자산)으로 보낸다. 전표 집계는 부가세 포함 `item.total`을 더했다.
 *  - **자금원장에만 있는 손익도 잡힌다.** 이자비용처럼 전표 없이 자금으로만 나간 것.
 *
 * 계정에 `type`이 없으면 손익에서 조용히 빠진다 — 계정과목 등록 시 5분류를 반드시 채울 것.
 */
export function computeMonthPLFromJournals(
  ym: string,
  entries: JournalEntry[],
  accountCodes: AccountCode[],
  codeToGroup: (code: string | undefined) => AccountGroup | undefined,
  fixedCosts: FixedCostEntry[],
): MonthPL {
  const byCode = new Map(accountCodes.map(a => [String(a.code), a]));
  const tally = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    if (!(e.date ?? '').startsWith(ym)) continue;
    for (const l of e.lines ?? []) {
      const cur = tally.get(l.accountCode) ?? { debit: 0, credit: 0 };
      cur.debit += l.debit ?? 0;
      cur.credit += l.credit ?? 0;
      tally.set(l.accountCode, cur);
    }
  }
  let sales = 0, cogs = 0, sgna = 0, otherIncome = 0, otherExpense = 0;
  for (const [code, t] of tally) {
    const acc = byCode.get(code);
    if (acc?.type !== '수익' && acc?.type !== '비용') continue;
    const normal = acc.normalBalance ?? (acc.type === '수익' ? 'credit' : 'debit');
    const bal = normal === 'debit' ? t.debit - t.credit : t.credit - t.debit;
    if (!bal) continue;
    switch (codeToGroup(code)?.plLine) {
      case 'revenue':       sales += bal; break;
      case 'cogs':          cogs += bal; break;
      case 'sgna':          sgna += bal; break;
      case 'other-income':  otherIncome += bal; break;
      case 'other-expense': otherExpense += bal; break;
      default:              if (acc.type === '수익') sales += bal; else cogs += bal;
    }
  }
  const fixed = fixedCosts.filter(c => c.yearMonth === ym).reduce((a, c) => a + c.amount, 0);
  const grossProfit = sales - cogs;
  const operatingProfit = grossProfit - sgna - fixed;
  const netIncome = operatingProfit + otherIncome - otherExpense;
  return { sales, cogs, sgna, fixed, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome };
}

// ── 직접법 현금흐름 ──────────────────────────────────────────────────────────

/**
 * 영업성 상대계정 — 현금이 이 계정과 오갔으면 영업활동이다.
 * cfSectionOf는 그룹 성격만 보고 자산=투자·부채=재무로 찍기 때문에, 외상매출금·부가세처럼
 * '자산/부채인데 영업'인 것들을 여기서 먼저 건져낸다. 차입금(260·293)과 유형자산은 일부러 뺀다.
 */
const OPERATING_CODES = new Set([
  '108', // 외상매출금
  '251', // 외상매입금
  '253', // 미지급금
  '254', // 예수금(원천세)
  '255', // 부가세예수금
  '135', // 부가세대급금
  '262', // 미지급비용
  '131', // 선급금
  '146', // 재고자산
]);

export interface CashFlowDirectLine {
  accountCode: string;
  section: AccountGroupCfSection;
  inflow: number;
  outflow: number;
}
export interface CashFlowDirect {
  op: number; inv: number; fin: number; net: number;
  opIn: number; opOut: number;
  invIn: number; invOut: number;
  finIn: number; finOut: number;
  lines: CashFlowDirectLine[];   // 상대계정별 — 금액 큰 순
}

/**
 * 직접법 현금흐름 — 분개에서 **현금계정이 움직인 것만** 뽑아 상대계정별로 모은다.
 *
 * 간접법(순이익에서 출발해 채권·채무 증감을 추정)과 달리 추정이 없다. 현금이 안 움직인
 * 거래(대체전표·외상매입)는 아예 안 들어오고, 통장 증감과 원 단위로 맞는다.
 *
 * 규칙: 한 분개에서 현금계정 순증감이 0이면(계좌 간 이체) 건너뛴다. 그 외에는 현금이 아닌
 * 줄마다 (차변−대변)을 본다 — 양수면 그쪽으로 현금이 나간 것, 음수면 그쪽에서 들어온 것.
 * 그래서 대출상환처럼 한 분개에 원금(재무)과 이자(영업)가 섞여 있어도 정확히 갈린다.
 */
export function computeCashFlowDirect(
  ym: string,
  entries: JournalEntry[],
  accountCodes: AccountCode[],
  codeToGroup: (code: string | undefined) => AccountGroup | undefined,
): CashFlowDirect {
  const isCash = new Set(accountCodes.filter(a => a.isCash).map(a => String(a.code)));
  const agg = new Map<string, CashFlowDirectLine>();
  const out: CashFlowDirect = {
    op: 0, inv: 0, fin: 0, net: 0,
    opIn: 0, opOut: 0, invIn: 0, invOut: 0, finIn: 0, finOut: 0, lines: [],
  };

  for (const e of entries) {
    if (!(e.date ?? '').startsWith(ym)) continue;
    const lines = e.lines ?? [];
    let cashDelta = 0;
    for (const l of lines) if (isCash.has(String(l.accountCode))) cashDelta += (l.debit ?? 0) - (l.credit ?? 0);
    if (Math.abs(cashDelta) < 0.005) continue;         // 현금 안 움직임(대체) 또는 계좌 간 이체

    for (const l of lines) {
      const code = String(l.accountCode);
      if (isCash.has(code)) continue;
      const signed = (l.debit ?? 0) - (l.credit ?? 0);  // + → 현금 유출, − → 현금 유입
      if (!signed) continue;
      const section: AccountGroupCfSection = OPERATING_CODES.has(code)
        ? 'operating'
        : (cfSectionOf(codeToGroup(code)) ?? 'operating');
      const cur = agg.get(code) ?? { accountCode: code, section, inflow: 0, outflow: 0 };
      if (signed > 0) cur.outflow += signed; else cur.inflow += -signed;
      agg.set(code, cur);
    }
  }

  for (const l of agg.values()) {
    if (l.section === 'investing') { out.invIn += l.inflow; out.invOut += l.outflow; }
    else if (l.section === 'financing') { out.finIn += l.inflow; out.finOut += l.outflow; }
    else { out.opIn += l.inflow; out.opOut += l.outflow; }
  }
  out.op = out.opIn - out.opOut;
  out.inv = out.invIn - out.invOut;
  out.fin = out.finIn - out.finOut;
  out.net = out.op + out.inv + out.fin;
  out.lines = [...agg.values()].sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
  return out;
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

/**
 * 영업성 상대계정인가 — 매출채권·매입채무 상계, 그리고 현금계정 간 이동.
 * 이런 자금 기록은 투자·재무가 아니라 영업이며, 영업 라인(arInc·apChg)이 이미 반영한다.
 * 그룹 cfSection이 비어 있으면 자산=투자·부채=재무로 추측되기 때문에 명시적으로 걸러야 한다.
 */
export function isOperatingCounterCode(code: string | undefined, accountCodes: AccountCode[] = []): boolean {
  if (!code) return false;
  if (code === '108' || code === '251') return true;          // 외상매출금 / 외상매입금
  return accountCodes.find(a => a.code === code)?.isCash === true;  // 계좌 간 이동
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
 * 결제액은 자금원장 매칭(settlements)에서만 본다 — 수금·지불이 거기 한 곳에만 적히기 때문이다.
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

  // 결제 = 자금원장 매칭(settlements). 전표에 매다는 옛 경로는 없앴다.
  const stmtType = new Map(issuedStatements.map(s => [s.id, s.type]));
  const entryDate = new Map(cashEntries.map(e => [e.id, e.date]));
  const payIn = (m: string, type: '매출' | '매입') =>
    settlements
      .filter(st => opIds.has(st.statementId)
        && stmtType.get(st.statementId) === type
        && (entryDate.get(st.cashEntryId) || '').startsWith(m))
      .reduce((a, st) => a + st.amount, 0);

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
      const inflow = e.dir === '입금';
      // 쪼갠 줄이 있으면 줄마다 성격이 다르다 — 대출상환은 원금=재무활동, 이자=영업활동.
      const parts = (e.lines ?? []).filter(l => l.accountCode && l.amount > 0).length
        ? e.lines!.filter(l => l.accountCode && l.amount > 0).map(l => ({ code: l.accountCode, amount: l.amount }))
        : [{ code: e.accountCode, amount: e.amount }];
      for (const p of parts) {
        // 채권·채무 상계(수금/지불)는 영업활동이다 — 위 arInc/apChg가 이미 반영했다.
        // 그룹에 cfSection이 없으면 자산=투자, 부채=재무로 추측되므로 여기서 먼저 걷어낸다.
        if (isOperatingCounterCode(p.code, accountCodes)) continue;
        const section = cfSectionOf(codeToGroup(p.code));
        if (section === 'investing') { if (inflow) assetIn += p.amount; else assetOut += p.amount; }
        else if (section === 'financing') { if (inflow) finInStmt += p.amount; else finOutStmt += p.amount; }
      }
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
