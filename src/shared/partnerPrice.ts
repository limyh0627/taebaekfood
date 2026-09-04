import type { PartnerItem } from './types';

//  **거래처별 단가를 뽑는 곳은 여기 하나다.**
//  판매단가는 품목이 아니라 **거래처마다** 다르다(`partner_item`). 그런데 그걸 찾는
//  코드가 QuotationManager·TradeStatement·orderUnits 에 따로 적혀 있었고, 어디는
//  `Direction !== 'in'`, 어디는 `Direction === 'out'` 으로 갈렸다.
//  **지금은 두 방식의 답이 같다** — 1,243줄이 다 'in'(216) 아니면 'out'(1,027)이고
//  빈 줄은 없다(2026-09-04 실측). 갈린 채로 두면 빈 줄이 하나 생기는 날 갈린다.

/** 매입(공급) 줄인가. 'in' 만 매입이고, 비어 있으면 판매로 본다(옛 줄이 그렇다). */
export const isPurchaseLine = (p: Pick<PartnerItem, 'Direction'>) => p.Direction === 'in';

/**
 * 이 거래처에 이 품목을 파는 단가. 없으면 undefined —
 * **0 을 돌려주지 않는다.** 0 은 "공짜"고 undefined 는 "모른다"라 뜻이 다르다.
 */
export function salePriceOf(
  partnerItems: readonly PartnerItem[] | undefined,
  partnerId: string,
  itemId: string,
): number | undefined {
  const hit = (partnerItems ?? []).find(
    p => p.itemId === itemId && p.partnerId === partnerId && !isPurchaseLine(p));
  const v = Number(hit?.price ?? NaN);
  return Number.isFinite(v) ? v : undefined;
}

/** 이 거래처에서 이 품목을 사 오는 단가. */
export function purchasePriceOf(
  partnerItems: readonly PartnerItem[] | undefined,
  partnerId: string,
  itemId: string,
): number | undefined {
  const hit = (partnerItems ?? []).find(
    p => p.itemId === itemId && p.partnerId === partnerId && isPurchaseLine(p));
  const v = Number(hit?.price ?? NaN);
  return Number.isFinite(v) ? v : undefined;
}

export interface PriceRange { min: number; max: number; count: number }

/**
 * 이 품목이 거래처들에게 팔리는 단가의 폭.
 * 품목 하나에 값 하나가 없으니(거래처마다 다르다) **범위로 본다** —
 * 품목 단가 화면이 죽은 `items.price` 대신 이걸 쓴다.
 * 파는 곳이 없으면 null.
 */
export function salePriceRange(
  partnerItems: readonly PartnerItem[] | undefined,
  itemId: string,
): PriceRange | null {
  const 값 = (partnerItems ?? [])
    .filter(p => p.itemId === itemId && !isPurchaseLine(p))
    .map(p => Number(p.price ?? NaN))
    .filter(v => Number.isFinite(v) && v > 0);
  if (값.length === 0) return null;
  return { min: Math.min(...값), max: Math.max(...값), count: 값.length };
}
