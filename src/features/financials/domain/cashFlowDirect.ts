import type { AccountCode, AccountGroup, JournalEntry, AccountGroupCfSection } from '../../../shared/types';
import { AR, AP, OTHER_PAYABLE, VAT_PAYABLE, VAT_RECEIVABLE, INVENTORY } from '../../../shared/autoJournal';
import { STANDARD_ACCOUNT } from '../../../shared/accountChart';



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
  STANDARD_ACCOUNT.WITHHOLDING, // 예수금(원천세)
  VAT_PAYABLE,    // 부가세예수금
  VAT_RECEIVABLE, // 부가세대급금
  STANDARD_ACCOUNT.ACCRUED_EXPENSE, // 미지급비용·급여 — 급여 지급은 영업활동이다
  '261', // 미지급세금 — 부가세·소득세 납부
  STANDARD_ACCOUNT.ADVANCE_RECEIVED, // 선수금 — 고객에게 미리 받은 돈
  '295', // 퇴직급여충당부채
  STANDARD_ACCOUNT.PREPAID, // 선급금
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
