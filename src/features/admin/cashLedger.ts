import { CashAccount, CashEntry, IssuedStatement, JournalEntry, Settlement } from '../../shared/types';
import { rowStamp, issuedMs } from '../../shared/voucherStamp';

/**
 * 자금 원장(현금출납장) 순수 도메인 모듈 — 부수효과 없음(입력 → 값).
 *
 * 전표(issuedStatements)가 '거래가 발생했다'를 기록한다면, 여기는 '실제로 돈이 움직였다'를 기록한다.
 * 통장 한 줄 한 줄에 그 시점의 잔액이 찍히듯, CashEntry를 시간순으로 굴려 잔액을 만든다.
 */

/** 원장 한 줄 — 거래 + 그 시점 잔액 */
export interface LedgerRow {
  entry: CashEntry;
  balance: number;   // 이 거래 직후 잔액
}

/** 특정 계좌의 원장. openingDate 이전 거래는 제외(기초잔액에 이미 포함된 것으로 본다). */
export interface AccountLedger {
  account: CashAccount;
  opening: number;      // 이월(기초) 잔액 — 기간 시작 직전 잔액
  rows: LedgerRow[];    // 기간 내 거래 (날짜 오름차순)
  totalIn: number;      // 기간 입금 합계
  totalOut: number;     // 기간 출금 합계
  closing: number;      // 기말 잔액 = opening + totalIn - totalOut
}

/** 거래처 채권·채무 계정 — 이 둘만 거래처 잔액을 움직인다 */
import { journalizeStatement } from '../../shared/autoJournal';

const AR = '108';   // 외상매출금
const AP = '251';   // 외상매입금

/** 입금 +, 출금 −. 대체(상계)는 돈이 안 움직였으므로 0 — 통장 잔액을 건드리면 안 된다. */
export function signedAmount(e: CashEntry): number {
  if (e.dir === '대체') return 0;
  return e.dir === '입금' ? e.amount : -e.amount;
}

/** 같은 날짜면 생성순(createdAt)으로 안정 정렬 — 통장 순서를 재현하기 위함 */
function byDateThenCreated(a: CashEntry, b: CashEntry): number {
  const d = (a.date || '').localeCompare(b.date || '');
  if (d !== 0) return d;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

/**
 * 한 계좌의 원장을 [from, to] 기간으로 만든다.
 * opening = 기초잔액 + (openingDate ~ from 직전) 거래 누적. 그래서 기간을 좁혀도 잔액이 틀어지지 않는다.
 */
export function buildAccountLedger(
  account: CashAccount,
  allEntries: CashEntry[],
  from: string,
  to: string,
): AccountLedger {
  const mine = allEntries
    .filter(e => e.cashAccountId === account.id && e.date >= account.openingDate)
    .sort(byDateThenCreated);

  let opening = account.openingBalance;
  const rows: LedgerRow[] = [];
  let totalIn = 0, totalOut = 0;
  let running = account.openingBalance;

  for (const e of mine) {
    running += signedAmount(e);
    if (from && e.date < from) {
      opening = running;          // 기간 이전 → 이월잔액에만 반영
      continue;
    }
    if (to && e.date > to) break; // 정렬돼 있으므로 이후는 볼 필요 없음 (to 비면 전체)
    if (e.dir === '입금') totalIn += e.amount; else totalOut += e.amount;
    rows.push({ entry: e, balance: running });
  }

  return { account, opening, rows, totalIn, totalOut, closing: opening + totalIn - totalOut };
}

/** 전 계좌의 현재 잔액 합계 — "오늘 우리 돈이 얼마인가" */
export function totalCashOnHand(accounts: CashAccount[], allEntries: CashEntry[], asOf: string): number {
  return accounts.reduce((sum, acc) => {
    const bal = allEntries
      .filter(e => e.cashAccountId === acc.id && e.date >= acc.openingDate && e.date <= asOf)
      .reduce((a, e) => a + signedAmount(e), acc.openingBalance);
    return sum + bal;
  }, 0);
}

/** 전표에 대해 이미 매칭(상계)된 금액 */
export function settledAmount(statementId: string, settlements: Settlement[]): number {
  return settlements
    .filter(s => s.statementId === statementId)
    .reduce((a, s) => a + s.amount, 0);
}

/** 전표의 미결제 잔액. 0 이하면 결제 완료. */
export function openBalance(stmt: IssuedStatement, settlements: Settlement[]): number {
  return stmt.totalAmount - settledAmount(stmt.id, settlements);
}

/** 아직 안 끝난 전표들 — 자금 원장에서 매칭 대상으로 띄울 목록 */
export function unsettledStatements(
  statements: IssuedStatement[],
  settlements: Settlement[],
  opts?: { type?: '매출' | '매입'; partnerId?: string },
): { stmt: IssuedStatement; open: number }[] {
  return statements
    .filter(s => (!opts?.type || s.type === opts.type) && (!opts?.partnerId || s.partnerId === opts.partnerId))
    .map(stmt => ({ stmt, open: openBalance(stmt, settlements) }))
    .filter(r => r.open > 0)
    .sort((a, b) => (a.stmt.tradeDate || '').localeCompare(b.stmt.tradeDate || ''));
}

/** 자금 이동 한 건에 대해 아직 전표에 안 붙은 금액 */
export function unmatchedCash(entry: CashEntry, settlements: Settlement[]): number {
  const matched = settlements
    .filter(s => s.cashEntryId === entry.id)
    .reduce((a, s) => a + s.amount, 0);
  return entry.amount - matched;
}

// ── 거래처원장 ────────────────────────────────────────────────────────────────

export interface PartnerLedgerRow {
  kind: '전표' | '결제';
  id: string;
  date: string;
  label: string;          // 적요 (전표=문서번호, 결제=적요/방법)
  amount: number;         // 전표 = +발생(채권·채무 증가), 결제 = −상계
  balance: number;        // 이 행 직후 잔액
  /** 결제 출처 — 자금원장 매칭뿐이다(전표에 매다는 옛 경로는 걷어냈다) */
  source?: 'cash';
}

export interface PartnerLedger {
  rows: PartnerLedgerRow[];
  accrued: number;        // 기간 내 발생 총액
  paid: number;           // 기간 내 결제 총액
  balance: number;        // 현재 잔액 (매출=받을돈, 매입=줄돈)
}

/**
 * 한 거래처의 채권(매출)·채무(매입) 원장 — **분개의 108·251 줄을 시간순으로 굴린다.**
 *
 * 전에는 전표를 `type`으로 거르고 결제는 settlements에서 가져왔다. 두 가지가 샜다:
 *   · 갈래가 매출·매입이 아닌 전표(기초·상계)는 원장에 아예 안 떴다
 *   · 매칭(settlement)을 안 붙인 수금·지불은 잔액만 줄고 행은 안 보였다
 * 채권·채무가 움직인 곳은 분개의 108·251 줄뿐이다. 거기서 뽑으면 빠질 자리가 없고,
 * 합계가 partnerBalanceFromJournals와 저절로 같아진다(근거가 하나라서).
 *
 * 라벨은 원본(전표·자금)에서 찾아 붙인다 — 분개 memo만으로는 무슨 전표인지 흐리다.
 */
export function buildPartnerLedger(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  entries: JournalEntry[],
): PartnerLedger {
  const want = type === '매출' ? AR : AP;
  const stmtById = new Map(statements.map(s => [s.id, s]));
  const cashById = new Map(cashEntries.map(e => [e.id, e]));

  type Ev = { row: Omit<PartnerLedgerRow, 'balance'>; ts: string; order: number };
  const evs: Ev[] = [];
  for (const je of entries) {
    for (const l of je.lines ?? []) {
      if (String(l.accountCode) !== want || l.partnerId !== partnerId) continue;
      // 채권은 차변이 느는 것, 채무는 대변이 느는 것
      const amt = type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
      if (!amt) continue;
      const st = stmtById.get(je.sourceId ?? '');
      const ce = cashById.get(je.sourceId ?? '');
      const date = st?.tradeDate ?? ce?.date ?? je.date;
      evs.push({
        row: {
          kind: amt > 0 ? '전표' : '결제',
          id: `${je.id}__${l.accountCode}`,
          date,
          label: st?.docNo || ce?.note || je.memo || (amt > 0 ? '발생' : '결제'),
          amount: amt,
          ...(ce ? { source: 'cash' as const } : {}),
        },
        ts: rowStamp(date, st?.issuedAt ?? ce?.createdAt),
        order: amt > 0 ? 0 : 1,   // 같은 시각이면 발생이 먼저, 상계가 뒤
      });
    }
  }
  // 같은 시각·같은 갈래면 **끊은 순서**(id에 박힌 ms) — 읽어온 순서에 기대면 새로고침마다 달라진다.
  evs.sort((a, b) => a.ts.localeCompare(b.ts) || a.order - b.order
    || issuedMs(a.row.id) - issuedMs(b.row.id)
    || String(a.row.id).localeCompare(String(b.row.id), undefined, { numeric: true }));

  let running = 0, accrued = 0, paid = 0;
  const rows: PartnerLedgerRow[] = evs.map(({ row }) => {
    running += row.amount;
    if (row.amount > 0) accrued += row.amount; else paid += -row.amount;
    return { ...row, balance: running };
  });
  return { rows, accrued, paid, balance: running };
}

/** 거래처별 현재 잔액 — 목록 화면용 */
/**
 * 거래처 잔액 — 미수(매출) / 미지급(매입).
 *
 *   청구액 합계 − 그 거래처로 오간 채권·채무(108/251) 자금
 *
 * **청구액(totalAmount)을 더해야 한다.** 전표별 잔액(수금이 이미 배분돼 빠진 값)을 더한 뒤
 * 다시 수금을 빼면 두 번 빠진다 — 실제로 그래서 알이네식품 미수가 −1,469,000이 되어
 * 거래처 목록에서 통째로 사라졌다(0 이하는 안 그린다).
 *
 * 마이너스면 더 받은 것(선수금). 화면 세 곳(거래처통계·전표·재무제표)이 이 함수 하나를 쓴다.
 */
/**
 * 거래처별 채권·채무 — **분개의 108·251에서 센다.**
 *
 * 전에는 전표 머리의 `type`('매출'/'매입')으로 셌다. 지금 숫자는 같지만 갈라질 자리가 있다:
 *   · 기초 전표를 대체로 옮기면 type 필터에서 빠져 미수가 통째로 사라진다
 *   · 현금매출처럼 108을 안 세우는 전표가 생기면 type만 보고 미수로 잡는다
 * 잔액은 **계정이 정한다.** 갈래는 어떻게 끊었는지일 뿐이다.
 *
 * 분개는 채권·채무 줄에 거래처를 달아 둔다(journalizeStatement·Transfer·CashEntry 모두).
 * 기초잔액(openingBalances)에는 거래처가 없으므로 안 넘겨도 결과가 같다.
 */
export function partnerBalanceFromJournals(
  partnerId: string,
  type: '매출' | '매입',
  entries: JournalEntry[],
): number {
  const want = type === '매출' ? AR : AP;
  return entries.reduce((a, e) => a + (e.lines ?? []).reduce((b, l) => {
    if (String(l.accountCode) !== want || l.partnerId !== partnerId) return b;
    // 채권은 차변이 느는 것, 채무는 대변이 느는 것
    return b + (type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0));
  }, 0), 0);
}

/**
 * **전 거래처 채권·채무 잔액을 한 번에.** 분개를 한 번만 훑는다.
 *
 * 거래처마다 partnerBalanceFromJournals를 부르면 (거래처 수 × 분개 수)로 훑는 데다,
 * 부르는 쪽이 거래처 목록을 만들어야 해서 **목록에서 빠진 거래처가 조용히 0으로 보인다.**
 * 전표 조회창이 좁으면 그 창에 안 걸린 거래처가 통째로 빠졌다 — 일반전표 발행에서
 * 거래처를 골랐는데 잔액이 0으로 뜨던 원인이다. 여기선 분개에 나오는 거래처를 다 담는다.
 */
export function allPartnerBalances(entries: JournalEntry[]): Map<string, { receivable: number; payable: number }> {
  const map = new Map<string, { receivable: number; payable: number }>();
  const bump = (pid: string, key: 'receivable' | 'payable', v: number) => {
    const cur = map.get(pid) ?? { receivable: 0, payable: 0 };
    cur[key] += v;
    map.set(pid, cur);
  };
  for (const e of entries) {
    for (const l of e.lines ?? []) {
      const pid = l.partnerId;
      if (!pid) continue;
      const code = String(l.accountCode);
      // 채권은 차변이 느는 것, 채무는 대변이 느는 것 (partnerBalanceFromJournals와 같은 규칙)
      if (code === AR) bump(pid, 'receivable', (l.debit ?? 0) - (l.credit ?? 0));
      else if (code === AP) bump(pid, 'payable', (l.credit ?? 0) - (l.debit ?? 0));
    }
  }
  return map;
}

/**
 * 기간 이월 — **기간 시작 전 잔액 + 기초 전표.**
 *
 * 기초 전표는 거래가 아니라 개시잔액이라 기간 발생에서 빼는데(날짜가 기간 안이어도),
 * 그러면 이월에도 넣어야 한다. 안 넣으면 어디에도 안 잡혀 통째로 사라진다 —
 * 장부가 2026-07-31 기초로 시작하는데 연 2026을 보면 `날짜 < 2026-01-01`에 걸리는
 * 분개가 없어 이월이 0이 됐고, 거래처 44곳에서 미수가 139,859,460원 모자랐다.
 *
 * `이월 + 기간발생 − 기간결제 = 기간말 잔액`이 성립해야 목록(전기간 잔액)과 맞는다.
 */
export function partnerCarryOver(
  partnerId: string,
  type: '매출' | '매입',
  entries: JournalEntry[],
  periodStart: string,
  openingSourceIds: ReadonlySet<string>,
): number {
  return partnerBalanceFromJournals(partnerId, type, entries.filter(
    e => String(e.date ?? '') < periodStart || openingSourceIds.has(String(e.sourceId ?? ''))));
}

export function partnerOpenBalance(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
): number {
  const gross = statements
    .filter(s => s.partnerId === partnerId && isReceivableStmt(s, type))
    .reduce((a, s) => a + (s.totalAmount ?? 0), 0);
  return gross - partnerPaid(partnerId, type, cashEntries);
}

/**
 * 전표별 남은 금액 — 거래처로 들어온 돈을 전표에 나눠 붙인다.
 *
 *   1) 사람이 지정한 매칭(settlement)을 **먼저** 채운다 — "이 입금은 이 청구서"라고 찍은 것
 *   2) 남은 돈은 오래된 전표부터 자동으로 채운다(선입선출)
 *
 * **잔액식은 이걸 안 쓴다.** 거래처 잔액은 늘 `partnerOpenBalance`(청구액 − 자금원장)로 낸다.
 * 그래서 매칭이 틀리거나 고아가 돼도 잔액은 안 흔들리고, "어느 청구서냐"만 틀린다.
 * 전에 payments[]가 금액까지 들고 있어서 화면마다 잔액이 달랐던 게 그 반대 경우다.
 *
 * 근거(cashEntry)가 사라진 매칭은 안 친다 — 근거 없이 갚은 것으로 치면 안 받은 돈이 사라진다.
 */
/**
 * **이 전표가 그 거래처의 채권(매출)·채무(매입)를 세우는가 — 분개로 판단한다.**
 *
 * 타입(매출/매입)으로 보면 근거가 약하다. 갈래는 "어떻게 끊었는지"일 뿐이고
 * **잔액은 계정이 정한다.** 그래서 실제로 108/251이 서는지를 본다.
 *
 * 분개가 안 서는 전표(품목에 계정이 안 붙은 것)는 **애초에 있으면 안 된다** — 대변을 못 채우면
 * 차·대가 안 맞는다. 그래서 여기서 감싸 주지 않는다. 만드는 길은 발행 때 막는다
 * (TradeStatement가 계정 없는 줄이 있으면 저장을 거부한다).
 *
 * 다만 **기초이월은 분개가 안 선다** — 차·대를 직접 세운 일반전표라 type이 '비용'이고
 * journalizeStatement는 매출·매입만 만든다. 그건 줄에 적힌 108 차변 / 251 대변으로 읽는다.
 * 이걸 빠뜨리면 기초를 갚은 수금이 새 전표를 오래된 순으로 갉아먹는다
 * (유통가교: 기초 1,755,000 수금에 08-25·08-28이 다 갚아진 걸로 잡혔다. 실제 미수 620,000).
 */
export function isReceivableStmt(s: IssuedStatement, type: '매출' | '매입'): boolean {
  const want = type === '매출' ? AR : AP;
  for (const l of journalizeStatement(s)?.lines ?? []) {
    if (String(l.accountCode) !== want) continue;
    const moved = type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
    if (moved !== 0) return true;
  }
  const side = type === '매출' ? '차변' : '대변';
  return (s.items ?? []).some(it => String(it.accountCode) === want && it.side === side);
}

export function allocatePartnerCash(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[] = [],
): Map<string, number> {
  //  기초이월 전표도 후보에 넣는다 — 안 넣으면 그걸 갚은 수금이 새 전표를 갉아먹는다(isReceivableStmt 주석 참조).
  const mine = statements
    .filter(s => s.partnerId === partnerId && isReceivableStmt(s, type))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const left = new Map(mine.map(s => [s.id, s.totalAmount ?? 0]));
  if (!mine.length) return left;

  const liveCash = new Set(cashEntries.map(e => e.id));
  const mineIds = new Set(mine.map(s => s.id));

  // 1) 지정 매칭 — 근거가 살아 있는 것만, 전표 잔액을 넘지 않게
  let pinned = 0;
  for (const st of settlements) {
    if (!mineIds.has(st.statementId) || !liveCash.has(st.cashEntryId)) continue;
    const open = left.get(st.statementId) ?? 0;
    const apply = Math.min(Math.max(st.amount ?? 0, 0), open);
    if (apply <= 0) continue;
    left.set(st.statementId, open - apply);
    pinned += apply;
  }

  // 2) 남은 돈은 오래된 순으로
  let rem = Math.max(0, partnerPaid(partnerId, type, cashEntries) - pinned);
  for (const s of mine) {
    if (rem <= 0) break;
    const open = left.get(s.id) ?? 0;
    const apply = Math.min(rem, open);
    if (apply <= 0) continue;
    left.set(s.id, open - apply);
    rem -= apply;
  }
  return left;
}

/** 자금기록 한 건이 채권·채무를 턴 몫 */
export interface PartnerCashPart {
  /** 108 외상매출금(채권) · 251 외상매입금(채무) */
  code: string;
  /** 양수 = 그만큼 줄었다(수금·지불·상계), 음수 = 되돌림 */
  reduce: number;
  note?: string;
}

/**
 * 자금기록 한 건에서 **거래처 채권·채무(108/251)를 턴 몫**을 뽑는다.
 *
 * 잔액·이월·타임라인·미수금 상세가 전부 이 한 곳을 본다. 화면마다 따로 세면
 * 같은 거래처가 화면마다 다른 잔액으로 보인다 — 실제로 그래서 상계가 어떤 화면에선
 * 안 보이고 어떤 화면에선 부호가 뒤집혀 보였다.
 *
 * **상계(대체)가 까다롭다.** 줄 부호가 차·대를 뜻해서 108이 음수로 적힌다.
 * `amount > 0`으로 거르면 그 줄이 통째로 사라지고, 부호를 그대로 쓰면 채권이 늘어난 것처럼 읽힌다.
 * 상계는 108·251을 **동시에** 터는 것이라, 어느 쪽을 보든 줄어드는 방향이다.
 */
export function partnerCashParts(e: CashEntry): PartnerCashPart[] {
  const isOffset = e.dir === '대체';
  const parts = (e.lines ?? []).filter(l => l.accountCode && (isOffset ? l.amount !== 0 : l.amount > 0));
  const list = parts.length
    ? parts.map(l => ({ code: l.accountCode as string, amt: Math.abs(l.amount), note: l.note }))
    : (e.accountCode ? [{ code: e.accountCode, amt: e.amount, note: undefined as string | undefined }] : []);
  return list
    .filter(x => x.code === AR || x.code === AP)
    .map(x => {
      const inflow = isOffset || (x.code === AR ? e.dir === '입금' : e.dir === '출금');
      return { code: x.code, reduce: (inflow ? 1 : -1) * x.amt, note: x.note };
    });
}

/** 그 거래처로 오간 채권·채무(108/251) 자금 합계. 반대 방향은 되돌림(음수). */
export function partnerPaid(
  partnerId: string,
  type: '매출' | '매입',
  cashEntries: CashEntry[],
): number {
  const want = type === '매출' ? AR : AP;
  return cashEntries
    .filter(e => e.partnerId === partnerId)
    .reduce((a, e) => a + partnerCashParts(e)
      .reduce((b, p) => b + (p.code === want ? p.reduce : 0), 0), 0);
}

export function partnerBalances(
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  entries: JournalEntry[],
): { partnerId: string; partnerName: string; balance: number; count: number }[] {
  // 목록도 갈래가 아니라 **분개에 그 거래처의 108·251이 섰는가**로 모은다.
  // 갈래로 모으면 기초·상계만 있는 거래처가 목록에서 통째로 사라진다.
  const want = type === '매출' ? AR : AP;
  const withBalance = new Set<string>();
  for (const je of entries) for (const l of je.lines ?? []) {
    if (String(l.accountCode) === want && l.partnerId) withBalance.add(l.partnerId);
  }
  const ids = new Map<string, string>();
  for (const s of statements) {
    // 실제 데이터에 partnerName이 비어 있는 전표가 있다 — 빈 문자열로 정규화한다.
    if (s.partnerId && withBalance.has(s.partnerId)) ids.set(s.partnerId, s.partnerName || '(이름없음)');
  }
  for (const e of cashEntries) {
    if (e.partnerId && withBalance.has(e.partnerId) && !ids.has(e.partnerId)) {
      ids.set(e.partnerId, e.partnerName || '(이름없음)');
    }
  }
  return [...ids.entries()]
    .map(([partnerId, partnerName]) => {
      const l = buildPartnerLedger(partnerId, type, statements, cashEntries, entries);
      return { partnerId, partnerName, balance: l.balance, count: l.rows.filter(r => r.kind === '전표').length };
    })
    .sort((a, b) => b.balance - a.balance);
}
