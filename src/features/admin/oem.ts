import { PurchaseOrder } from '../../shared/types';

/**
 * OEM(임가공) 순수 도메인 모듈 — 부수효과 없음(입력 → 값). 단위 테스트 용이.
 *
 * 우리 원료를 외주공장에 보내(발주) 가공받아 완제품으로 돌려받는다(가공입고).
 * 원료는 여전히 우리 소유라 본재고→외주재고로 이동만 하고, 가공입고 때 완제품으로 변환된다.
 * 실제 재고 쓰기(로트·수불부·전표)는 호출부에서 하고, 여기서는 금액·수량 계산만.
 */

/** 내보낸 원료 총 kg (다종이면 합산) */
export function sentKg(sent: { material: string; kg: number }[] | undefined): number {
  return (sent ?? []).reduce((a, s) => a + (s.kg || 0), 0);
}

/**
 * 수율손실 = 보낸 원료 − 받은 완제품(kg). 음수면 0(받은 게 더 많을 순 없다고 보고 0으로 클램프).
 * 다종 원료는 배합 후라 원료별 귀속이 불가능 → 총량 기준 집계.
 */
export function batchLoss(sent: { material: string; kg: number }[] | undefined, receivedKg: number): number {
  const loss = sentKg(sent) - (receivedKg || 0);
  return loss > 0 ? Math.round(loss * 1000) / 1000 : 0;
}

/** 수율(%) = 받은 / 보낸 × 100. 보낸 게 0이면 undefined. */
export function yieldRate(sent: { material: string; kg: number }[] | undefined, receivedKg: number): number | undefined {
  const s = sentKg(sent);
  if (s <= 0) return undefined;
  return Math.round((receivedKg / s) * 1000) / 10;
}

export interface ProcessingFee {
  supply: number;   // 공급가 = 받은 총 kg × kg단가
  tax: number;      // 세액 (과세 10%)
  total: number;    // 합계
}

/**
 * 가공비 전표 금액. 외주가공비는 과세(세금계산서 수취) → 공급가 + 세액 분리.
 * @param taxable false면 면세(세액 0) — 기본 과세.
 */
export function processingFee(receivedKg: number, unitPricePerKg: number, taxable = true): ProcessingFee {
  const supply = Math.round((receivedKg || 0) * (unitPricePerKg || 0));
  const tax = taxable ? Math.round(supply * 0.1) : 0;
  return { supply, tax, total: supply + tax };
}

/** OEM 배치의 현재 외주 잔량(kg) — status가 sent면 보낸 전량, received면 0. 열린 배치 합이 외주재고. */
export function outstandingKg(po: PurchaseOrder): number {
  if (po.poType !== 'oem') return 0;
  return po.status === 'received' ? 0 : sentKg(po.oemSent);
}

/** 지금 외주 나가 있는 원료별 kg — 열린 OEM 배치들을 원료별로 합산. "외주재고 현황". */
export function subcontractStockByMaterial(purchaseOrders: PurchaseOrder[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const po of purchaseOrders) {
    if (po.poType !== 'oem' || po.status === 'received') continue;
    for (const s of po.oemSent ?? []) acc[s.material] = (acc[s.material] ?? 0) + (s.kg || 0);
  }
  return acc;
}
