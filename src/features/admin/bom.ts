import { ItemFormula, Item } from '../../shared/types';
import { PRODUCT_FORMULA, baseRawName } from '../../constants/formula';

/**
 * 배합식(BOM) 재귀 전개 — 순수 함수.
 *  child가 phantom 반제품(무재고)이면 그 배합비대로 하위 원료로 전개.
 *   예: 완제품 → 혼합원액(phantom) → [통깨참기름 0.6, 옥수수유 0.4] ⇒ 통깨참기름·옥수수유로 차감.
 *  phantom이 아닌 홀더(통깨참기름·볶음참깨 등 선제조 재고)는 종단(재고 로트 차감).
 *  item_formula 우선, 없으면 PRODUCT_FORMULA 폴백. phantom child 없으면 단일레벨과 동일(무회귀).
 */
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
