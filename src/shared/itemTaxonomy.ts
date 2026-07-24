import type { Item } from './types';

/**
 * 품목 분류 3단 — 타입 > 서브타입 > 카테고리
 *
 *   타입(type)        완제품 · 상품 · 반제품 · 원료 · 부자재      ← 엔진이 분기하는 키. 고정.
 *   서브타입(subtype)  낱개 · 배송 · 선물세트                     ← 선택. 부자재·원료는 지금 비어 있다.
 *   카테고리(category) 참기름 · 들기름 · 라벨 · 용기 · 박스 …      ← 실제로 뭔지. 사용자가 정한다.
 *
 * DB 필드는 옛 이름을 그대로 쓴다(참조 300곳 + 데이터 370건을 한 번에 바꾸면 위험):
 *   item.category  ← 타입      (product/goods/wip/raw/submaterial/giftset/shipping)
 *   item.subtype   ← 카테고리   (라벨/용기/박스/마개/테이프/향미유/고춧가루/참기름/들기름…)
 *   item.subtype2  ← 서브타입   (낱개/배송/선물세트) — 신설
 *
 * 화면·새 코드는 이 함수들만 쓴다. 필드 이름을 나중에 정리해도 여기만 고치면 된다.
 */

/** 타입 — 엔진 분기 키 */
export function typeOf(item: Pick<Item, 'category'> | undefined): string {
  return String(item?.category ?? '');
}

/** 서브타입 — 낱개/배송/선물세트. 없으면 '' */
export function subtypeOf(item: (Partial<Item> & { subtype2?: string }) | undefined): string {
  return String(item?.subtype2 ?? '');
}

/** 카테고리 — 참기름/라벨/용기…. 없으면 '' */
export function categoryOf(item: Pick<Item, 'subtype'> | undefined): string {
  return String(item?.subtype ?? '');
}

/** 저장용 — 3단 값을 DB 필드로 되돌린다 */
export function toFields(v: { type: string; subtype?: string; category?: string }) {
  return {
    category: v.type,
    subtype: v.category ?? '',
    subtype2: v.subtype ?? '',
  };
}

/** 타입 키(고정) — 사용자가 못 바꾼다 */
export const TYPE_KEYS = ['product', 'goods', 'wip', 'raw', 'submaterial', 'giftset', 'shipping'] as const;
export type TypeKey = typeof TYPE_KEYS[number];

export const DEFAULT_TYPE_LABELS: Record<string, string> = {
  product: '완제품', goods: '상품', wip: '반제품', raw: '원료',
  submaterial: '부자재', giftset: '선물세트', shipping: '배송',
};
