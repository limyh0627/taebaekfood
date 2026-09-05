/**
 * 품목 분류 3단 — 타입 > 서브타입 > 카테고리
 *
 *   타입(type)         완제품 · 상품 · 반제품 · 원료 · 부자재
 *   서브타입(subtype)   낱개 · 박스 · 선물세트 · 벌크    ← 선택. 부자재는 지금 비어 있다.
 *   카테고리(category)  참기름 · 라벨 · 용기 · 박스 …    ← 실제로 뭔지
 *
 * 타입 **키**(product/goods/…)는 엔진이 분기에 쓰므로 고정이다. 재고 차감·원료식·
 * 부자재 판정이 전부 이 키를 본다. 사용자가 바꾸는 건 화면에 나오는 **이름(label)**과
 * 서브타입·카테고리 목록이다.
 *
 * 저장소는 `itemTaxonomy` 컬렉션. 분류 관리 화면을 처음 열 때 기본값이 시딩되고,
 * 그 뒤로는 저장본이 유일한 출처다(그래야 "지웠다"가 표현된다).
 *
 * DB 필드 대응은 itemTaxonomy.ts 참고 — category=타입, subtype2=서브타입, subtype=카테고리.
 */

export const CATEGORY_KEYS = ['product', 'goods', 'wip', 'raw', 'submaterial'] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];

export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  product: '완제품', goods: '상품', wip: '반제품', raw: '원료', submaterial: '부자재',
};

/**
 * 타입별 서브타입 기본값.
 *
 * 원료·반제품의 `벌크`는 **isBulkItem이 보는 값**이다 — BOM 수량이 용량(kg·L)이냐
 * 개수냐를 이 한 값이 정하고, 재고차감·원료홀더 탐색 30여 곳이 거기 얹혀 있다.
 * 목록에 없으면 새 품목에 달 방법이 없어 조용히 개수로 취급된다.
 */
export const DEFAULT_SUBTYPES: Record<string, string[]> = {
  product: ['낱개', '박스', '선물세트'],
  wip: ['벌크'],
  raw: ['벌크'],
};

/** 타입별 카테고리 기본값 */
export const DEFAULT_ITEM_CATEGORIES: Record<string, string[]> = {
  product: ['참기름', '들기름', '참깨', '들깨', '고춧가루'],
  goods: ['향미유', '고춧가루'],
  wip: ['참기름', '들기름', '참깨', '들깨'],
  raw: ['참기름', '들기름', '참깨', '들깨'],
  submaterial: ['용기', '마개', '박스', '라벨', '테이프', '케이스'],
};

export interface TaxonomyRow {
  id: string;
  /** 'type'=타입 이름·순서 · 'subtype'=서브타입 · 'category'=카테고리 */
  kind: 'type' | 'subtype' | 'category';
  key?: string;      // kind==='type' — 고정 키
  parent?: string;   // subtype/category — 소속 타입 키
  label: string;
  order?: number;
  hidden?: boolean;  // 타입 숨김 — 안 쓰는 것을 목록에서 뺀다. 키는 남으므로 옛 품목은 그대로.
}

export interface Taxonomy {
  /** 숨긴 건 빠진 목록 */
  types: { key: string; label: string }[];
  /** 숨긴 것까지 전부 — 분류 관리 화면용 */
  allTypes: { key: string; label: string; hidden: boolean }[];
  labelOf: (typeKey: string) => string;
  subtypesOf: (typeKey: string) => string[];
  categoriesOf: (typeKey: string) => string[];
  /** 저장본이 아직 없으면 false — 분류 관리 화면이 기본값을 시딩해야 한다 */
  seeded: boolean;
}

const byOrder = (a: TaxonomyRow, b: TaxonomyRow) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.label ?? '').localeCompare(b.label ?? '', 'ko');

export function buildTaxonomy(rows: TaxonomyRow[] | undefined): Taxonomy {
  const saved = rows ?? [];
  // 옛 저장본은 kind='category'로 타입 행을 썼다 — key가 있으면 타입 행으로 본다.
  const typeRows = saved.filter(r => r.kind === 'type' || (r.kind === 'category' && r.key && !r.parent));
  const subRows = saved.filter(r => r.kind === 'subtype');
  const catRows = saved.filter(r => r.kind === 'category' && r.parent);

  const labels: Record<string, string> = { ...DEFAULT_CATEGORY_LABELS };
  const order: Record<string, number> = {};
  const hidden: Record<string, boolean> = {};
  CATEGORY_KEYS.forEach((k, i) => { order[k] = i; });
  for (const r of typeRows) {
    if (!r.key) continue;
    if (r.label) labels[r.key] = r.label;
    if (typeof r.order === 'number') order[r.key] = r.order;
    if (r.hidden) hidden[r.key] = true;
  }

  const allTypes = [...CATEGORY_KEYS]
    .sort((a, b) => order[a] - order[b])
    .map(k => ({ key: k as string, label: labels[k], hidden: !!hidden[k] }));
  const types = allTypes.filter(t => !t.hidden).map(({ key, label }) => ({ key, label }));

  const group = (list: TaxonomyRow[]) => {
    const m: Record<string, string[]> = {};
    for (const r of [...list].sort(byOrder)) {
      if (!r.parent || !r.label) continue;
      (m[r.parent] ??= []).push(r.label);
    }
    return m;
  };
  const subMap = group(subRows);
  const catMap = group(catRows);
  // 저장본이 있으면 그것만 쓴다 — 기본값과 섞으면 삭제한 게 되살아난다.
  const seeded = saved.length > 0;

  return {
    types, allTypes, seeded,
    labelOf: (k: string) => labels[k] ?? k,
    subtypesOf: (k: string) => (seeded ? (subMap[k] ?? []) : (DEFAULT_SUBTYPES[k] ?? [])),
    categoriesOf: (k: string) => (seeded ? (catMap[k] ?? []) : (DEFAULT_ITEM_CATEGORIES[k] ?? [])),
  };
}

/** 기본값을 저장 행으로 펼친다 — 최초 시딩용 */
export function defaultTaxonomyRows(): Omit<TaxonomyRow, 'id'>[] {
  const rows: Omit<TaxonomyRow, 'id'>[] = [];
  CATEGORY_KEYS.forEach((key, i) => {
    rows.push({ kind: 'type', key, label: DEFAULT_CATEGORY_LABELS[key], order: i });
    (DEFAULT_SUBTYPES[key] ?? []).forEach((label, j) => rows.push({ kind: 'subtype', parent: key, label, order: j }));
    (DEFAULT_ITEM_CATEGORIES[key] ?? []).forEach((label, j) => rows.push({ kind: 'category', parent: key, label, order: j }));
  });
  return rows;
}

/**
 * **분류 차례** — 타입 순서 → 그 안의 카테고리 순서로 번호를 매긴다.
 *
 * 품목을 늘어놓을 때 **분류 관리 화면과 같은 차례**로 보여야 한다. 그 셈이
 * [AddItemModal](../../components/AddItemModal.tsx)·[ItemList](../../components/ItemList.tsx)
 * 두 곳에 똑같이 적혀 있었다(2026-09-05). 한쪽만 고치면 같은 품목이 화면마다 다른
 * 자리에 뜬다.
 *
 * @returns 타입키·카테고리 → 차례(0부터). 없는 것은 부르는 쪽이 뒤로 보낸다.
 */
export function categoryRank(taxo: Pick<Taxonomy, 'allTypes' | 'categoriesOf'>): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const t of taxo.allTypes) {
    if (!m.has(t.key)) m.set(t.key, n++);
    for (const c of taxo.categoriesOf(t.key)) if (!m.has(c)) m.set(c, n++);
  }
  return m;
}
