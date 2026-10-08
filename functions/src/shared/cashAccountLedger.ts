/** Shared account ledger calculation; no Firebase or UI dependencies. */
export type LedgerCashEntry = {
  id: string; date: string; createdAt?: string; cashAccountId?: string; companyId?: 'taebaek' | 'punghoe';
  dir: '입금' | '출금' | '대체'; amount: number;
  balanceAdjustment?: { before: number; target: number; delta: number; reason: string; confirmedBalance?: boolean };
};
export type LedgerCashAccount = {
  id: string; companyId?: 'taebaek' | 'punghoe'; openingDate: string; openingBalance: number;
  confirmedBalances?: { date: string; balance: number; recordedAt: string; reason: string }[];
};

/** 원장 한 줄 — 거래 + 그 시점 잔액 */
export interface LedgerRow<E extends LedgerCashEntry = LedgerCashEntry> {
  entry: E;
  balance: number;   // 이 거래 직후 잔액
  confirmedAccountBalance?: boolean; // 계좌에 보관된 확정값: 자금 전표가 아닌 읽기 기준점
  adjustmentDelta?: number; // 잔액 조정의 실제 적용 차액(확정 기준점은 현재 거래에서 역산)
}

/** 특정 계좌의 원장. openingDate 이전 거래는 제외(기초잔액에 이미 포함된 것으로 본다). */
export interface AccountLedger<A extends LedgerCashAccount = LedgerCashAccount, E extends LedgerCashEntry = LedgerCashEntry> {
  account: A;
  opening: number;      // 이월(기초) 잔액 — 기간 시작 직전 잔액
  rows: LedgerRow<E>[];    // 기간 내 거래 (날짜 오름차순)
  totalIn: number;      // 기간 입금 합계
  totalOut: number;     // 기간 출금 합계
  totalAdjustment: number; // 기간 잔액 조정 합계(입출금 실적과 구분)
  closing: number;      // 기말 잔액 = opening + totalIn - totalOut + totalAdjustment
}


/** 입금 +, 출금 −. 대체(상계)는 돈이 안 움직였으므로 0 — 통장 잔액을 건드리면 안 된다. */
export function signedAmount(e: LedgerCashEntry): number {
  if (e.dir === '대체') return 0;
  return e.dir === '입금' ? e.amount : -e.amount;
}

/** 같은 날짜면 생성순(createdAt)으로 안정 정렬 — 통장 순서를 재현하기 위함 */
function byDateThenCreated(a: LedgerCashEntry, b: LedgerCashEntry): number {
  const d = (a.date || '').localeCompare(b.date || '');
  if (d !== 0) return d;
  // 확정 잔액은 해당 날짜의 모든 실제 거래 이후 적용한다.
  const anchor = Number(a.balanceAdjustment?.confirmedBalance === true) - Number(b.balanceAdjustment?.confirmedBalance === true);
  if (anchor !== 0) return anchor;
  return (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id);
}

/**
 * 한 계좌의 원장을 [from, to] 기간으로 만든다.
 * opening = 기초잔액 + (openingDate ~ from 직전) 거래 누적. 그래서 기간을 좁혀도 잔액이 틀어지지 않는다.
 */
export function buildAccountLedger<A extends LedgerCashAccount, E extends LedgerCashEntry>(
  account: A,
  allEntries: E[],
  from: string,
  to: string,
): AccountLedger<A, E> {
  const confirmations = new Map<string, NonNullable<LedgerCashAccount['confirmedBalances']>[number]>();
  for (const confirmation of account.confirmedBalances ?? []) {
    const previous = confirmations.get(confirmation.date);
    if (!previous || confirmation.recordedAt >= previous.recordedAt) confirmations.set(confirmation.date, confirmation);
  }
  const confirmedEntries: E[] = [...confirmations.values()].map(confirmation => ({
    id: `account-confirmed:${encodeURIComponent(account.id)}:${confirmation.date}`,
    companyId: account.companyId ?? 'taebaek', cashAccountId: account.id, date: confirmation.date,
    createdAt: confirmation.recordedAt, dir: '입금', amount: 0,
    balanceAdjustment: { before: confirmation.balance, target: confirmation.balance, delta: 0,
      reason: confirmation.reason, confirmedBalance: true },
  } as E));
  const confirmedIds = new Set(confirmedEntries.map(entry => entry.id));
  const mine = [...allEntries, ...confirmedEntries]
    .filter(e => e.cashAccountId === account.id && e.date >= account.openingDate)
    .sort(byDateThenCreated);

  let opening = account.openingBalance;
  const rows: LedgerRow<E>[] = [];
  let totalIn = 0, totalOut = 0, totalAdjustment = 0;
  let running = account.openingBalance;

  for (const e of mine) {
    const delta = e.balanceAdjustment?.confirmedBalance === true
      ? e.balanceAdjustment.target - running : signedAmount(e);
    running += delta;
    if (from && e.date < from) {
      opening = running;          // 기간 이전 → 이월잔액에만 반영
      continue;
    }
    if (to && e.date > to) break; // 정렬돼 있으므로 이후는 볼 필요 없음 (to 비면 전체)
    if (e.balanceAdjustment) totalAdjustment += delta;
    else if (e.dir === '입금') totalIn += e.amount; else if (e.dir === '출금') totalOut += e.amount;
    rows.push({ entry: e, balance: running, ...(e.balanceAdjustment ? { adjustmentDelta: delta } : {}),
      ...(confirmedIds.has(e.id) ? { confirmedAccountBalance: true } : {}) });
  }

  return { account, opening, rows, totalIn, totalOut, totalAdjustment, closing: opening + totalIn - totalOut + totalAdjustment };
}

