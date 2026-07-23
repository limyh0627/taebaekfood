/**
 * 품목 분류 체계 — 이름은 사용자가 정한다.
 *
 * 카테고리 **키**(product/goods/…)는 엔진이 분기에 쓰므로 고정이다. 재고 차감·원료식·
 * 부자재 판정이 전부 이 키를 본다. 사용자가 바꾸는 건 화면에 나오는 **이름(label)**과
 * **하위 분류(subtype)** 목록이다. 하위 분류는 처음부터 한글이라 자유롭게 넣고 뺀다.
 *
 * 저장소는 `itemTaxonomy` 컬렉션. 분류 관리 화면을 처음 열 때 아래 기본값이 통째로
 * 시딩되고, 그 뒤로는 저장본이 유일한 출처다(그래야 "지웠다"가 표현된다).
 */

export const CATEGORY_KEYS = ['product', 'goods', 'wip', 'raw', 'giftset', 'submaterial', 'shipping'] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];

export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  product: '완제품', goods: '상품', wip: '반제품', raw: '원료',
  giftset: '선물세트', submaterial: '부자재', shipping: '배송',
};

export const DEFAULT_SUBTYPES: Record<string, string[]> = {
  product: [],
  goods: ['향미유', '고춧가루', '참기름', '들기름', '참깨', '들깨', '검정깨'],
  wip: [],
  raw: [],
  giftset: [],
  submaterial: ['마개', '용기', '박스', '테이프', '라벨'],
  shipping: [],
};

export interface TaxonomyRow {
  id: string;
  kind: 'category' | 'subtype';
  key?: string;      // kind==='category' — 고정 키
  parent?: string;   // kind==='subtype'  — 소속 카테고리 키
  label: string;
  order?: number;
}

export interface Taxonomy {
  categories: { key: string; label: string }[];
  labelOf: (key: string) => string;
  subtypesOf: (categoryKey: string) => string[];
  /** 저장본이 아직 없으면 false — 분류 관리 화면이 기본값을 시딩해야 한다 */
  seeded: boolean;
}

const byOrder = (a: TaxonomyRow, b: TaxonomyRow) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.label ?? '').localeCompare(b.label ?? '', 'ko');

export function buildTaxonomy(rows: TaxonomyRow[] | undefined): Taxonomy {
  const saved = rows ?? [];
  const catRows = saved.filter(r => r.kind === 'category');
  const subRows = saved.filter(r => r.kind === 'subtype');

  const labels: Record<string, string> = { ...DEFAULT_CATEGORY_LABELS };
  const order: Record<string, number> = {};
  CATEGORY_KEYS.forEach((k, i) => { order[k] = i; });
  for (const r of catRows) {
    if (!r.key) continue;
    if (r.label) labels[r.key] = r.label;
    if (typeof r.order === 'number') order[r.key] = r.order;
  }

  const categories = [...CATEGORY_KEYS]
    .sort((a, b) => order[a] - order[b])
    .map(k => ({ key: k as string, label: labels[k] }));

  // 저장본이 있으면 그것만 쓴다 — 기본값과 섞으면 삭제한 게 되살아난다.
  const seeded = saved.length > 0;
  const subMap: Record<string, string[]> = {};
  for (const r of [...subRows].sort(byOrder)) {
    if (!r.parent || !r.label) continue;
    (subMap[r.parent] ??= []).push(r.label);
  }

  return {
    categories,
    seeded,
    labelOf: (k: string) => labels[k] ?? k,
    subtypesOf: (k: string) => (seeded ? (subMap[k] ?? []) : (DEFAULT_SUBTYPES[k] ?? [])),
  };
}

/** 기본값을 저장 행으로 펼친다 — 최초 시딩용 */
export function defaultTaxonomyRows(): Omit<TaxonomyRow, 'id'>[] {
  const rows: Omit<TaxonomyRow, 'id'>[] = [];
  CATEGORY_KEYS.forEach((key, i) => {
    rows.push({ kind: 'category', key, label: DEFAULT_CATEGORY_LABELS[key], order: i });
    (DEFAULT_SUBTYPES[key] ?? []).forEach((label, j) => {
      rows.push({ kind: 'subtype', parent: key, label, order: j });
    });
  });
  return rows;
}
