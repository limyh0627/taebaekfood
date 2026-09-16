import type { RawMaterialEntry } from './types';

/**
 * **실제 원장**(rawMaterialLedger)의 잔량 계산 — 첫 줄부터 누적한다.
 *
 * 화면(RawLedgerList)이 줄마다 보여주는 '잔량'이 이 값이다.
 * 실사 줄(targetKg)을 만나면 여태 더해온 값을 **버리고 그 숫자부터 다시 센다**(앵커).
 * 그래서 그 이전의 누적 오차가 거기서 끊긴다.
 *
 * 이 값은 언제나 그 원료의 **로트 합계(=items.stock)와 같아야 한다.**
 * 실제 원장의 줄과 로트 변화는 1:1이기 때문이다. 어긋나면 한쪽만 움직인 경로가 있다는 뜻이다.
 */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 날짜 → 기록시각 순. 같은 날 여러 줄이면 들어온 순서가 잔량을 가른다. */
export function sortLedger<T extends Pick<RawMaterialEntry, 'date' | 'createdAt' | 'recordedAt' | 'sequence' | 'id'>>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))
      // 원자화된 줄은 recordedAt, 옛 줄은 createdAt을 쓴다. 한쪽만 보면 같은 날의 실사 앵커가
      // 옛 사용 기록보다 앞으로 정렬되어 그 사용량을 두 번 차감한다(깨분참기름 41.555kg 사고).
      || String(a.recordedAt ?? a.createdAt ?? '').localeCompare(String(b.recordedAt ?? b.createdAt ?? ''))
      // 같은 시각이면 번호순 — 여기서 손을 놓으면 읽어온 순서를 쓰게 되고,
      // 실사(targetKg)가 잔량을 덮어쓰는 앵커라 순서 한 칸에 숫자가 통째로 달라진다.
      || String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true }),
  );
}

/**
 * 한 줄을 적용한 뒤의 잔량 — **잔량 규칙은 이 함수 하나뿐이다.**
 * 화면(RawLedgerList)도 테스트도 이걸 부른다. 예전엔 화면 안에만 있어서 검증할 수가 없었다.
 *
 * @param density 옛 기록(unit='L')을 kg으로 되돌릴 밀도. 1이면 환산 안 함.
 */
export function applyLedgerRow(bal: number, e: RawMaterialEntry, density = 1): number {
  // 원자화 기록은 트랜잭션 직후 확정 잔량을 함께 저장한다. 과거 legacy 줄과 섞인 원장을
  // 입고-사용으로 다시 계산하면 이관 기준값에 이미 포함된 사용량을 두 번 뺄 수 있다.
  if (Number.isFinite(e.balanceAfterKg)) return round3(Number(e.balanceAfterKg));
  if (e.targetKg != null) return Number(e.targetKg);   // 실사 = 앵커. 여태 누적을 버리고 이 값부터 다시.
  const toKg = (v: number) => (e.unit === 'L' && density !== 1 ? v * density : v);
  return round3(bal + toKg(e.received ?? 0) - toKg(e.used ?? 0));
}

/**
 * 마지막 잔량(kg).
 * @param density 옛 기록(unit='L')을 kg으로 되돌릴 밀도. 1이면 환산 안 함.
 */
export function ledgerBalanceKg(entries: RawMaterialEntry[], density = 1): number {
  let bal = 0;
  for (const e of sortLedger(entries)) bal = applyLedgerRow(bal, e, density);
  return bal;
}

/**
 * 원자화 이후 원장의 확정 잔량. 원자화 줄은 트랜잭션이 적용된 직후의 잔량을
 * `balanceAfterKg`로 남기므로, 과거 legacy 줄을 날짜순으로 다시 더하는 것보다 이 값이 우선이다.
 * 원자화 줄이 아직 없는 원료만 예전 누적 계산을 사용한다.
 */
export function authoritativeLedgerBalanceKg(entries: RawMaterialEntry[], density = 1): number {
  const atomic = entries
    .filter((e): e is RawMaterialEntry & { balanceAfterKg: number } => Number.isFinite(e.balanceAfterKg))
    .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
      || String(a.recordedAt ?? a.createdAt ?? '').localeCompare(String(b.recordedAt ?? b.createdAt ?? ''))
      || String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true }));
  return atomic.length ? round3(Number(atomic[atomic.length - 1].balanceAfterKg)) : ledgerBalanceKg(entries, density);
}

/**
 * 그 원료의 **마지막 실사 앵커 날짜**(YYYY-MM-DD). 앵커가 없으면 null.
 *
 * 앵커는 그날 창고에 실제로 있던 양을 센 값이라, **그 이전에 일어난 일은 이미 그 안에 들어 있다.**
 * 그래서 앵커보다 앞선 날짜의 사용·입고를 뒤늦게 입력하면
 *   · 원장 잔량은 앵커가 잡아줘서 안 움직이는데
 *   · 로트는 앵커를 모르니 그대로 깎이거나 늘어서
 * 둘이 벌어진다. 참깨가 이 경우였다(8/20 앵커 1,650 뒤에 8/17·8/19자 사용 1,260을 넣어 로트만 깎임).
 *
 * → 부르는 쪽은 `isBackdated()`로 걸러서 **로트를 건드리지 않는다**. 원장 줄은 그대로 남긴다
 *   (사용량이 서류에 잡혀야 하고, 잔량은 어차피 앵커가 잡는다).
 */
export function latestAnchorDate(entries: RawMaterialEntry[]): string | null {
  let latest: string | null = null;
  for (const e of entries) {
    if (e.targetKg == null) continue;
    const d = String(e.date ?? '');
    if (d && (latest == null || d > latest)) latest = d;
  }
  return latest;
}

/** 입력한 날짜가 마지막 앵커보다 앞이냐 — 앞이면 로트를 건드리면 안 된다. */
export function isBackdated(entries: RawMaterialEntry[], date: string): boolean {
  const anchor = latestAnchorDate(entries);
  return anchor != null && String(date ?? '') < anchor;
}
