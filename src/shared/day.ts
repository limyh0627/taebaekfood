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

/**
 * **저장된 시각(ISO) → 그 자리 시간의 날짜.**
 *
 * 이 앱은 시간을 **로컬(KST) 하나로만** 읽고 쓴다(2026-09-03 사장님 지시).
 * 저장은 ISO(UTC)로 하지만 **읽을 때 UTC로 자르면 안 된다** —
 * `'2026-08-03T15:00:00Z'.slice(0,10)` 은 `2026-08-03` 인데 한국에서는 **8월 4일**이다.
 * 밤 9시(=12:00Z) 이후에 만든 기록이 전부 하루 앞으로 밀린다.
 *
 * 실측(2026-09-03) — 주문 만든날 75줄, 생산일 11줄, 전표 도장 22줄이 그렇게 밀려 있었다.
 * 배송완료일(서류 넷의 기준일)은 0줄이라 서류는 안 움직였다. 운이 좋았던 것이다.
 *
 * 이미 'YYYY-MM-DD' 인 값은 그대로 돌려준다 — 날짜 칸과 시각 칸을 같이 받는 자리가 많다.
 *
 * 짝은 `timeOfLocal`(같은 파일) — 날짜는 여기, 시각은 거기, **둘 다 로컬이다.**
 */
export function dateOfLocal(iso?: string): string {
  const v = String(iso ?? '');
  if (!v) return '';
  if (!v.includes('T')) return v.slice(0, 10);   // 이미 날짜다
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * **저장된 시각(ISO) → 그 자리 시간의 'HH:MM:SS'.**
 * `slice(11,19)` 로 자르면 UTC 라, 아침에 만든 기록이 전날 밤으로 읽힌다.
 * 전에 `voucherStamp` 에 있던 것을 날짜와 한집에 모았다 — **시간 기준은 하나여야 한다.**
 */
export function timeOfLocal(iso?: string): string {
  if (!iso) return '00:00:00';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00:00:00';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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

/** 'YYYY-MM-DD' — 로컬 기준. UTC 로 자르면 자정 근처에서 하루가 밀린다. */
const fmtLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

//  기간 빠른선택 — 화면마다 "금주"가 다르면 안 된다. **월요일 시작 고정**이다.
//  (전에는 TradeStatement 안에만 있었다, 2026-09-05)

/** 이번 주 월요일 */
export const weekMonday = (now = new Date()): string => {
  const d = new Date(now);
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  return fmtLocalDate(d);
};

/** 이번 주 일요일 */
export const weekSunday = (now = new Date()): string => {
  const d = new Date(now);
  d.setDate(d.getDate() + (d.getDay() === 0 ? 0 : 7 - d.getDay()));
  return fmtLocalDate(d);
};

/** 이번 달 1일 */
export const monthStart = (now = new Date()): string =>
  fmtLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));

/** 이번 달 말일 */
export const monthEnd = (now = new Date()): string =>
  fmtLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

/** 올해 1월 1일 */
export const yearStart = (now = new Date()): string => `${now.getFullYear()}-01-01`;
