/**
 * 전표 시각 — 그날 안에서 **어디에 설 것인가**.
 *
 * 전표는 날짜(tradeDate·date)만 받고 시각은 발행한 순간이 자동으로 붙는다. 그런데
 * 날짜와 발행 순간이 갈리면 하루 안의 순서가 엉뚱해진다.
 *
 *   8/6자 전표를 8/20 오전 9시에 끊으면 → 8/6 09:00에 선다.
 *   그날 07:47에 있던 기록들보다 뒤라 맞지만, 8시에 끊었으면 그 사이에 끼어든다.
 *   발행한 시각은 그날 일어난 일과 아무 상관이 없는데 순서를 정해 버린다.
 *
 * 그래서 날짜가 오늘이 아니면 시각을 **뜻대로** 잡는다.
 *
 *   지난 날짜로 끊는다(소급)   그날 맨 뒤   23:59:59   나중에 알게 된 것이니 뒤에 붙는다
 *   앞선 날짜로 미리 끊는다     그날 맨 앞   00:00:00   그날이 오면 처음부터 서 있어야 한다
 *   오늘                       지금 시각               있는 그대로
 *
 * 타임라인이 시각을 **로컬**로 읽으므로(timeOf) 로컬 기준으로 만들어 ISO로 저장한다.
 */

/** 로컬 기준 오늘 (YYYY-MM-DD) */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 전표 날짜 → 저장할 시각(ISO).
 * @param date 전표 날짜 'YYYY-MM-DD'
 */
export function stampFor(date: string, now: Date = new Date()): string {
  const d = (date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return now.toISOString();
  const today = localToday(now);
  if (d < today) return new Date(`${d}T23:59:59`).toISOString();   // 소급 — 그날 맨 뒤
  if (d > today) return new Date(`${d}T00:00:00`).toISOString();   // 예약 — 그날 맨 앞
  return now.toISOString();                                        // 오늘 — 지금
}
