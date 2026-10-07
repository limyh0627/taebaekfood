import { AccountCode, CashAccount, CashEntry, CompanyId, IssuedStatement, JournalEntry, Settlement, companyOf } from '../../shared/types';
import { rowStamp, issuedMs, timeOfLocal } from '../../shared/voucherStamp';
import { STANDARD_ACCOUNT } from '../../shared/accountChart';

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
  confirmedAccountBalance?: boolean; // 계좌에 보관된 확정값: 자금 전표가 아닌 읽기 기준점
  adjustmentDelta?: number; // 잔액 조정의 실제 적용 차액(확정 기준점은 현재 거래에서 역산)
}

/** 특정 계좌의 원장. openingDate 이전 거래는 제외(기초잔액에 이미 포함된 것으로 본다). */
export interface AccountLedger {
  account: CashAccount;
  opening: number;      // 이월(기초) 잔액 — 기간 시작 직전 잔액
  rows: LedgerRow[];    // 기간 내 거래 (날짜 오름차순)
  totalIn: number;      // 기간 입금 합계
  totalOut: number;     // 기간 출금 합계
  totalAdjustment: number; // 기간 잔액 조정 합계(입출금 실적과 구분)
  closing: number;      // 기말 잔액 = opening + totalIn - totalOut + totalAdjustment
}

/** 거래처 채권·채무 계정 — 이 둘만 거래처 잔액을 움직인다 */
//  계정코드는 [autoJournal](../../shared/autoJournal.ts) 한 곳에서 온다 —
//  손으로 옮겨 적으면 표준계정과목으로 옮길 때 한쪽만 고쳐진다(2026-09-05)
import { journalizeStatement, AR, AP, OTHER_PAYABLE } from '../../shared/autoJournal';
/*
 * **거래처 잔액은 251·253을 한 덩어리로 본다.**
 * 둘 다 그 거래처에 갚을 돈이다 — 재무상태표에서만 매입채무와 미지급금으로 갈린다.
 * 여기서 251만 보면, 세금·경비를 외상으로 진 채무가 거래처원장에서 통째로 사라진다.
 */
const PAYABLES = [AP, OTHER_PAYABLE];
const isPay = (c: string | undefined) => c === AP || c === OTHER_PAYABLE;

/** 입금 +, 출금 −. 대체(상계)는 돈이 안 움직였으므로 0 — 통장 잔액을 건드리면 안 된다. */
export function signedAmount(e: CashEntry): number {
  if (e.dir === '대체') return 0;
  return e.dir === '입금' ? e.amount : -e.amount;
}

/** 같은 날짜면 생성순(createdAt)으로 안정 정렬 — 통장 순서를 재현하기 위함 */
function byDateThenCreated(a: CashEntry, b: CashEntry): number {
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
export function buildAccountLedger(
  account: CashAccount,
  allEntries: CashEntry[],
  from: string,
  to: string,
): AccountLedger {
  const confirmations = new Map<string, NonNullable<CashAccount['confirmedBalances']>[number]>();
  for (const confirmation of account.confirmedBalances ?? []) {
    const previous = confirmations.get(confirmation.date);
    if (!previous || confirmation.recordedAt >= previous.recordedAt) confirmations.set(confirmation.date, confirmation);
  }
  const confirmedEntries: CashEntry[] = [...confirmations.values()].map(confirmation => ({
    id: `account-confirmed:${encodeURIComponent(account.id)}:${confirmation.date}`,
    companyId: companyOf(account), cashAccountId: account.id, date: confirmation.date,
    createdAt: confirmation.recordedAt, dir: '입금', amount: 0,
    balanceAdjustment: { before: confirmation.balance, target: confirmation.balance, delta: 0,
      reason: confirmation.reason, confirmedBalance: true },
  }));
  const confirmedIds = new Set(confirmedEntries.map(entry => entry.id));
  const mine = [...allEntries, ...confirmedEntries]
    .filter(e => e.cashAccountId === account.id && e.date >= account.openingDate)
    .sort(byDateThenCreated);

  let opening = account.openingBalance;
  const rows: LedgerRow[] = [];
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

/** 전 계좌의 현재 잔액 합계 — "오늘 우리 돈이 얼마인가" */
export function totalCashOnHand(accounts: CashAccount[], allEntries: CashEntry[], asOf: string): number {
  return accounts.reduce((sum, acc) => sum + buildAccountLedger(acc, allEntries, '', asOf).closing, 0);
}

/**
 * 전표에 대해 이미 매칭(상계)된 금액.
 *
 * **근거가 살아 있는 것만 센다.** 자금줄이 지워져도 매칭 기록(settlements)은 남는데,
 * 그걸 세면 없는 돈으로 갚은 것이 된다. `allocatePartnerCash` 는 진작 그렇게 하고 있었고
 * 여기만 안 봐서 **같은 전표가 두 화면에서 다른 잔액으로 보였다**(2026-09-03 실측) —
 *
 *   260827-02 희성실업   전표 목록 1,026만 미지급   매칭 후보 창 186만
 *   260902-04 해피유통    전표 목록      0원        매칭 후보 창 **−995만**
 *
 * @param liveCashIds 살아 있는 자금줄 id. 안 넘기면 예전처럼 다 센다(옛 호출부 호환).
 */
export function settledAmount(
  statementId: string,
  settlements: Settlement[],
  liveCashIds?: Set<string>,
): number {
  return settlements
    .filter(s => s.statementId === statementId)
    .filter(s => !liveCashIds || liveCashIds.has(s.cashEntryId))
    .reduce((a, s) => a + s.amount, 0);
}

/** 전표의 미결제 잔액. 0 이하면 결제 완료. */
export function openBalance(
  stmt: IssuedStatement,
  settlements: Settlement[],
  liveCashIds?: Set<string>,
): number {
  return stmt.totalAmount - settledAmount(stmt.id, settlements, liveCashIds);
}

/**
 * 아직 안 끝난 전표들 — 자금 원장에서 매칭 대상으로 띄울 목록.
 * `cashEntries` 를 넘기면 지워진 자금줄에 매달린 매칭은 안 센다(넘기는 게 맞다).
 */
export function unsettledStatements(
  statements: IssuedStatement[],
  settlements: Settlement[],
  opts?: { type?: '매출' | '매입'; partnerId?: string; cashEntries?: CashEntry[] },
): { stmt: IssuedStatement; open: number }[] {
  const live = opts?.cashEntries ? new Set(opts.cashEntries.map(e => e.id)) : undefined;
  return statements
    .filter(s => (!opts?.type || s.type === opts.type) && (!opts?.partnerId || s.partnerId === opts.partnerId))
    .map(stmt => ({ stmt, open: openBalance(stmt, settlements, live) }))
    .filter(r => r.open > 0)
    .sort((a, b) => (a.stmt.tradeDate || '').localeCompare(b.stmt.tradeDate || ''));
}

/** 자금 이동 한 건에 대해 아직 전표에 안 붙은 금액 */
export function unmatchedCash(entry: CashEntry, settlements: Settlement[]): number {
  if (entry.balanceAdjustment) return 0;
  const matched = settlements
    .filter(s => s.cashEntryId === entry.id)
    .reduce((a, s) => a + s.amount, 0);
  return entry.amount - matched;
}

// ── 거래처원장 ────────────────────────────────────────────────────────────────

export type PartnerHistorySource = 'statement' | 'cash' | 'manual';
export const PARTNER_BALANCE_CODES = [AR, AP, OTHER_PAYABLE, STANDARD_ACCOUNT.PREPAID, STANDARD_ACCOUNT.ADVANCE_RECEIVED];

/** 원문서당 한 행. 원본 종류를 키에 넣어 같은 ID의 자금·전표가 서로 덮이지 않게 한다. */
export function partnerAccountHistory(
  partnerId: string,
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  entries: JournalEntry[],
  skipped: { sourceType: string; id: string; reason: string }[] = [],
  companyId?: CompanyId,
) {
  const stmt = new Map(statements.filter(s => !companyId || companyOf(s) === companyId).map(s => [s.id, s]));
  const cash = new Map(cashEntries.filter(e => !companyId || companyOf(e) === companyId).map(e => [e.id, e]));
  const stmtIds = new Set(statements.map(s => s.id));
  const cashIds = new Set(cashEntries.map(e => e.id));
  const sourceOf = (type: string): PartnerHistorySource => type === '자금' ? 'cash' : type === '수동' ? 'manual' : 'statement';
  const eventKey = (type: PartnerHistorySource, id: string, original?: { companyId?: CompanyId }) => `${companyId ?? companyOf(original)}:${type}:${id}`;
  const invalid = new Map(skipped.map(item => [`${sourceOf(item.sourceType)}:${item.id}`, item.reason]));
  const history = new Map<string, { key: string; date: string; sourceType: PartnerHistorySource; sourceId: string;
    docNo: string; label: string; kind: string; warning?: string; accounts: string[];
    lines: { accountCode: string; debit: number; credit: number }[] }>();
  const rows: { key: string; eventKey: string; date: string; accountCode: string; debit: number; credit: number; opening: boolean }[] = [];
  for (const s of stmt.values()) if (s.partnerId === partnerId) history.set(eventKey('statement', s.id, s), {
    key: eventKey('statement', s.id, s), sourceType: 'statement', sourceId: s.id, date: s.tradeDate, docNo: s.docNo ?? '',
    kind: s.type === '비용' ? '대체' : s.type, label: s.items?.map(item => item.name).filter(Boolean).join(', ') || s.partnerName || '전표',
    accounts: [...new Set(s.items?.map(item => String(item.accountCode ?? '')).filter(Boolean))], lines: [],
  });
  for (const e of cash.values()) if (e.partnerId === partnerId) history.set(eventKey('cash', e.id, e), {
    key: eventKey('cash', e.id, e), sourceType: 'cash', sourceId: e.id, date: e.date, docNo: e.docNo ?? '',
    kind: e.dir, label: e.note || '자금전표',
    accounts: [...new Set((e.lines?.length ? e.lines.map(line => line.accountCode) : [e.accountCode]).filter(Boolean).map(String))], lines: [],
  });
  const seenJournals = new Set<string>();
  for (const je of entries) {
    const sourceType = sourceOf(je.sourceType);
    const sourceId = sourceType === 'manual' ? je.id : je.sourceId ?? je.id;
    const original = sourceType === 'cash' ? cash.get(sourceId) : sourceType === 'statement' ? stmt.get(sourceId) : undefined;
    // 분개에는 회사가 없으므로 원본 연결로 가른다. 다른 회사 원본은 거래처가 같아도 제외한다.
    const outside = sourceType === 'cash' ? cashIds.has(sourceId) : stmtIds.has(sourceId);
    if (sourceType !== 'manual' && outside && !original) continue;
    if (companyId && sourceType === 'manual' && companyOf(je as JournalEntry & { companyId?: CompanyId }) !== companyId) continue;
    const tagged = je.lines.some(line => line.partnerId === partnerId);
    if (original?.partnerId !== partnerId && !tagged) continue;
    const sourceKey = `${sourceType}:${sourceId}`;
    const key = eventKey(sourceType, sourceId, original ?? (je as JournalEntry & { companyId?: CompanyId }));
    const journalKey = `${key}:${je.id}`;
    if (seenJournals.has(journalKey)) continue;
    seenJournals.add(journalKey);
    const existing = history.get(key);
    const event: NonNullable<typeof existing> = existing ?? { key, sourceType, sourceId, date: je.date, docNo: original?.docNo ?? '', kind: je.sourceType,
      label: je.memo || '분개', accounts: [], lines: [] };
    event.accounts = [...new Set([...event.accounts, ...je.lines.map(line => String(line.accountCode))])];
    event.lines.push(...je.lines.map(line => ({ accountCode: String(line.accountCode), debit: line.debit ?? 0, credit: line.credit ?? 0 })));
    if (!original && sourceType !== 'manual') event.warning = '원본 확인 필요';
    if (invalid.has(sourceKey)) event.warning = `분개 확인 필요: ${invalid.get(sourceKey)}`;
    history.set(key, event);
    if (invalid.has(sourceKey) || (!original && sourceType !== 'manual')) continue;
    je.lines.forEach((line, index) => {
      // 대체의 선급·선수금에는 옛 분개가 거래처 ID를 달지 않았다. 원본 거래처가 있는
      // 채권·채무 계정만 읽기 중에 보완하고, 예금·매출·비용 상대변을 거래처 잔액으로 넘기지 않는다.
      const connected = line.partnerId === partnerId || (!line.partnerId && original?.partnerId === partnerId
        && sourceType === 'statement' && je.sourceType === '대체' && [STANDARD_ACCOUNT.PREPAID, STANDARD_ACCOUNT.ADVANCE_RECEIVED].some(code => code === String(line.accountCode)));
      if (!connected) return;
      rows.push({ key: `${key}:${je.id}:${index}`, eventKey: key, date: je.date, accountCode: String(line.accountCode),
        debit: line.debit ?? 0, credit: line.credit ?? 0,
        opening: (sourceType === 'statement' && String(original?.docNo ?? '').includes('기초'))
          || (sourceType === 'manual' && je.id === 'je-opening'),
      });
    });
  }
  for (const [key, reason] of invalid) {
    for (const event of history.values()) if (`${event.sourceType}:${event.sourceId}` === key)
      event.warning = `분개 확인 필요: ${reason}`;
  }
  return { history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)),
    rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)) };
}

/** 부호는 계정의 정상방향. 자산·부채·선급·선수를 한 순액으로 합치지 않는다. */
export function partnerAccountBalances(
  rows: ReturnType<typeof partnerAccountHistory>['rows'], accounts: AccountCode[], from = '', to = '',
) {
  const codes = [...new Set([...PARTNER_BALANCE_CODES, ...rows.map(row => row.accountCode)])].sort();
  const round = (amount: number) => {
    const rounded = Math.round(amount * 100) / 100;
    return rounded === 0 ? 0 : rounded;
  };
  return codes.map(code => {
    const account = accounts.find(a => String(a.code) === code);
    const normalBalance = account?.normalBalance ?? ([AP, OTHER_PAYABLE, STANDARD_ACCOUNT.ADVANCE_RECEIVED].includes(code) ? 'credit' : 'debit');
    const sign = normalBalance === 'credit' ? -1 : 1;
    const relevant = rows.filter(row => row.accountCode === code && (!to || row.date <= to));
    const opening = round(sign * relevant.filter(row => row.opening || (from && row.date < from))
      .reduce((n, row) => n + row.debit - row.credit, 0));
    const period = relevant.filter(row => !row.opening && (!from || row.date >= from));
    const debit = round(period.reduce((n, row) => n + row.debit, 0));
    const credit = round(period.reduce((n, row) => n + row.credit, 0));
    return { code, name: account?.name ?? ({ [AR]: '외상매출금', [AP]: '외상매입금', [OTHER_PAYABLE]: '미지급금', [STANDARD_ACCOUNT.PREPAID]: '선급금', [STANDARD_ACCOUNT.ADVANCE_RECEIVED]: '선수금' }[code] ?? '계정 미정'),
      normalBalance, opening, debit, credit, closing: round(opening + sign * (debit - credit)), rows: period };
  });
}

export interface PartnerLedgerRow {
  kind: '전표' | '결제';
  id: string;
  date: string;
  /**
   * 적요 — **무슨 거래였나.** 전표번호는 여기 안 섞는다(2026-09-03 사장님).
   * 전에는 `전표번호 || 적요` 한 칸이라, 번호가 있으면 적요가 안 보이고
   * 없으면 번호 자리에 적요가 앉아 무엇이 무엇인지 못 읽었다.
   */
  label: string;
  /** 전표번호 — 있으면 화면이 눌러서 그 전표를 연다 */
  docNo?: string;
  /** 그 전표·자금줄의 id — 눌렀을 때 찾아갈 곳 */
  sourceId?: string;
  /** 그날 안의 시각 'HH:MM:SS' — 소급이면 23:59:59, 예약이면 00:00:00 */
  time?: string;
  amount: number;         // 전표 = +발생(채권·채무 증가), 결제 = −상계
  balance: number;        // 이 행 직후 잔액
  /** 결제 출처 — 자금원장 매칭뿐이다(전표에 매다는 옛 경로는 걷어냈다) */
  source?: 'cash';
  /** 기초이월 줄인가 — 이번 기간에 새로 산 게 아니라 넘어온 잔액이다 */
  opening?: true;
}

export interface PartnerLedger {
  rows: PartnerLedgerRow[];
  /**
   * **기초이월은 발생에서 뺀다.**
   * 청양식품은 7/31 기초 58,494,500에 8/25 매입 16,080,000이 얹힌 것인데,
   * 둘을 뭉쳐 '발생 74,574,500'으로 보이니 8월에 5,800만원어치 새로 산 것처럼 읽혔다.
   * 넘어온 잔액과 이번에 산 것은 성격이 다르다 — 칸을 가른다.
   *
   *   기초 + 발생 − 결제 = 잔액
   */
  opening: number;        // 기초이월 (넘어온 잔액)
  accrued: number;        // 기초 뺀 발생 총액
  paid: number;           // 결제 총액
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
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  const stmtById = new Map(statements.map(s => [s.id, s]));
  const cashById = new Map(cashEntries.map(e => [e.id, e]));

  type Ev = { row: Omit<PartnerLedgerRow, 'balance'>; ts: string; order: number };
  const evs: Ev[] = [];
  for (const je of entries) {
    for (const l of je.lines ?? []) {
      if (!wantCodes.includes(String(l.accountCode)) || l.partnerId !== partnerId) continue;
      // 채권은 차변이 느는 것, 채무는 대변이 느는 것
      const amt = type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
      if (!amt) continue;
      const st = stmtById.get(je.sourceId ?? '');
      const ce = cashById.get(je.sourceId ?? '');
      const date = st?.tradeDate ?? ce?.date ?? je.date;
      //  기초이월 표식 — 손익 화면(ProfitAnalysis)이 쓰는 기준과 같다
      const isOpening = String(st?.docNo ?? '').includes('기초');
      evs.push({
        row: {
          kind: amt > 0 ? '전표' : '결제',
          id: `${je.id}__${l.accountCode}`,
          date,
          //  적요와 전표번호를 갈라 담는다 — 화면이 따로 보여준다
          label: ce?.note || st?.items?.slice(0, 2).map(i => i.name).filter(Boolean).join(', ')
                 || je.memo || (amt > 0 ? '발생' : '결제'),
          ...(st?.docNo ? { docNo: st.docNo } : ce?.docNo ? { docNo: ce.docNo } : {}),
          ...(je.sourceId ? { sourceId: je.sourceId } : {}),
          time: timeOfLocal(st?.issuedAt ?? ce?.createdAt),
          amount: amt,
          ...(ce ? { source: 'cash' as const } : {}),
          ...(isOpening && amt > 0 ? { opening: true as const } : {}),
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

  let running = 0, opening = 0, accrued = 0, paid = 0;
  const rows: PartnerLedgerRow[] = evs.map(({ row }) => {
    running += row.amount;
    if (row.amount <= 0) paid += -row.amount;
    else if (row.opening) opening += row.amount;   // 넘어온 잔액 — 이번에 산 게 아니다
    else accrued += row.amount;
    return { ...row, balance: running };
  });
  return { rows, opening, accrued, paid, balance: running };
}

/**
 * 전기간 원장을 날짜 범위로 잘라 **기간 시작 직전 잔액을 기초**로 다시 세운다.
 * 장부 개시용 기초 전표는 날짜가 범위 안이어도 당기 발생이 아니므로 언제나 기초에 포함한다.
 */
export function partnerLedgerForPeriod(
  ledger: PartnerLedger,
  from: string,
  to: string,
): PartnerLedger {
  if (!from || !to || from > to) return ledger;

  const opening = ledger.rows
    .filter(row => (row.opening && row.date <= to) || (!row.opening && row.date < from))
    .reduce((sum, row) => sum + row.amount, 0);
  const periodRows = ledger.rows.filter(row => !row.opening && row.date >= from && row.date <= to);
  let running = opening;
  const openingRow: PartnerLedgerRow = {
    kind: opening < 0 ? '결제' : '전표',
    id: `period-opening:${from}`,
    date: from,
    label: '기간 전 잔액',
    amount: opening,
    balance: opening,
    opening: true,
  };
  const rows = [openingRow, ...periodRows.map(row => {
    running += row.amount;
    return { ...row, balance: running };
  })];
  const accrued = periodRows.reduce((sum, row) => sum + (row.amount > 0 ? row.amount : 0), 0);
  const paid = periodRows.reduce((sum, row) => sum + (row.amount < 0 ? -row.amount : 0), 0);
  return { rows, opening, accrued, paid, balance: running };
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
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  return entries.reduce((a, e) => a + (e.lines ?? []).reduce((b, l) => {
    if (!wantCodes.includes(String(l.accountCode)) || l.partnerId !== partnerId) return b;
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
      else if (isPay(code)) bump(pid, 'payable', (l.credit ?? 0) - (l.debit ?? 0));
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
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  for (const l of journalizeStatement(s)?.lines ?? []) {
    if (!wantCodes.includes(String(l.accountCode))) continue;
    const moved = type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
    if (moved !== 0) return true;
  }
  const side = type === '매출' ? '차변' : '대변';
  return (s.items ?? []).some(it => wantCodes.includes(String(it.accountCode)) && it.side === side);
}

export function allocatePartnerCash(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[] = [],
  /**
   * **앵커에서 이어받은 시작 잔액** (전표 id → 그때 남아 있던 금액).
   *
   * 앵커 이전을 안 읽을 때 쓴다. 앵커에 담긴 미결 전표는 이미 얼마쯤 갚힌 상태라
   * 총액부터 다시 시작하면 그만큼 덜 갚은 것으로 보인다. 없으면 총액부터.
   */
  opening?: Map<string, number>,
): Map<string, number> {
  //  기초이월 전표도 후보에 넣는다 — 안 넣으면 그걸 갚은 수금이 새 전표를 갉아먹는다(isReceivableStmt 주석 참조).
  const eligible = statements
    .filter(s => s.partnerId === partnerId && isReceivableStmt(s, type))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
  const mine = eligible.filter(s => (opening?.get(s.id) ?? s.totalAmount ?? 0) > 0);
  const returnCredit = -eligible.reduce((sum, s) => sum + Math.min(0, opening?.get(s.id) ?? s.totalAmount ?? 0), 0);
  const left = new Map(mine.map(s => [s.id, opening?.get(s.id) ?? (s.totalAmount ?? 0)]));
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
  let rem = Math.max(0, partnerPaid(partnerId, type, cashEntries) - pinned + returnCredit);
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
    .filter(x => x.code === AR || isPay(x.code))
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
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  return cashEntries
    .filter(e => e.partnerId === partnerId)
    .reduce((a, e) => a + partnerCashParts(e)
      .reduce((b, p) => b + (wantCodes.includes(p.code) ? p.reduce : 0), 0), 0);
}

export function partnerBalances(
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  entries: JournalEntry[],
): { partnerId: string; partnerName: string; balance: number; count: number }[] {
  // 목록도 갈래가 아니라 **분개에 그 거래처의 108·251이 섰는가**로 모은다.
  // 갈래로 모으면 기초·상계만 있는 거래처가 목록에서 통째로 사라진다.
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  const withBalance = new Set<string>();
  for (const je of entries) for (const l of je.lines ?? []) {
    if (wantCodes.includes(String(l.accountCode)) && l.partnerId) withBalance.add(l.partnerId);
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

/**
 * **월별 실수금·실지불 — 통장에서 실제로 오간 돈만.**
 *
 * 예전엔 `settlements`(전표↔자금 매칭)를 더했는데, 그건 **전표에 매단 결제만** 담는다.
 * 전표에 안 매달고 자금원장에만 넣은 수금·지불은 줄 자체가 없다. 게다가 원본이 지워지면
 * `if (!s) continue; if (!e) continue;` 로 **말없이 건너뛴다**.
 * 2026-09-03 실측 — settlements 155줄 중 11줄(3,897만원)이 그렇게 사라지고 있었고,
 * 8월 값이 1억 9,872만으로 나왔다. 실제 통장에서 거래처로 오간 돈은 **5억 74만**이었다.
 *
 * 그래서 근거를 **자금원장 하나로** 옮긴다. 거래처가 붙고 채권·채무 계정으로 간 줄이
 * 곧 실수금·실지불이다. 거래처원장(`buildPartnerLedger`)과 같은 근거라 두 화면이 안 갈린다.
 *
 * ---
 * **상계는 여기 안 들어온다.** 미수·미지급 상계는 108 과 251 을 같이 줄이지만
 * 통장에서는 한 푼도 안 움직인다. 원장에서는 양쪽 다 '결제'로 잡히는 게 맞지만,
 * 그걸 현금으로 합산하면 **두 번 세어진다**(2026-08 에 4줄 6,795만원).
 * 상계는 `lines` 에 차·대를 직접 적은 **복합 줄**이라 위쪽 `accountCode` 가 없다.
 * 그래서 "계정 하나짜리 줄"만 세면 저절로 빠진다.
 * (`cashAccountId` 로는 못 가른다 — 지금 데이터는 204줄이 전부 비어 있다.)
 *
 * @returns 'YYYY-MM' → { inc 수금, out 지불 }
 */
export function cashPaidByMonth(cashEntries: CashEntry[]): Map<string, { inc: number; out: number }> {
  const out = new Map<string, { inc: number; out: number }>();
  for (const e of cashEntries) {
    if (!e.partnerId) continue;                       // 거래처가 없으면 채권·채무가 아니다
    //  복합 줄(lines)은 상계·대체다 — 통장이 안 움직인다
    if ((e.lines?.length ?? 0) > 0) continue;
    const code = String(e.accountCode ?? '');
    const isAR = code === AR, isAP = PAYABLES.includes(code);
    if (!isAR && !isAP) continue;
    const ym = String(e.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const amt = Number(e.amount) || 0;
    //  받은 게 수금, 준 게 지불 — 되돌린 건 음수로 깎는다
    const signed = e.dir === '입금' ? amt : -amt;
    const cur = out.get(ym) ?? { inc: 0, out: 0 };
    if (isAR) cur.inc += signed; else cur.out -= signed;
    out.set(ym, cur);
  }
  return out;
}
