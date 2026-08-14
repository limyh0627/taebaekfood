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
export function sortLedger<T extends Pick<RawMaterialEntry, 'date' | 'createdAt'>>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))
      || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
  );
}

/**
 * 한 줄을 적용한 뒤의 잔량 — **잔량 규칙은 이 함수 하나뿐이다.**
 * 화면(RawLedgerList)도 테스트도 이걸 부른다. 예전엔 화면 안에만 있어서 검증할 수가 없었다.
 *
 * @param density 옛 기록(unit='L')을 kg으로 되돌릴 밀도. 1이면 환산 안 함.
 */
export function applyLedgerRow(bal: number, e: RawMaterialEntry, density = 1): number {
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
