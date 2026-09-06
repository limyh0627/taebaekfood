/**
 * 품목 분류 3단 — 타입 > 서브타입 > 카테고리
 *
 *   타입(type)        완제품 · 상품 · 반제품 · 원료 · 부자재      ← 엔진이 분기하는 키. 고정.
 *   서브타입(subtype)  낱개 · 배송 · 선물세트 · 벌크               ← 선택. 부자재는 지금 비어 있다.
 *   카테고리(category) 참기름 · 들기름 · 라벨 · 용기 · 박스 …      ← 실제로 뭔지. 사용자가 정한다.
 *
 * **DB 필드 이름과 코드가 같다** (2026-08-23 정리).
 *
 * 예전엔 DB가 type/category/subtype인데 코드는 옛 이름을 읽었다:
 *   category(=타입) · subtype(=카테고리) · subtype2(=서브타입)
 * 그래서 읽는 지점에서 toLegacyFields로 되돌리고 쓰는 지점에서 다시 뒤집었다.
 * 이름과 뜻이 어긋난 자리라 읽는 사람마다 다르게 짚었다 — 그 왕복을 없앴다.
 *
 * 카테고리를 읽는 건 shared/productChip 의 categoryOf 하나다.
 */

/**
 * 벌크 품목인가 — kg·L로 재는 원료·반제품.
 *
 * **BOM 수량의 뜻을 이 값 하나가 정한다.**
 *   벌크    → 수량은 용량 (L 또는 kg).  1800ml 병이면 1.8
 *   아니면  → 수량은 개수 (EA).         뚜껑·라벨·박스는 1
 *
 * 예전엔 `type==='raw' || (type==='wip' && unit!=='개')`로 12곳에서 따로 판정했다.
 * 그래서 품목의 단위를 정리하려고 '개'↔'kg'만 고쳐도 차감 수식이 조용히 바뀌었다.
 * 이제 근거는 subtype 하나뿐이다 (DB·코드 모두 subtype='벌크').
 */
export function isBulkItem(item: { subtype?: string } | undefined): boolean {
  return String(item?.subtype ?? '') === '벌크';
}


/**
 * 타입 키(고정) — 사용자가 못 바꾼다.
 *
 * 선물세트·배송은 **타입이 아니라 product의 subtype**이다. 예전엔 타입에도 있어서
 * 같은 것이 두 자리에 존재했고, 어느 쪽으로 등록했느냐에 따라 주문 목록·손익 묶음이
 * 달라졌다. 타입에서 뺀다(그 타입으로 저장된 품목은 0건이었다).
 */
export const TYPE_KEYS = ['product', 'goods', 'wip', 'raw', 'submaterial'] as const;
export type TypeKey = typeof TYPE_KEYS[number];

//  이름표는 [taxonomy](taxonomy.ts) 한 곳에서 온다 — 여기서 다시 적지 않는다
export { DEFAULT_CATEGORY_LABELS as DEFAULT_TYPE_LABELS } from './taxonomy';
