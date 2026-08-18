import { CashAccount, CashEntry, IssuedStatement, Settlement } from '../../shared/types';

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

/** 입금 +, 출금 − */
export function signedAmount(e: CashEntry): number {
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
 * 한 거래처의 채권(매출)·채무(매입) 원장. 전표와 결제를 시간순으로 엮어 잔액을 굴린다.
 *
 * 결제는 자금원장 매칭(settlements) 한 곳에서만 온다. 전에는 전표에 매달린 payments[]도
 * 같이 봤는데, 같은 결제가 양쪽에 남으면 이중으로 빠져 잔액이 어긋났다.
 *
 * 전체 전표를 넘겨야 잔액이 맞는다 — 기간을 잘라서 넘기면 이월 잔액이 사라진다.
 */
export function buildPartnerLedger(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[],
): PartnerLedger {
  const mine = statements.filter(s => s.partnerId === partnerId && s.type === type);
  const mineIds = new Set(mine.map(s => s.id));
  const entryById = new Map(cashEntries.map(e => [e.id, e]));

  type Ev = { row: Omit<PartnerLedgerRow, 'balance'>; ts: string; order: number };
  const evs: Ev[] = [];

  for (const s of mine) {
    // 전표: 채권·채무 발생
    evs.push({
      row: { kind: '전표', id: s.id, date: s.tradeDate, label: s.docNo || '전표', amount: s.totalAmount },
      ts: `${s.tradeDate}T${(s.issuedAt || '').slice(11, 19) || '00:00:00'}`,
      order: 0,   // 같은 시각이면 전표가 먼저 (발생 후 상계)
    });
  }

  // 자금원장 매칭
  for (const st of settlements) {
    if (!mineIds.has(st.statementId)) continue;
    const e = entryById.get(st.cashEntryId);
    if (!e) continue;   // 자금 기록이 지워졌으면 상계로 치지 않는다
    evs.push({
      row: { kind: '결제', id: st.id, date: e.date, label: e.note || (e.dir === '출금' ? '지불' : '수금'), amount: -st.amount, source: 'cash' },
      ts: `${e.date}T${(e.createdAt || '').slice(11, 19) || '00:00:00'}`,
      order: 1,
    });
  }

  evs.sort((a, b) => a.ts.localeCompare(b.ts) || a.order - b.order);

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
export function partnerOpenBalance(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
): number {
  const gross = statements
    .filter(s => s.partnerId === partnerId && s.type === type)
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
export function allocatePartnerCash(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[] = [],
): Map<string, number> {
  const mine = statements
    .filter(s => s.partnerId === partnerId && s.type === type)
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

/** 그 거래처로 오간 채권·채무(108/251) 자금 합계. 반대 방향은 되돌림(음수). */
export function partnerPaid(
  partnerId: string,
  type: '매출' | '매입',
  cashEntries: CashEntry[],
): number {
  const want = type === '매출' ? '108' : '251';
  return cashEntries
    .filter(e => e.partnerId === partnerId)
    .reduce((a, e) => {
      const parts = (e.lines ?? []).filter(l => l.accountCode && l.amount > 0);
      const list = parts.length
        ? parts.map(l => ({ c: l.accountCode, a: l.amount }))
        : (e.accountCode ? [{ c: e.accountCode, a: e.amount }] : []);
      return a + list.reduce((b, x) => {
        if (x.c !== want) return b;
        const inflow = type === '매출' ? e.dir === '입금' : e.dir === '출금';
        return b + (inflow ? x.a : -x.a);
      }, 0);
    }, 0);
}

export function partnerBalances(
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[],
): { partnerId: string; partnerName: string; balance: number; count: number }[] {
  const ids = new Map<string, string>();
  for (const s of statements) {
    // 실제 데이터에 partnerName이 비어 있는 전표가 있다 — 빈 문자열로 정규화한다.
    if (s.type === type && s.partnerId) ids.set(s.partnerId, s.partnerName || '(이름없음)');
  }
  return [...ids.entries()]
    .map(([partnerId, partnerName]) => {
      const l = buildPartnerLedger(partnerId, type, statements, cashEntries, settlements);
      return { partnerId, partnerName, balance: l.balance, count: l.rows.filter(r => r.kind === '전표').length };
    })
    .sort((a, b) => b.balance - a.balance);
}
