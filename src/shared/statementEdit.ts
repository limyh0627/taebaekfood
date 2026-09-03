import type { CashEntry, IssuedStatement } from './types';
import { stampFor } from './voucherStamp';

/**
 * **전표를 고칠 때 거래일이 바뀌면 시각 도장도 다시 찍는다.**
 *
 * 끊을 때는 `stampFor(tradeDate)` 로 제대로 찍는다 — 소급이면 23:59:59(그날 맨 뒤),
 * 예약이면 00:00:00(그날 맨 앞), 오늘이면 지금. 그런데 **고칠 때는 거래일만 쓰고
 * `issuedAt` 은 그대로 뒀다.** 그래서 날짜를 옮긴 전표가 옛 날짜의 시각을 그대로 달고 있다.
 *
 * 실제로 그런 전표가 있다(2026-09-03 실측) —
 *
 *   260827-12  거래일 2026-08-28  issuedAt 2026-08-27T14:59:59Z (= 8/27 23:59:59)
 *   260826-03  거래일 2026-08-25  issuedAt 2026-08-26T07:15:11Z (= 8/26 16:15, 만든 시각 그대로)
 *
 * `issuedAt` 은 **그날 안에서 어디에 설 것인가**만 뜻한다(`rowStamp` 이 날짜는 tradeDate 에서,
 * 시각은 여기서 가져다 붙인다). 날짜가 옮겨졌는데 시각이 안 따라가면 원장에서 엉뚱한
 * 자리에 선다 — 소급인데 그날 한복판에 끼어들거나, 예약인데 맨 뒤로 간다.
 *
 * 신원(id·전표번호)이 아니라 **정렬 기준**이라 다시 찍어도 잃는 게 없다.
 * 전표번호(docNo)는 다르다 — 인쇄해서 건넨 종이에 박혀 있을 수 있어 여기서 안 건드린다.
 */
export function statementEditPatch(
  data: Partial<IssuedStatement>,
  current: Pick<IssuedStatement, 'tradeDate'> | undefined,
  now = new Date(),
): Partial<IssuedStatement> {
  const next = String(data.tradeDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return data;
  if (current && String(current.tradeDate ?? '').slice(0, 10) === next) return data;
  return { ...data, issuedAt: stampFor(next, now) };
}

/**
 * 전표번호에 박힌 날짜가 거래일과 다른가 — 고친 뒤 번호가 안 따라간 자리.
 * 번호는 함부로 다시 매기지 않으니(인쇄된 종이) **드러내기만** 한다.
 */
export function docNoDateMismatch(s: Pick<IssuedStatement, 'docNo' | 'tradeDate'>): boolean {
  const m = /^(.*?)(\d{6})-(\d+)$/.exec(String(s.docNo ?? ''));
  if (!m) return false;
  return m[2] !== String(s.tradeDate ?? '').slice(2).replace(/-/g, '');
}

/**
 * 자금원장 한 줄도 같다 — **날짜(`date`)가 바뀌면 `createdAt` 을 다시 찍는다.**
 * 전표와 칸 이름만 다르고 뜻은 하나다(`rowStamp(e.date, e.createdAt)`).
 * 실측에서 여기도 24줄이 어긋나 있었다.
 */
export function cashEditPatch(
  data: Partial<CashEntry>,
  current: Pick<CashEntry, 'date'> | undefined,
  now = new Date(),
): Partial<CashEntry> {
  const next = String(data.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return data;
  if (current && String(current.date ?? '').slice(0, 10) === next) return data;
  return { ...data, createdAt: stampFor(next, now) };
}
