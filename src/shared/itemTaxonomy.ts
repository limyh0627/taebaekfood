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
 * **제 재고를 개수로 드는 품목인가** — 완제품과, 개수로 세는 반제품(캔·박스).
 *
 * 2026-09-16 사장님: 캔을 완제품이 아니라 **반제품**으로 두기로 했다
 * ("캔 품목은 반제품으로 넣긴할거야 반제품 상태에서도 판매 가능하잖아",
 * "나머지 캔 제품들은 그냥 그대로 반제품으로 서브타입만 바꾸면 돼").
 *
 * **그런데 `type` 만 보고 가르는 자리가 넷 있었다** — 생산 처리·출고 차감·원료 부족
 * 경고·제조일 점검. 캔을 `wip` 으로 바꾸면 그 넷이 조용히 캔을 빼 버려서
 * **주문에 넣어 팔아도 재고가 안 움직인다.** 반제품 캔(`깨분참기름/16.5kg`)이 여태
 * 멀쩡해 보인 건 주문이 0건이라 그 길을 한 번도 안 지났기 때문이다.
 *
 * 그래서 판정을 **여기 하나로** 모은다. `isBulkItem` 이 똑같은 길을 이미 걸었다 —
 * 12곳에 흩어져 있다가 단위 글자 하나 고쳤더니 차감 수식이 조용히 바뀌었다.
 *
 * **벌크는 제외한다.** kg·L 로 재는 것은 로트가 재고를 들고, 셈도 다른 길로 간다.
 *
 * **단위 글자로만 가르지 않는다.** 엔진 한 곳이 `unit === '개'` 로 보고 있었는데,
 * `시골향참기름1-캔` 은 단위가 **'캔'** 이라 그 판정에서 빠진다. 사람이 단위를 '개'로
 * 쓰든 '캔'·'병'으로 쓰든 뜻은 같다 — 세어서 파는 것이다. 근거는 **벌크냐 아니냐**이고,
 * 단위는 kg·L 인지만 마지막으로 확인한다(subtype 이 안 박힌 옛 품목 대비).
 */
const 벌크단위 = new Set(['kg', 'KG', 'L', 'l', '리터', 'ℓ']);

export const holdsUnitStock = (p: { type?: string; unit?: string; subtype?: string } | undefined): boolean => {
  if (!p || isBulkItem(p)) return false;
  if (벌크단위.has(String(p.unit ?? '').trim())) return false;
  return p.type === 'product' || p.type === 'wip';
};

/**
 * **사입·임가공 완제품** — 팔 때 생산 없이 제 재고만 뺀다
 * (원료는 완사입이면 무관, 임가공이면 가공입고 때 이미 소진된다).
 * 생산을 안 하므로 '재고 쓸까요' 물음의 대상도 아니다 → 화면(`stockUseRows`)도 이걸 본다.
 *
 * **재고 엔진 안에 있던 것을 여기로 옮겼다**(2026-09-15). 품목이 무엇이냐는 판정인데
 * 엔진에 갇혀 있어서, 화면 쪽에서 출고 차감량을 셈하려면 엔진을 끌어와야 했다 —
 * 그러면 서로 물고 도는 모양이 된다. 분류는 분류가 있는 자리에 둔다.
 */
export const isGoodsItem = (p: { category?: string; type?: string; procureType?: string }) =>
  p.category === '향미유' || p.category === '고춧가루' ||
  p.type === '향미유' || p.type === '고춧가루' || p.type === 'goods' ||
  p.procureType === '완사입' || p.procureType === '임가공';

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
