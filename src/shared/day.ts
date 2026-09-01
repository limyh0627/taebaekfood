/**
 * **달력 날짜 셈 — 'YYYY-MM-DD' 문자열만 다룬다.**
 *
 * `new Date('2026-12-31T00:00:00')`는 **그 자리 시간**의 자정이고, `toISOString()`은
 * 그걸 UTC로 되돌린다. 한국(UTC+9)에서는 전날 15:00Z가 되어 `slice(0,10)`이 **하루 앞**을
 * 준다. 그래서 "하루 더하기"가 조용히 제자리걸음을 한다.
 *
 * 실제로 세 군데가 그 함정에 빠져 있었다 — 견적서 유효기한, 주문 배송일 계산,
 * 거래처 앵커의 '앵커 다음 날'. 눈에 안 띄는 자리라 한 번 틀리면 오래 간다.
 *
 * 그래서 **Date를 UTC로만 쓴다.** 시각이 아니라 달력 칸을 세는 것이라 시간대가 낄 자리가 없다.
 */

const RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** 오늘 — **그 자리 시간 기준**. UTC로 찍으면 한국 아침에 어제가 나온다. */
export const today = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 'YYYY-MM-DD'에 며칠 더하기(음수면 빼기). 형식이 아니면 그대로 돌려준다. */
export function addDays(date: string, n: number): string {
  const m = RE.exec(String(date ?? ''));
  if (!m) return String(date ?? '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM'에 몇 달 더하기(음수면 빼기). 말일은 안 넘어간다 — 달만 센다. */
export function addMonths(ym: string, n: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
  if (!m) return String(ym ?? '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 그 달의 말일 — 'YYYY-MM' → 'YYYY-MM-DD' */
export function endOfMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
  if (!m) return String(ym ?? '');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
}
