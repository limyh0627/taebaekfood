import { PAYABLES, isPay } from '../financials/domain/partnerAccountCodes';
import { buildPartnerLedger } from '../financials/domain/partnerLedger';
export {partnerAccountHistory,partnerAccountBalances,PARTNER_BALANCE_CODES} from '../financials/domain/partnerAccountHistory';
export type {PartnerHistorySource} from '../financials/domain/partnerAccountHistory';
export {buildPartnerLedger,partnerLedgerForPeriod} from '../financials/domain/partnerLedger';
export type {PartnerLedgerRow,PartnerLedger} from '../financials/domain/partnerLedger';
export {settledAmount,openBalance,unsettledStatements,unmatchedCash,partnerOpenBalance,isReceivableStmt,allocatePartnerCash,partnerCashParts,partnerPaid} from '../financials/domain/partnerCashAllocation';
export type {ReadonlyReturnOperation,PartnerCashPart} from '../financials/domain/partnerCashAllocation';
import { CashAccount, CashEntry, IssuedStatement, JournalEntry } from '../../shared/types';
/**
 * 자금 원장(현금출납장) 순수 도메인 모듈 — 부수효과 없음(입력 → 값).
 *
 * 전표(issuedStatements)가 '거래가 발생했다'를 기록한다면, 여기는 '실제로 돈이 움직였다'를 기록한다.
 * 통장 한 줄 한 줄에 그 시점의 잔액이 찍히듯, CashEntry를 시간순으로 굴려 잔액을 만든다.
 */
import { buildAccountLedger, signedAmount } from '../../../functions/src/shared/cashAccountLedger';
import type { AccountLedger as SharedAccountLedger, LedgerRow as SharedLedgerRow } from '../../../functions/src/shared/cashAccountLedger';
export { buildAccountLedger, signedAmount };
export type LedgerRow = SharedLedgerRow<CashEntry>;
export type AccountLedger = SharedAccountLedger<CashAccount, CashEntry>;
/** 거래처 채권·채무 계정 — 이 둘만 거래처 잔액을 움직인다 */
//  계정코드는 [autoJournal](../../shared/autoJournal.ts) 한 곳에서 온다 —
//  손으로 옮겨 적으면 표준계정과목으로 옮길 때 한쪽만 고쳐진다(2026-09-05)
import { AR } from '../../shared/autoJournal';
/** 전 계좌의 현재 잔액 합계 — "오늘 우리 돈이 얼마인가" */
export function totalCashOnHand(accounts: CashAccount[], allEntries: CashEntry[], asOf: string): number {
  return accounts.reduce((sum, acc) => sum + buildAccountLedger(acc, allEntries, '', asOf).closing, 0);
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
