/**
 * **이 품목이 어느 원료를 쓰나 — 이름만.**
 *
 * 2026-09-10 사장님: "여기 기록에 왜 볶음참깨 외 품목들이 보이냐".
 *
 * 원장 한 줄은 `orderId` 만 들고 있어서, 화면이 "어디 쓰였나"를 보여주려고 **그 주문에 담긴
 * 품목을 통째로** 적었다([ledgerTrace](./ledgerTrace.ts)). 한 주문에 참기름과 들깨가루가
 * 같이 있으면 **볶음참깨 줄에도 들깨가루가 뜬다.** 숫자는 맞는데 이름이 엉뚱해 보인다.
 *
 * 여기서 그 주문의 품목 중 **정말 이 원료를 쓰는 것만** 골라낸다.
 *
 * ---
 * **차감 엔진(`orderStockEngine.accrueRaw`)과 같은 길을 걷는다.** 다만 kg 은 안 센다 —
 * 여기 필요한 건 "쓰나 안 쓰나" 뿐이라 단위 환산·수량이 필요 없다. 걷는 순서는 같다:
 *
 *   ① BOM 에 **벌크 구성품**이 있으면 그것들이 원료다
 *        · phantom 반제품(참기름특A 등) → 배합식으로 leaf 까지 펼친다
 *        · 홀더(통깨참기름·볶음참깨)     → 그 자체가 원료다
 *   ② 벌크 구성품이 없으면 품목의 **배합식**으로 편다(미이관 품목 폴백)
 *   ③ 개수 단위 구성품(무라벨 병 같은 조립 반제품)은 **그 안으로 한 번 더** 들어간다
 *
 * 순수 함수 — DB 도 화면도 안 본다.
 */
import type { Item } from './types';
import { isBulkItem } from './itemTaxonomy';
import { docName } from './docName';

export interface RawUsersDeps {
  allItems: readonly Item[];
  /** `bomOf(품목id)` — 구성 한 단. [bomIndex](./bomIndex.ts) 의 것을 그대로 넘긴다. */
  bomOf: (parentId: string) => { childId: string }[];
  /** `buildFormula(품목키)` — 배합식을 leaf 까지 편 것. admin/bom 의 것을 넘긴다. */
  buildFormula: (prodKey: string) => { raw: string }[];
  /** 원료 이름을 고르는 규칙(`baseRawName`). */
  baseRawName: (name: string) => string;
}

const MAX_DEPTH = 6;

/** 이 품목이 쓰는 원료 이름들. */
export function rawsOfProduct(
  product: Item | undefined, deps: RawUsersDeps, depth = 0, seen = new Set<string>(),
): Set<string> {
  const out = new Set<string>();
  if (!product || depth > MAX_DEPTH || seen.has(product.id)) return out;
  const 지나온곳 = new Set([...seen, product.id]);

  //  **품목 자체가 원료인 경우** — 볶음참깨를 그대로 파는 줄이 여기 걸린다.
  //  BOM·배합식만 보다가 이걸 빠뜨려서, 정작 '볶음참깨' 한 줄짜리 주문이 안 골라졌다.
  if (isBulkItem(product)) {
    if (product.phantom) for (const f of deps.buildFormula(product.name ?? '')) out.add(f.raw);
    else out.add(deps.baseRawName(product.name ?? ''));
  }

  const 구성 = deps.bomOf(product.id)
    .map(l => deps.allItems.find(p => p.id === l.childId))
    .filter((c): c is Item => !!c);

  const 벌크 = 구성.filter(isBulkItem);
  if (벌크.length > 0) {
    for (const comp of 벌크) {
      if (comp.phantom) for (const f of deps.buildFormula(comp.name)) out.add(f.raw);
      else out.add(deps.baseRawName(comp.name));
    }
  } else {
    for (const f of deps.buildFormula(docName(product))) out.add(f.raw);
  }

  //  조립 반제품(개 단위 wip) — 그 안에서 또 원료를 쓴다. 엔진의 accrueBom 재귀와 같은 자리.
  for (const comp of 구성) {
    if (isBulkItem(comp)) continue;
    for (const r of rawsOfProduct(comp, deps, depth + 1, 지나온곳)) out.add(r);
  }
  return out;
}

/** 이 품목이 그 원료를 쓰나. */
export const productUsesRaw = (product: Item | undefined, material: string, deps: RawUsersDeps): boolean =>
  rawsOfProduct(product, deps).has(deps.baseRawName(material));

/**
 * 주문 줄 중 **이 원료를 쓰는 것만.**
 * 하나도 못 고르면 `undefined` 를 준다 — 그때는 부르는 쪽이 예전처럼 전부 보여준다.
 * (배합식이 아직 안 잡힌 품목까지 "안 썼다"고 감추면, 있는 기록이 사라진 것처럼 보인다)
 */
export function orderLinesUsingRaw<T extends { itemId?: string }>(
  lines: readonly T[] | undefined, material: string, deps: RawUsersDeps,
): T[] | undefined {
  if (!lines?.length || !material) return undefined;
  const want = deps.baseRawName(material);
  const 고른것 = lines.filter(l => {
    const p = deps.allItems.find(i => i.id === l.itemId);
    return p ? rawsOfProduct(p, deps).has(want) : false;
  });
  return 고른것.length > 0 ? 고른것 : undefined;
}
