import type { JournalEntry, CompanyId, IssuedStatement, CashEntry, Settlement } from '../../shared/types';
import { allPartnerBalances, allocatePartnerCash, isReceivableStmt } from './cashLedger';
import { addDays } from '../../shared/day';

/**
 * **거래처 잔액 앵커 — 연말 상태를 박아 두고 그 이전은 안 읽는다.**
 *
 * 잔액을 세는 길은 둘뿐이다.
 *   ① 첫 거래부터 전부 읽는다        — 해가 쌓이면 읽는 양이 계속 는다
 *   ② 앵커를 박고 그 이후만 읽는다   — 앵커가 그 이전을 요약한다
 *
 * 재고가 이미 ②다(`inventorySnapshots` 월별). 원료 원장도 ②다(`targetKg` 실사 앵커).
 * 거래처만 앵커가 결산 한 번(기초 전표)이라 주기가 길었다. **해마다 박는다.**
 *
 * ---
 * **앵커에 잔액만 담으면 앵커가 아니다.**
 *
 * 이 화면은 거래처 잔액만 쓰는 게 아니라 **전표 한 장씩 얼마 남았나**도 쓴다
 * (수금·지불 버튼이 거기 달린다). 잔액만 요약해 두고 옛 전표를 안 읽으면,
 * 그 거래처 수금이 창 안 전표를 갉아먹어 **안 갚은 전표가 완납으로 보인다.**
 * 그래서 앵커는 **그날 아직 안 끝난 전표와 그 남은 금액**까지 같이 담는다.
 * 연말에 살아 있는 미결 전표는 몇 장뿐이라, 그것만 id로 집어 오면 된다.
 *
 * ---
 * **만드는 길은 하나다 — 그날까지 전부 읽어서 처음부터 센다.**
 *
 * "직전 앵커 + 그 해치"로 이어 붙이는 길을 따로 두면 두 셈이 언젠가 어긋나고,
 * 어긋난 쪽이 앵커라 아무도 모른다. 앵커를 박는 건 **일 년에 한 번**이라
 * 그때 전부 읽어도 싸다. 비싼 건 화면 열 때마다 읽는 쪽이고, 그건 앵커가 막는다.
 *
 * **소급 전표가 들어오면 앵커가 낡는다.** 그때는 그 거래처만 다시 센다
 * (`refreshPartner` — 같은 함수를 한 거래처로 좁혀 돌린다).
 */
export interface PartnerAnchorOpenStmt {
  id: string;
  /** 'YYYY-MM-DD' — 배분은 오래된 순이라 날짜가 있어야 이어진다 */
  date: string;
  type: '매출' | '매입';
  /** asOf 시점에 아직 안 갚은 금액 */
  remaining: number;
}

export interface PartnerAnchorRow {
  partnerId: string;
  partnerName?: string;
  /** 받을 돈 (108) */
  receivable: number;
  /** 갚을 돈 (251 + 253) */
  payable: number;
  /** 그날 아직 안 끝난 전표들 — 없으면 빈 배열 */
  openStmts: PartnerAnchorOpenStmt[];
}

export interface PartnerAnchor {
  /** `{회사}-{연도}` */
  id: string;
  companyId: CompanyId;
  /** 'YYYY' */
  year: string;
  /** 'YYYY-12-31' — 이 날까지가 앵커에 녹아 있다 */
  asOf: string;
  rows: PartnerAnchorRow[];
  recordedAt: string;
}

/** 앵커를 만들 재료 — **모두 그 회사 것으로 걸러서** 넘긴다 */
export interface AnchorInput {
  journals: JournalEntry[];
  statements?: IssuedStatement[];
  cashEntries?: CashEntry[];
  settlements?: Settlement[];
  /** 거래처 이름 — 나중에 사람이 앵커를 열어 볼 때 id만 있으면 못 읽는다 */
  nameOf?: (_partnerId: string) => string | undefined;
}

export const anchorId = (c: CompanyId, year: string): string => `${c}-${year}`;
export const asOfOf = (year: string): string => `${year}-12-31`;
const r0 = (n: number) => Math.round(n);

/**
 * 한 해 끝의 앵커를 만든다 — **그날까지 전부 읽어서 처음부터.**
 *
 * @param input `asOf` 이후 자료가 섞여 들어와도 여기서 다시 자른다.
 *   부르는 쪽이 미묘하게 틀리는 걸 앵커가 떠안으면 안 된다.
 */
export function buildPartnerAnchor(companyId: CompanyId, year: string, input: AnchorInput): PartnerAnchor {
  const asOf = asOfOf(year);
  const journals   = input.journals.filter(e => String(e.date ?? '') <= asOf);
  const statements = (input.statements ?? []).filter(s => String(s.tradeDate ?? '') <= asOf);
  const cash       = (input.cashEntries ?? []).filter(e => String(e.date ?? '') <= asOf);
  const settlements = input.settlements ?? [];

  const rows = new Map<string, PartnerAnchorRow>();
  const row = (pid: string): PartnerAnchorRow => {
    let r = rows.get(pid);
    if (!r) { r = { partnerId: pid, partnerName: input.nameOf?.(pid), receivable: 0, payable: 0, openStmts: [] }; rows.set(pid, r); }
    return r;
  };

  for (const [pid, v] of allPartnerBalances(journals)) {
    const r = row(pid);
    r.receivable = r0(v.receivable);
    r.payable = r0(v.payable);
  }

  //  아직 안 끝난 전표 — 잔액을 세는 것과 **같은 배분 함수**로 센다
  const byId = new Map(statements.map(s => [s.id, s]));
  //  **`type`으로 짝을 만들면 기초이월이 빠진다** — 기초 전표는 type이 '비용'인데 108·251을 세운다.
  //  그래서 기초만 남은 거래처가 "잔액은 있는데 미결 전표 0장"으로 박혀, 앵커를 쓰는 순간
  //  수금·지불 버튼이 사라진다. 갈래가 아니라 **분개가 채권·채무를 세우느냐**로 본다.
  const pairs = new Set<string>();
  for (const s of statements) {
    if (!s.partnerId) continue;
    for (const t of ['매출', '매입'] as const) if (isReceivableStmt(s, t)) pairs.add(`${s.partnerId}|${t}`);
  }
  for (const key of pairs) {
    const i = key.lastIndexOf('|');
    const pid = key.slice(0, i);
    const type = key.slice(i + 1) as '매출' | '매입';
    for (const [id, open] of allocatePartnerCash(pid, type, statements, cash, settlements)) {
      //  **0이 아닌 것만** — 음수도 담는다. 반품·에누리 전표는 총액이 음수라 배분이 못 건드리는데
      //  (FIFO는 갚을 게 남은 줄만 깎는다) 잔액에서는 상계된다. 안 담으면 앵커 안에서
      //  '미결 합'과 '잔액'이 그만큼 갈린다 — 실제로 (인천)청정식품 −693,000이 그랬다.
      //  앵커가 할 일은 고치는 게 아니라 그날 상태를 **그대로** 옮기는 것이다.
      if (open === 0) continue;
      const s = byId.get(id);
      row(pid).openStmts.push({ id, date: String(s?.tradeDate ?? ''), type, remaining: r0(open) });
    }
  }
  for (const r of rows.values()) r.openStmts.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  return {
    id: anchorId(companyId, year), companyId, year, asOf,
    //  아무것도 안 남은 거래처는 안 담는다 — 앵커가 해마다 커지기만 하면 앵커를 두는 뜻이 없다
    rows: [...rows.values()].filter(r => r.receivable !== 0 || r.payable !== 0 || r.openStmts.length),
    recordedAt: new Date().toISOString(),
  };
}

/**
 * **소급 전표가 들어왔을 때 — 그 거래처 줄만 다시 센다.**
 *
 * 같은 `buildPartnerAnchor`를 한 거래처 자료로 좁혀 돌린다. 셈이 하나라 어긋날 자리가 없다.
 * 부르는 쪽은 그 거래처 것만 떠오면 된다(`where partnerId == …`).
 *
 * 앵커가 여러 해면 **그 해부터 마지막 해까지 차례로** 불러야 한다 —
 * 각 해가 그날까지를 처음부터 세므로 순서가 어긋나도 값은 맞지만, 빠뜨리면 낡은 채 남는다.
 */
export function refreshPartner(anchor: PartnerAnchor, partnerId: string, input: AnchorInput): PartnerAnchor {
  const fresh = buildPartnerAnchor(anchor.companyId, anchor.year, input)
    .rows.find(r => r.partnerId === partnerId);
  const rest = anchor.rows.filter(r => r.partnerId !== partnerId);
  return { ...anchor, rows: fresh ? [...rest, fresh] : rest, recordedAt: new Date().toISOString() };
}

// ── 읽는 쪽 ──────────────────────────────────────────────────────────────────

/**
 * 이 날짜를 기준으로 **쓸 수 있는 가장 최근 앵커.**
 * `asOf`가 기준일보다 앞선 것 중 마지막. 없으면 undefined(전부 읽어야 한다).
 */
export function anchorBefore(anchors: PartnerAnchor[], onDate: string): PartnerAnchor | undefined {
  return [...anchors]
    .filter(a => a.asOf < onDate)
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .pop();
}

/** 앵커가 있으면 그 **다음 날**부터, 없으면 처음부터 읽는다 (앵커 날짜를 또 읽으면 두 번 센다) */
export function readFrom(anchor: PartnerAnchor | undefined, fallback: string): string {
  return anchor ? addDays(anchor.asOf, 1) : fallback;
}

/** 앵커에 담긴 미결 전표 id — 이것만 따로 집어 와야 배분이 이어진다 */
export function openStatementIds(anchor?: PartnerAnchor): string[] {
  return (anchor?.rows ?? []).flatMap(r => r.openStmts.map(o => o.id));
}

/** 앵커에 담긴 미결 전표의 시작 잔액 — `allocatePartnerCash`의 `opening`으로 넣는다 */
export function openingRemainders(anchor?: PartnerAnchor): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of anchor?.rows ?? []) for (const o of r.openStmts) m.set(o.id, o.remaining);
  return m;
}

/**
 * 앵커 + 그 이후 분개 = 지금 잔액.
 * 앵커가 없으면 넘어온 분개가 전부라고 보고 그것만 센다.
 *
 * **앵커 이전 분개는 여기서 잘라 낸다.** 부르는 쪽이 전부 넘겨도(앵커가 짚어 준 옛 미결
 * 전표는 배분하려고 어차피 손에 들고 있다) 앵커에 이미 녹아 있는 걸 또 더하면 두 번 센다.
 */
export function balancesWithAnchor(
  anchor: PartnerAnchor | undefined,
  entries: JournalEntry[],
): Map<string, { receivable: number; payable: number }> {
  const out = new Map<string, { receivable: number; payable: number }>();
  for (const r of anchor?.rows ?? []) out.set(r.partnerId, { receivable: r.receivable, payable: r.payable });
  const after = anchor ? entries.filter(e => String(e.date ?? '') > anchor.asOf) : entries;
  for (const [pid, v] of allPartnerBalances(after)) {
    const cur = out.get(pid) ?? { receivable: 0, payable: 0 };
    out.set(pid, { receivable: r0(cur.receivable + v.receivable), payable: r0(cur.payable + v.payable) });
  }
  return out;
}

/**
 * 이 날짜로 전표가 들어오면 **낡는 앵커들** — 앞선 해부터.
 * 부르는 쪽은 이걸 보고 `refreshPartner`를 차례로 돌린다.
 */
export function staleAnchors(anchors: PartnerAnchor[], date: string): PartnerAnchor[] {
  return anchors.filter(a => date <= a.asOf).sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * **배분에 넣을 재료를 앵커 기준으로 자른다.**
 *
 * 앵커가 걸리면 배분은 이렇게만 성립한다:
 *   전표 = 앵커가 짚어 준 미결 전표 + 앵커 뒤 전표
 *   자금 = 앵커 뒤 자금
 *   시작 잔액 = 앵커에 적힌 남은 금액
 *
 * 셋 중 하나만 어긋나도 답이 틀린다. 앵커 뒤 자금만 세면서 전표는 총액부터 시작하면
 * 덜 갚은 것으로 보이고, 앵커 전 자금까지 세면 두 번 갚은 것으로 보인다.
 * 그래서 셋을 **한 자리에서** 낸다 — 화면이 규칙을 따로 들고 있으면 언젠가 어긋난다.
 *
 * 앵커가 없으면 넘어온 걸 그대로 돌려준다(지금이 이 길이다).
 */
export function allocationInputs<S extends { id: string; tradeDate: string }, C extends { date: string }>(
  anchor: PartnerAnchor | undefined,
  statements: S[],
  cashEntries: C[],
): { statements: S[]; cashEntries: C[]; opening: Map<string, number> | undefined } {
  if (!anchor) return { statements, cashEntries, opening: undefined };
  const opening = openingRemainders(anchor);
  return {
    statements: statements.filter(s => String(s.tradeDate ?? '') > anchor.asOf || opening.has(s.id)),
    cashEntries: cashEntries.filter(e => String(e.date ?? '') > anchor.asOf),
    opening,
  };
}
