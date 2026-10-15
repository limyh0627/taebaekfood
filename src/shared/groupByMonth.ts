/**
 * **월별로 묶기.**
 *
 * 주문카드·발주카드가 각자 적어 두고 있었다(2026-09-05). 묶는 규칙은 같은데
 * 날짜를 어디서 읽을지만 달랐다 — 주문은 납기(없으면 등록일), 발주는 등록일.
 *
 * **최신 달이 위로** 온다. 달 안에서도 최신이 위다 — 오늘 것을 찾으러 오는 화면이다.
 * 부수효과 없음(입력 → 값).
 */
export interface MonthGroup<T> {
  /** 'YYYY-MM'. 날짜를 못 읽으면 '미정' */
  month: string;
  rows: T[];
}

export function groupByMonth<T>(rows: readonly T[], dateOf: (r: T) => string, monthDateOf: (r: T) => string = dateOf): MonthGroup<T>[] {
  const m = new Map<string, { key: string; rows: T[] }>();
  //  달 안 순서를 여기서 못 박는다 — 안 그러면 읽어온 순서를 그대로 쓴다
  const sorted = [...rows].sort((a, b) => (dateOf(b) || '').localeCompare(dateOf(a) || ''));
  for (const r of sorted) {
    // 표시 월만 로컬 날짜로 바꿔도 같은 날의 시각 순서는 원문 기준으로 유지한다.
    const key = (monthDateOf(r) || '').slice(0, 7) || '미정';
    if (!m.has(key)) m.set(key, { key, rows: [] });
    m.get(key)!.rows.push(r);
  }
  return [...m.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map(g => ({ month: g.key, rows: g.rows }));
}
