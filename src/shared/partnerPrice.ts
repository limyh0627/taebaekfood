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

/**
 * **이 품목이 어느 거래처에 걸려 있나.**
 *
 * 연결이 두 군데 살았다 — 옛 방식 `items.partnerIds` 와 지금 쓰는 `partner_item`.
 * 둘이 어긋나면서 동우 볶음참깨 주문이 10개입 대신 20개입으로 들어갔다(2026-09-06).
 * **근거는 `partner_item` 하나다.** `partnerIds` 는 걷어냈다.
 *
 * `SMARTSTORE` 는 거래처가 아니라 **채널 표식**이라 `items.partnerIds` 에 남아 있다 —
 * 그건 이 함수가 안 본다(부르는 쪽이 따로 본다).
 */
export function partnersOfItem(
  partnerItems: readonly PartnerItem[] | undefined,
  itemId: string,
): string[] {
  return [...new Set((partnerItems ?? [])
    .filter(p => p.itemId === itemId && !isPurchaseLine(p))
    .map(p => p.partnerId)
    .filter(Boolean))];
}

/** 이 거래처가 이 품목을 주문할 수 있나 — 판매 연결이 있으면 된다. */
export const isLinkedToPartner = (
  partnerItems: readonly PartnerItem[] | undefined,
  partnerId: string,
  itemId: string,
): boolean => (partnerItems ?? []).some(p =>
  p.itemId === itemId && p.partnerId === partnerId && !isPurchaseLine(p));

/**
 * **품목 → 그 품목을 파는 거래처 이름들** — 한 번 만들어 두고 쓴다.
 *
 * 2026-09-09 사장님: "여기있는 품목명 검색이 왤케 느리냐".
 *
 * 품목관리 검색이 거래처 이름으로도 찾게 돼 있는데, 그걸 이렇게 짜고 있었다 —
 *
 *     result.filter(p => 이름에걸리나(p)
 *       || partners.some(c => isLinkedToPartner(partnerItems, c.id, p.id) && ...))
 *
 * `isLinkedToPartner` 는 안에서 `partnerItems` 를 통째로 훑는다. 그래서 한 글자 칠 때마다
 * **품목 × 거래처 × 거래처단가**를 돌았다 — 536 × 317 × 1,267 = **2억 번**이다(2026-09-09 실측).
 *
 * 표를 미리 만들면 검색은 품목 수만큼만 돈다. **2억 번 → 536번.**
 *
 * 돌려주는 값은 **소문자로 이어 붙인 한 줄**이다 — 부르는 쪽이 `includes` 한 번만 하면 된다.
 */
export function partnerNamesByItem(
  partnerItems: readonly PartnerItem[] | undefined,
  partners: readonly { id: string; name?: string }[] | undefined,
): Map<string, string> {
  const 이름 = new Map<string, string>();
  for (const c of partners ?? []) if (c.id) 이름.set(c.id, String(c.name ?? '').toLowerCase());

  const out = new Map<string, string[]>();
  for (const p of partnerItems ?? []) {
    if (isPurchaseLine(p)) continue;             // 매입 연결은 '파는 거래처'가 아니다
    const n = 이름.get(p.partnerId);
    if (!p.itemId || !n) continue;
    const arr = out.get(p.itemId);
    if (arr) { if (!arr.includes(n)) arr.push(n); } else out.set(p.itemId, [n]);
  }
  return new Map([...out].map(([id, names]) => [id, names.join(' ')]));
}

/**
 * **이 품목을 스마트스토어에서 파는가.**
 *
 * 표시가 **두 군데로 갈려 있었다** — 품목의 `isSmartStore` 스위치와,
 * 거래처 연결 배열에 끼워 넣은 `'SMARTSTORE'` 딱지다. 화면마다 보는 게 달라서
 * 주문 넣기(AddOrderModal)는 스위치만 보고, 붙여넣기(PasteOrderModal)와
 * 매출 분석은 둘 다 봤다 — **같은 품목이 화면에 따라 나왔다 안 나왔다 했다**.
 *
 * 스위치가 새 방식이다. 옛 딱지는 아직 품목에 남아 있어 같이 본다.
 */
export const isSmartStoreItem = (
  item: { isSmartStore?: boolean; partnerIds?: readonly string[] } | undefined,
): boolean => item?.isSmartStore === true || (item?.partnerIds ?? []).includes('SMARTSTORE');

/**
 * **과세·면세는 거래처–품목 연결이 안다** (2026-09-06 사장님: "품목에 과세 면세 정보가
 * 없는게 맞는거 같다니까 그냥 거래처-품목 연결 테이블에 있으면 되는거 아니야?").
 *
 * 맞다. 품목에도 `taxType` 이 있었는데, 원가에서 ×1.1을 걷어낸 뒤로는 할 일이 없어졌다.
 * 남은 쓰임은 전부 **"이 판매가에 부가세가 붙어 있나"** 였고 그건 거래처마다 다르다 —
 * 화면들이 거래처 단가를 보여주면서 면세 여부만 품목에서 읽어 어긋나 있었다.
 *
 * 연결이 없거나 안 정했으면 **과세로 본다** — 안 정한 것을 면세로 보면 세금이 조용히 빠진다.
 */
export const isSaleTaxExempt = (
  partnerItems: readonly PartnerItem[] | undefined,
  itemId: string,
  partnerId?: string,
): boolean => {
  const 줄 = (partnerItems ?? []).filter(p =>
    p.itemId === itemId && !isPurchaseLine(p) && (!partnerId || p.partnerId === partnerId));
  if (partnerId) return 줄[0]?.taxType === '면세';
  //  거래처를 안 짚었으면 **가장 싼 단가**의 줄을 본다 — 마진을 제일 나쁜 경우로 잡는 것과 짝이다.
  const 싼줄 = 줄
    .filter(p => Number.isFinite(Number(p.price)) && Number(p.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price))[0];
  return (싼줄 ?? 줄[0])?.taxType === '면세';
};
