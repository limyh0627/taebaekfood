/** 매입 원가는 발행된 공급가액을 양수 수량으로 나눈다. */
export type PurchaseCostFallback = 'gross-first' | 'supply-first';
export function costFromPurchaseLine(line: {
  qty?: number; supply?: number; price?: number; isTaxExempt?: boolean;
}, fallback: PurchaseCostFallback = 'gross-first'): number | null {
  const qty = Number(line.qty ?? 0);
  const supply = Number(line.supply ?? NaN);
  if (qty > 0 && Number.isFinite(supply)) return Math.round(supply / qty);
  const price = Number(line.price ?? 0);
  if (!(price > 0)) return null;
  // 앱은 단가 합계를 먼저 반올림하고, 기존 서버는 공급가를 먼저 계산한다.
  const gross = fallback === 'gross-first' ? Math.round(price) : price;
  return line.isTaxExempt ? Math.round(gross) : Math.round(gross / 1.1);
}
