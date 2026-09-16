import type { Partner, PartnerItem, ShipTo } from './types';

/**
 * **배송지 — 한 거래처 안에서 물건이 갈라져 가는 곳.**
 *
 * 2026-09-16 사장님: "포천은 배송지가 다른거고 쿠팡 네이버커머스는 해피유통 내의
 * 판매채널인데", "우리 기준으로는 그냥 배송지가 다르다고 보는게 맞아".
 *
 * ---
 * **규칙 하나로 갈린다: 거래처는 돈 받을 상대다.**
 *
 * 해피유통이 쿠팡에서 팔든 네이버에서 팔든 **우리는 해피유통한테 판다.** 쿠팡은 돈을
 * 안 준다. 채널은 그 집 사정이지 우리 장부의 축이 아니다. 우리가 실제로 다르게 하는 일은
 * **물건을 어디로 보내느냐** 하나뿐이라, 셋 다 배송지로 본다(쿠팡 물류센터·네이버
 * 물류센터·포천).
 *
 * 그래서 축은 둘이다:
 *
 *     거래처   해피유통             돈 — 채권·세금계산서·수금.  **하나**
 *     배송지   포천·쿠팡·네이버커머스   물건 — 주문·배송·취급 품목
 *
 * 예전엔 이 둘을 `partnerId` 한 칸에 몰아 놔서 거래처가 셋으로 갈려 있었다. 그래서
 * **쿠팡으로 들어온 돈이 포천 미수를 못 갚았다** — 수금 매칭이 `partnerId` 단위로 돈다.
 *
 * ---
 * **무엇이 부모에 붙고 무엇이 배송지에 붙나.**
 *
 *     부모      단가·과세구분·라벨·박스규격      한 거래처에 한 값이다
 *     배송지    **취급 품목 목록**              특정 배송지에만 나가는 품목이 있다
 *
 * 사장님: "부모가 모든 품목과 단가를 들고있고 주문 넣거나 할때는 배송지마다 품목이
 * 지금처럼 다르게 보이게". 운영 데이터가 정확히 그 모양이었다 — 해피유통 세 갈래에서
 * 단가·라벨·박스규격 충돌이 **0건**인데, 취급 품목은 포천 29 · 쿠팡 25 · 네이버 4 로 갈렸다.
 */

/** 배송지를 쓰는 거래처인가. 하나도 없으면 예전과 똑같이 돈다. */
export function hasShipTos(partner: Pick<Partner, 'shipTos'> | undefined): boolean {
  return (partner?.shipTos ?? []).some(s => !s.archived);
}

/** 고를 수 있는 배송지만. 보관된 것은 뺀다. */
export function activeShipTos(partner: Pick<Partner, 'shipTos'> | undefined): ShipTo[] {
  return (partner?.shipTos ?? []).filter(s => !s.archived);
}

/**
 * 기본 배송지 — 목록의 **맨 앞**이다(2026-09-16 사장님: "디폴트는 포천이고").
 *
 * 순서를 사람이 정하게 두는 쪽이 낫다. 코드가 "주문이 제일 많은 곳" 같은 걸로 고르면
 * 어느 날 갑자기 기본값이 바뀌어 있고, 왜 바뀌었는지 아무도 모른다.
 */
export function defaultShipToId(partner: Pick<Partner, 'shipTos'> | undefined): string | undefined {
  return activeShipTos(partner)[0]?.id;
}

export function shipToOf(
  partner: Pick<Partner, 'shipTos'> | undefined,
  shipToId: string | undefined,
): ShipTo | undefined {
  return shipToId ? (partner?.shipTos ?? []).find(s => s.id === shipToId) : undefined;
}

/**
 * **화면에 찍는 이름** — `해피유통(쿠팡)`.
 *
 * 2026-09-16 사장님: "주문 들어갈때도 기존 이름 그대로 따로 들어가야 되고",
 * "주문카드처럼 배송지명으로 표시하고 배송캘린더에서도 배송지명으로 들어가있게".
 *
 * **눈에 보이는 것은 하나도 안 바뀐다.** 지금도 거래처명이 `해피유통(쿠팡)` 이라
 * 같은 글자가 나온다. 속에서만 거래처 하나 + 배송지 하나로 갈릴 뿐이다.
 *
 * **이 함수 하나만 쓴다.** 주문 카드·리스트·배송 캘린더·전표·원장이 다 거래처 이름을
 * 찍는데, 각자 조합하면 어떤 데선 `해피유통`, 어떤 데선 `해피유통(쿠팡)` 으로 갈린다.
 */
export function partnerLabel(partnerName: string | undefined, shipToName?: string): string {
  const base = String(partnerName ?? '').trim();
  const 배송지 = String(shipToName ?? '').trim();
  return 배송지 ? `${base}(${배송지})` : base;
}

/** 주문 한 건의 표시 이름. 거래처를 못 찾아도 주문에 박힌 이름으로 찍는다. */
export function orderPartnerLabel(
  order: { partnerName?: string; partnerId?: string; shipToId?: string } | undefined,
  partnerById: (id: string | undefined) => Pick<Partner, 'shipTos'> | undefined,
): string {
  if (!order) return '';
  return partnerLabel(order.partnerName, shipToOf(partnerById(order.partnerId), order.shipToId)?.name);
}

/**
 * **전표 머리에 적을 배송지** — 한 장에 여러 배송지가 섞일 수 있다.
 *
 * 2026-09-16 사장님: "실무에서 C로 거진 처리하기 때문에 A로 해놔도 될거 같아"
 * (C = 배송지별로 끊는다 · A = 섞이면 `포천 외 2`).
 *
 * 하나면 그 이름, 섞이면 `포천 외 2`. 없으면 빈 글자 — 부르는 쪽이 줄을 아예 안 그린다.
 */
export function shipToSummary(names: readonly (string | undefined)[]): string {
  const 있는것 = [...new Set(names.map(n => String(n ?? '').trim()).filter(Boolean))];
  if (!있는것.length) return '';
  return 있는것.length === 1 ? 있는것[0] : `${있는것[0]} 외 ${있는것.length - 1}`;
}

/**
 * **이 배송지에 나가는 품목인가.**
 *
 * `shipToIds` 가 비어 있으면 **전 배송지**다 — 배송지를 안 쓰는 거래처가 대부분이고,
 * 그쪽은 이 칸이 영영 비어 있다. 비었을 때를 "아무 데도 안 나감"으로 읽으면 그 거래처들의
 * 품목이 통째로 사라진다.
 */
export function itemGoesTo(link: Pick<PartnerItem, 'shipToIds'>, shipToId: string | undefined): boolean {
  const ids = link.shipToIds;
  if (!ids?.length) return true;
  return !!shipToId && ids.includes(shipToId);
}

/** 그 배송지에 나가는 거래처–품목 줄만. 주문 화면의 품목 목록이 이걸로 걸러진다. */
export function linksForShipTo<T extends Pick<PartnerItem, 'shipToIds'>>(
  links: readonly T[],
  shipToId: string | undefined,
): T[] {
  return links.filter(l => itemGoesTo(l, shipToId));
}
