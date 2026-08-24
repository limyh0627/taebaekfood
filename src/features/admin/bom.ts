import { ItemFormula, Item } from '../../shared/types';
import { PRODUCT_FORMULA, baseRawName } from '../../constants/formula';

/**
 * 배합식(BOM) 재귀 전개 — 순수 함수.
 *  child가 phantom 반제품(무재고)이면 그 배합비대로 하위 원료로 전개.
 *   예: 완제품 → 혼합원액(phantom) → [통깨참기름 0.6, 옥수수유 0.4] ⇒ 통깨참기름·옥수수유로 차감.
 *  phantom이 아닌 홀더(통깨참기름·볶음참깨 등 선제조 재고)는 종단(재고 로트 차감).
 *  item_formula 우선, 없으면 PRODUCT_FORMULA 폴백. phantom child 없으면 단일레벨과 동일(무회귀).
 */
/**
 * **직접 구성 한 단** — 펼치지 않고, 수율을 곱하지도 않고 그대로 준다.
 *
 * `buildFormula`는 차감용이라 `ratio × yield_rate`를 미리 곱해서 준다. 원가는 반대로
 * **나눠야** 한다: 수율 37%는 "들깨 1kg에서 기름 0.37kg이 나온다"는 뜻이라,
 * 기름 1kg에는 들깨 1/0.37 = 2.7kg이 든다. 곱해 버리면 0.37kg으로 잡혀 원가가 7배 작아진다.
 *
 * 펼치지 않는 이유 — 원가는 제 손으로 재귀한다(들기름 → 통들깨들기름 → 들깨).
 * 미리 펼친 값을 받으면 중간 반제품의 수율이 어디에 곱해졌는지 되짚을 수 없다.
 */
export function formulaRowsOf(
  prodKey: string, itemFormulas: ItemFormula[],
): { raw: string; ratio: number; yieldRate: number }[] {
  const rows = itemFormulas.filter(b => b.parent_key === prodKey);
  if (rows.length) return rows.map(b => ({ raw: b.child_name, ratio: b.ratio ?? 1, yieldRate: b.yield_rate || 1 }));
  return (PRODUCT_FORMULA[prodKey] ?? []).map(f => ({ raw: f.raw, ratio: f.ratio, yieldRate: 1 }));
}

export function buildFormula(prodKey: string, itemFormulas: ItemFormula[], allItems: Item[]): { raw: string; ratio: number }[] {
  const rowsFor = (key: string) =>
    itemFormulas.filter(b => b.parent_key === key).map(b => ({ raw: b.child_name, ratio: (b.ratio ?? 1) * (b.yield_rate || 1) }));
  const isPhantom = (name: string) => allItems.some(i => i.phantom && baseRawName(i.name) === name);
  const expand = (key: string, acc: number, depth: number, seen: Set<string>): { raw: string; ratio: number }[] => {
    if (depth > 6 || seen.has(key)) return [];
    const rows = rowsFor(key);
    const base = rows.length > 0 ? rows : (PRODUCT_FORMULA[key] ?? []);
    const out: { raw: string; ratio: number }[] = [];
    for (const f of base) {
      const r = acc * f.ratio;
      if (isPhantom(f.raw)) out.push(...expand(f.raw, r, depth + 1, new Set([...seen, key])));
      else out.push({ raw: f.raw, ratio: r });
    }
    return out;
  };
  const hasTop = itemFormulas.some(b => b.parent_key === prodKey) || !!PRODUCT_FORMULA[prodKey];
  return hasTop ? expand(prodKey, 1, 0, new Set()) : [];
}
