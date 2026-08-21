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

/**
 * 저장된 ISO → **로컬** 'HH:MM:SS'.
 *
 * ISO 문자열을 그냥 잘라 쓰면(slice(11,19)) UTC 시각이 나온다. 우리는 KST(+9)라
 * 오전 9시 전에 만든 기록은 UTC로 전날 15:00~23:59가 되어, 소급 도장(23:59:59 로컬 =
 * 14:59:59Z)보다 **뒤로** 밀린다. 소급 전표가 그날 맨 뒤라는 규칙이 깨진다.
 */
export function timeOfLocal(iso?: string): string {
  if (!iso) return '00:00:00';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00:00:00';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * 원장 한 줄의 정렬 기준 — **전표일 + 그날 안의 시각**.
 *
 * 날짜만으로 정렬하면 같은 날 안에서는 읽어온 순서가 그대로 나온다. 그래서 소급으로 끊은
 * 전표가 그날 먼저 있던 기록 위로 끼어들고, 새로고침할 때마다 자리가 바뀌기도 한다.
 * 도장(stampFor)이 소급을 23:59:59로 찍어 두는 뜻이 정렬에서 살아나려면 여기를 써야 한다.
 *
 * @param date  전표일 'YYYY-MM-DD' (tradeDate·date)
 * @param iso   실제 기록 시각 (issuedAt·createdAt)
 */
export function rowStamp(date: string, iso?: string): string {
  return `${(date ?? '').slice(0, 10)}T${timeOfLocal(iso)}`;
}

/**
 * 같은 시각이면 누가 먼저인가 — **끊은 순서.**
 *
 * id에 만든 순간(ms)이 박혀 있다: `stmt-1787126648824`, `cash-1787287653405-offset`.
 * 소급 전표는 시각이 전부 23:59:59라, 그날 안에서는 이 순서가 유일한 근거다.
 *
 * **문서번호(docNo)로는 못 가른다.** 번호를 '전표 개수 + 1'로 매겨서 실제로 겹친다 —
 * 2026-08-0185가 용두쭈구미와 한중교역 둘 다에 붙어 있다(2026-08 기준 13쌍이 중복).
 * 번호는 사람이 부르는 이름이고, 순서를 아는 건 id다.
 *
 * 옛 기록처럼 id에 ms가 없으면 0 — 그 뒤 비교로 넘어간다.
 */
export function issuedMs(id?: string): number {
  const m = /(\d{13})/.exec(id ?? '');
  return m ? Number(m[1]) : 0;
}

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

/**
 * 문서번호 — **전표일(YYMMDD) + 그날 순번.**  `260821-01`
 *
 * 전에는 `${YYYY-MM}-${전표 총개수 + 1}` 이었다. 총개수는 순번이 아니다 —
 *
 *   · 전표를 하나 지우면 개수가 줄어 **다음 전표가 지워진 번호를 다시 쓴다.**
 *   · 화면이 들고 있는 목록으로 세니, 새로고침 전에 연달아 끊으면 같은 개수를 본다.
 *
 * 그래서 2026-08-0185가 용두쭈구미와 한중교역 둘에 붙었다(2026-08에만 13쌍).
 * 번호가 겹치면 그 번호로는 어느 전표인지 못 가리고, 순서도 못 읽는다.
 *
 * 지금은 **그날 쓰인 가장 큰 번호 + 1**이다. 날짜가 접두사라 다른 날과 절대 안 겹치고,
 * 지운 번호를 다시 쓰지 않는다(빈 번호는 지워진 자리라는 뜻으로 남는다).
 *
 * @param date     전표일 'YYYY-MM-DD'
 * @param existing 이미 있는 전표들 (docNo만 본다)
 * @param prefix   갈래 접두사 — 반품·대체처럼 따로 세는 것
 */
export function nextDocNo(
  date: string,
  existing: { docNo?: string }[],
  prefix = '',
): string {
  const d = (date ?? '').slice(0, 10);
  const ymd = d.length === 10 ? d.slice(2).replace(/-/g, '') : d;   // 2026-08-21 → 260821
  const head = `${prefix}${ymd}-`;
  let max = 0;
  // 그날 쓰인 가장 큰 번호를 찾는다 — 개수를 세면 지운 자리를 다시 쓴다
  for (const s of existing) {
    const no = s.docNo ?? '';
    if (!no.startsWith(head)) continue;
    const tail = no.slice(head.length);
    if (!/^[0-9]+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}
