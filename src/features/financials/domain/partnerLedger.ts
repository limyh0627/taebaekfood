import { CashEntry, IssuedStatement, JournalEntry } from "../../../shared/types";
import { rowStamp, issuedMs, timeOfLocal } from "../../../shared/voucherStamp";
import { AR } from "../../../shared/autoJournal";
import { PAYABLES } from './partnerAccountCodes';

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
