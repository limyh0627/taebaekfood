import {
  AccountCode, AccountGroup, AccountGroupCfSection, JournalEntry,
} from '../../shared/types';
import { AR, AP, OTHER_PAYABLE, VAT_PAYABLE, VAT_RECEIVABLE, INVENTORY, BANK } from '../../shared/autoJournal';

/**
 * 손익 계산 순수 도메인 모듈 — 부수효과 없음(입력 → 값). 단위 테스트 용이.
 */

// 계산결과 그룹(집계용) / 구 판매비·관리비 그룹 id
export const COMPUTED_GROUP_IDS = new Set(['ag-gross-profit', 'ag-op-profit']);
export const SGNA_LEGACY_IDS = new Set(['ag-selling', 'ag-admin']);

/**
 * 계정코드(code) → AccountGroup 조회기.
 *
 * **그룹은 있는 그대로 돌려준다.** 예전엔 표시용으로 id를 'ag-sgna'로 갈아끼워 내보냈는데,
 * 설정 화면이 그 id를 그대로 저장하면서 없는 그룹을 가리키는 계정이 생겼다(운임·카드대금).
 * 그런 계정은 plLine을 못 찾아 손익 집계에서 통째로 빠진다.
 */
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
    // 옛 '판매비'/'관리비'로 갈려 있던 것은 판관비 하나로 본다 — id는 안 바꾼다.
    if (SGNA_LEGACY_IDS.has(ac.groupId)) return groupMap.get(ac.groupId) ?? sgnaGroup;
    return groupMap.get(ac.groupId);
  };
}

/**
 * 현금성 계정인가 — 통장·현금. **대체전표에서 막아야 할 유일한 것**이다.
 * 돈이 실제로 오갔으면 자금원장으로 가야 통장 잔액이 맞는다.
 */
export function isCashAccountCode(code: string | undefined, accountCodes: AccountCode[] = []): boolean {
  if (!code) return false;
  if (code === '101' || code === BANK) return true;
  return /현금|보통예금|당좌예금|제예금/.test(accountCodes.find(a => a.code === code)?.name ?? '');
}

/**
 * 전표 문맥에 맞는 계정과목만 추린다 — 매출전표에 '단기차입금'이 뜨는 걸 막는다.
 * 계정과목 마스터는 하나로 두되, 고르는 자리에서 성격으로 거른다.
 *
 *  매출: 수익
 *  매입: 비용 — 손익 나는 것만. 기계·차량 같은 자산 취득은 손익이 아니라 투자이므로
 *        자금원장에서 끊는다(손익에 닿는 건 그 자산의 감가상각뿐이다).
 *  자금: 전부 (돈이 나가는 이유는 비용·자산·부채 뭐든 될 수 있다)
 *  대체: **통장·현금만 뺀다.**
 *
 * 전에는 대체를 `noncash` 계정(감가상각·퇴직충당)만으로 좁혔다. 49개 중 4개만 남아
 * **급여도 이자도 못 골랐다** — 거래처 없이 발생만 세우는 전표가 원래 그 둘인데.
 *   (차) 515 급여   / (대) 254 예수금
 *   (차) 951 이자비용 / (대) 262 미지급비용
 * 대체는 '차·대를 직접 세우는' 전표라 상대변 계정(부채·자산)도 필요하다. 막아야 할 건
 * 하나뿐이다 — **현금이 오간 것을 대체로 적는 것.** 그건 통장 잔액과 어긋나므로 자금원장으로 간다.
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
  if (context === '대체') return byCode(codes.filter(c => !isCashAccountCode(c.code, codes)));
  const allow: AccountGroup['type'][] = context === '매출' ? ['수익'] : ['비용'];
  const groupType = new Map(groups.map(g => [g.id, g.type]));
  return byCode(codes.filter(c => {
    if (!c.groupId) return true;                 // 그룹 미지정 — 거르지 않고 노출
    const t = groupType.get(c.groupId);
    return !t || allow.includes(t);
  }));
}

export interface MonthPL {
  sales: number; cogs: number; sgna: number;
  grossProfit: number; operatingProfit: number;
  otherIncome: number; otherExpense: number; netIncome: number;
}

/**
 * 손익은 **전표(분개)와 그 계정과목으로만** 집계한다.
 *
 * 예전엔 computeMonthPL이 따로 있어서 두 가지 다른 길로 숫자를 만들었다:
 *   · 계정과목이 없으면 전표 유형(매출/매입/비용)으로 때려맞췄다
 *   · fixedCosts(정기비용) 컬렉션을 판관비에 그냥 더했다 — 전표가 아닌데 손익에 잡혔다
 * 둘 다 지웠다. 집계 근거가 둘이면 어느 쪽이 맞는지 알 수 없고, 계정과목을 안 거친
 * 금액은 계정별로 쪼개 볼 수도, 분개와 대조할 수도 없다.
 *
 * 계정에 그룹(plLine)이나 5분류(type)가 없으면 손익에서 조용히 빠진다 —
 * 계정과목을 만들 때 반드시 채울 것.
 */

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
/**
 * **분개 한 줄이 손익을 얼마나 움직였나** — 손익을 세는 자리는 전부 이걸 쓴다.
 *
 * 규칙은 둘뿐이다.
 *   ① 수익·비용 계정만 본다(자산·부채·자본은 손익이 아니다)
 *   ② 그 계정의 정상 방향(normalBalance)으로 부호를 잡는다 — 비용은 차변, 수익은 대변
 *
 * **전표 갈래(type)로 세면 안 된다.** 급여 발생·감가상각·퇴직급여충당은 갈래가 '비용'
 * (대체전표)이라 `type === '매입'` 으로 세면 통째로 빠진다 —
 * 실제로 2026-08 급여 19,314,620원이 전표 화면 하단 합계에서 사라져 있었다(2026-09-03 사장님 발견).
 * **전표 총액으로 세도 안 된다.** 부가세가 섞인다(1,070,000 매출의 손익은 1,000,000이다).
 */
export function plMovement(acc: AccountCode | undefined, debit: number, credit: number): number {
  if (acc?.type !== '수익' && acc?.type !== '비용') return 0;
  const normal = acc.normalBalance ?? (acc.type === '수익' ? 'credit' : 'debit');
  return normal === 'debit' ? debit - credit : credit - debit;
}

/**
 * 분개 뭉치의 수익·비용 합 — 기간이든 필터든 **부르는 쪽이 이미 고른 것**만 넘긴다.
 * 월별 손익표(`computeMonthPLFromJournals`)와 같은 규칙(`plMovement`)이라 안 갈린다.
 */
export function plOfJournals(
  entries: JournalEntry[],
  accountCodes: AccountCode[],
): { income: number; cost: number } {
  const byCode = new Map(accountCodes.map(a => [String(a.code), a]));
  let income = 0, cost = 0;
  for (const e of entries) {
    for (const l of e.lines ?? []) {
      const acc = byCode.get(String(l.accountCode));
      const moved = plMovement(acc, l.debit ?? 0, l.credit ?? 0);
      if (!moved) continue;
      if (acc!.type === '수익') income += moved; else cost += moved;
    }
  }
  return { income, cost };
}

export function computeMonthPLFromJournals(
  ym: string,
  entries: JournalEntry[],
  accountCodes: AccountCode[],
  codeToGroup: (code: string | undefined) => AccountGroup | undefined,
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
    //  손익 판정은 plMovement 하나다 — 두 벌로 두면 언젠가 갈린다
    const bal = plMovement(acc, t.debit, t.credit);
    if (!bal) continue;
    if (!bal) continue;
    switch (codeToGroup(code)?.plLine) {
      case 'revenue':       sales += bal; break;
      case 'cogs':          cogs += bal; break;
      case 'sgna':          sgna += bal; break;
      case 'other-income':  otherIncome += bal; break;
      case 'other-expense': otherExpense += bal; break;
      default:              if (acc?.type === '수익') sales += bal; else cogs += bal;
    }
  }
  const grossProfit = sales - cogs;
  const operatingProfit = grossProfit - sgna;
  const netIncome = operatingProfit + otherIncome - otherExpense;
  return { sales, cogs, sgna, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome };
}

// ── 직접법 현금흐름 ──────────────────────────────────────────────────────────

/**
 * 영업성 상대계정 — 현금이 이 계정과 오갔으면 영업활동이다.
 * cfSectionOf는 그룹 성격만 보고 자산=투자·부채=재무로 찍기 때문에, 외상매출금·부가세처럼
 * '자산/부채인데 영업'인 것들을 여기서 먼저 건져낸다. 차입금(260·293)과 유형자산은 일부러 뺀다.
 */
const OPERATING_CODES = new Set([
  AR,    // 외상매출금
  AP,    // 외상매입금
  OTHER_PAYABLE, // 미지급금
  '254', // 예수금(원천세)
  VAT_PAYABLE,    // 부가세예수금
  VAT_RECEIVABLE, // 부가세대급금
  '262', // 미지급비용
  '263', // 미지급급여 — 급여 지급은 영업이다. 부채라고 재무로 찍히면 급여가 재무활동에 선다
  '261', // 미지급세금 — 부가세·소득세 납부
  '259', // 선수금 — 고객에게 미리 받은 돈
  '295', // 퇴직급여충당부채
  '131', // 선급금
  INVENTORY, // 재고자산
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

/**
 * 계정그룹의 현금흐름표 위치. cfSection이 지정돼 있으면 그걸 쓴다.
 *
 * 미지정이면 계정 성격으로 추측하는데(자산→투자, 부채·자본→재무) 이건 정확하지 않다 —
 * 매입채무는 부채지만 영업이고, 선급금은 자산이지만 영업이다. 영업성 자산·부채는
 * AccountGroup.cfSection에 'operating'을 박아서 이 추측에서 빼내야 한다.
 */
export function cfSectionOf(g?: AccountGroup): AccountGroupCfSection | undefined {
  if (!g) return undefined;
  if (g.cfSection) return g.cfSection;
  if (g.type === '자산') return 'investing';
  if (g.type === '부채' || g.type === '자본') return 'financing';
  return 'operating';
}

