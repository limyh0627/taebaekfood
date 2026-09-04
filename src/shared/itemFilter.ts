import { DEFAULT_CATEGORY_LABELS } from './taxonomy';
import { matchesSearch } from './hangul';

//  **품목 목록을 분류로 좁히는 셈.**
//  고를 것을 분류표(`itemTaxonomy`)가 아니라 **눈앞의 품목에서** 뽑는다.
//  그래야 눌렀는데 아무것도 없는 칸이 안 생긴다 — 분류표에는 있지만 품목이 없는 갈래가 있다.

export interface ItemLike {
  name: string;
  spec?: string | number;
  type?: string;
  category?: string;
  archived?: boolean;
}

export interface FilterOption { key: string; label: string; count: number }

/** 전체를 뜻하는 값. 빈 문자열이면 '값이 없는 품목'과 헷갈린다. */
export const ALL = '*';

/** 타입(완제품·상품·…) 칸. 품목 수가 많은 순이 아니라 **분류표 차례**대로 둔다. */
export function typeOptions(items: readonly ItemLike[]): FilterOption[] {
  const 차례 = Object.keys(DEFAULT_CATEGORY_LABELS);
  const 셈 = new Map<string, number>();
  for (const i of items) {
    const k = String(i.type ?? '').trim();
    if (k) 셈.set(k, (셈.get(k) ?? 0) + 1);
  }
  return [...셈.entries()]
    .sort((a, b) => {
      const ai = 차례.indexOf(a[0]), bi = 차례.indexOf(b[0]);
      // 분류표에 없는 키는 뒤로 — 옛 품목에 붙은 값일 수 있다
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return a[0].localeCompare(b[0], 'ko');
    })
    .map(([key, count]) => ({ key, label: DEFAULT_CATEGORY_LABELS[key] ?? key, count }));
}

/** 카테고리(참기름·용기·…) 칸. **고른 타입 안에서만** 뽑는다. */
export function categoryOptions(items: readonly ItemLike[], type: string): FilterOption[] {
  const 셈 = new Map<string, number>();
  for (const i of items) {
    if (type !== ALL && String(i.type ?? '') !== type) continue;
    const k = String(i.category ?? '').trim();
    if (k) 셈.set(k, (셈.get(k) ?? 0) + 1);
  }
  return [...셈.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    .map(([key, count]) => ({ key, label: key, count }));
}

export interface ItemFilter { type?: string; category?: string; q?: string }

/** 타입·카테고리·검색어로 좁힌다. 셋 다 비면 그대로 돌려준다. */
export function filterItems<T extends ItemLike>(items: readonly T[], f: ItemFilter): T[] {
  const type = f.type ?? ALL;
  const category = f.category ?? ALL;
  const t = (f.q ?? '').trim();
  return items.filter(i => {
    if (type !== ALL && String(i.type ?? '') !== type) return false;
    if (category !== ALL && String(i.category ?? '') !== category) return false;
    if (t && !matchesSearch(i.name, t) && !matchesSearch(String(i.spec ?? ''), t)) return false;
    return true;
  });
}

/**
 * 타입을 바꿨을 때 카테고리를 그대로 둬도 되나.
 * 새 타입에 그 카테고리가 없으면 아무것도 안 나오는 빈 화면이 된다 — 그때는 전체로 돌린다.
 */
export function keepCategory(items: readonly ItemLike[], type: string, category: string): string {
  if (category === ALL) return ALL;
  return categoryOptions(items, type).some(o => o.key === category) ? category : ALL;
}
