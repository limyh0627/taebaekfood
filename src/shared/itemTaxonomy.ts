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

/**
 * DB 필드 이름을 옛 모양으로 되돌린다 — 로딩 직후 한 번만 통과시킨다.
 *
 * DB는 2026-08-13부터 뜻에 맞는 이름을 쓴다:  type / category / subtype
 * 코드 490곳은 아직 옛 이름을 읽는다:          category(=타입) / subtype(=카테고리) / subtype2(=서브타입)
 * 그 490곳을 한 번에 고치면 위험해서, 읽는 지점 한 곳에서 되돌려 준다.
 * 코드가 헬퍼(typeOf·categoryOf·subtypeOf)로 다 옮겨간 뒤에 이 함수를 지우면 된다.
 *
 * `type`이 있으면 새 문서, 없으면 아직 안 옮긴 옛 문서 — 그대로 둔다.
 */
export function toLegacyFields<T>(item: T): T {
  const i = item as unknown as { type?: unknown; category?: unknown; subtype?: unknown };
  if (i?.type == null) return item;                    // 옛 문서 — 손대지 않는다
  return {
    ...item,
    category: i.type,                                  // 타입
    subtype: i.category ?? '',                         // 카테고리(참기름·라벨…)
    subtype2: i.subtype ?? '',                         // 서브타입(낱개·배송…)
  } as T;
}

/**
 * 벌크 품목인가 — kg·L로 재는 원료·반제품.
 *
 * **BOM 수량의 뜻을 이 값 하나가 정한다.**
 *   벌크    → 수량은 용량 (L 또는 kg).  1800ml 병이면 1.8
 *   아니면  → 수량은 개수 (EA).         뚜껑·라벨·박스는 1
 *
 * 예전엔 `category==='raw' || (category==='wip' && unit!=='개')`로 12곳에서 따로 판정했다.
 * 그래서 품목의 단위를 정리하려고 '개'↔'kg'만 고쳐도 차감 수식이 조용히 바뀌었다.
 * 이제 근거는 subtype 하나뿐이다(DB: subtype='벌크', 코드: toLegacyFields를 거쳐 subtype2).
 */
export function isBulkItem(item: { subtype2?: string } | undefined): boolean {
  return subtypeOf(item) === '벌크';
}

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
