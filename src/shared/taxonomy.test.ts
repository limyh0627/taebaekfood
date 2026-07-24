import { describe, it, expect } from 'vitest';
import { buildTaxonomy, defaultTaxonomyRows, CATEGORY_KEYS, TaxonomyRow } from './taxonomy';

let n = 0;
const row = (r: Partial<TaxonomyRow>): TaxonomyRow => ({ id: `r${n++}`, kind: 'category', label: '', ...r } as TaxonomyRow);

describe('저장본이 없을 때', () => {
  it('기본 이름·서브타입·카테고리를 쓴다', () => {
    const t = buildTaxonomy([]);
    expect(t.seeded).toBe(false);
    expect(t.labelOf('product')).toBe('완제품');
    expect(t.subtypesOf('product')).toEqual(['낱개', '배송', '선물세트']);
    expect(t.categoriesOf('product')).toEqual(['참기름', '들기름', '참깨', '들깨', '고춧가루']);
    expect(t.categoriesOf('submaterial')).toEqual(['용기', '마개', '박스', '라벨', '테이프', '케이스']);
    expect(t.subtypesOf('submaterial')).toEqual([]);   // 부자재는 서브타입 없음
    expect(t.types.map(c => c.key)).toEqual([...CATEGORY_KEYS]);
  });
  it('undefined도 견딘다', () => {
    expect(buildTaxonomy(undefined).labelOf('goods')).toBe('상품');
  });
});

describe('타입 이름', () => {
  it('바꾼 이름으로 나온다', () => {
    const t = buildTaxonomy([
      row({ kind: 'type', key: 'product', label: '우리제품', order: 0 }),
      row({ kind: 'type', key: 'wip', label: '중간재', order: 1 }),
    ]);
    expect(t.labelOf('product')).toBe('우리제품');
    expect(t.labelOf('wip')).toBe('중간재');
    expect(t.labelOf('goods')).toBe('상품');   // 안 건드린 건 기본값
  });
  it('순서·숨김', () => {
    const t = buildTaxonomy([
      row({ kind: 'type', key: 'submaterial', label: '부자재', order: -1 }),
      row({ kind: 'type', key: 'giftset', label: '선물세트', hidden: true }),
    ]);
    expect(t.types[0].key).toBe('submaterial');
    expect(t.types.map(c => c.key)).not.toContain('giftset');
    expect(t.allTypes.map(c => c.key)).toContain('giftset');
  });
  it('키는 그대로 — 엔진 분기가 깨지지 않는다', () => {
    const t = buildTaxonomy([row({ kind: 'type', key: 'product', label: '완성품' })]);
    expect(t.allTypes.map(c => c.key).sort()).toEqual([...CATEGORY_KEYS].sort());
  });
  it("옛 저장본(kind='category' + key)도 타입으로 읽는다", () => {
    const t = buildTaxonomy([row({ kind: 'category', key: 'raw', label: '원재료' })]);
    expect(t.labelOf('raw')).toBe('원재료');
    expect(t.categoriesOf('raw')).toEqual([]);   // parent 없으니 카테고리 아님
  });
});

describe('서브타입 · 카테고리', () => {
  it('parent로 갈린다', () => {
    const t = buildTaxonomy([
      row({ kind: 'subtype', parent: 'product', label: '낱개', order: 0 }),
      row({ kind: 'subtype', parent: 'product', label: '선물세트', order: 1 }),
      row({ kind: 'category', parent: 'product', label: '참기름', order: 0 }),
      row({ kind: 'category', parent: 'submaterial', label: '라벨', order: 0 }),
    ]);
    expect(t.subtypesOf('product')).toEqual(['낱개', '선물세트']);
    expect(t.categoriesOf('product')).toEqual(['참기름']);
    expect(t.categoriesOf('submaterial')).toEqual(['라벨']);
    expect(t.subtypesOf('submaterial')).toEqual([]);
  });
  it('저장본이 있으면 저장본만 쓴다 (지운 게 되살아나지 않게)', () => {
    const t = buildTaxonomy([row({ kind: 'category', parent: 'submaterial', label: '박스', order: 0 })]);
    expect(t.seeded).toBe(true);
    expect(t.categoriesOf('submaterial')).toEqual(['박스']);   // 라벨·용기 등은 지워진 상태
    expect(t.categoriesOf('product')).toEqual([]);
  });
  it('order대로 정렬', () => {
    const t = buildTaxonomy([
      row({ kind: 'category', parent: 'goods', label: 'ㄴ', order: 2 }),
      row({ kind: 'category', parent: 'goods', label: 'ㄱ', order: 1 }),
    ]);
    expect(t.categoriesOf('goods')).toEqual(['ㄱ', 'ㄴ']);
  });
});

describe('defaultTaxonomyRows — 최초 시딩', () => {
  it('타입 7개 + 서브타입 + 카테고리', () => {
    const rows = defaultTaxonomyRows();
    expect(rows.filter(r => r.kind === 'type')).toHaveLength(7);
    expect(rows.filter(r => r.kind === 'subtype' && r.parent === 'product')).toHaveLength(3);
    expect(rows.filter(r => r.kind === 'category' && r.parent === 'submaterial')).toHaveLength(6);
  });
  it('시딩 결과를 다시 읽으면 기본값과 같다', () => {
    const rows = defaultTaxonomyRows().map((r, i) => ({ ...r, id: `t${i}` })) as TaxonomyRow[];
    const t = buildTaxonomy(rows);
    expect(t.labelOf('raw')).toBe('원료');
    expect(t.subtypesOf('product')).toEqual(['낱개', '배송', '선물세트']);
    expect(t.categoriesOf('submaterial')).toEqual(['용기', '마개', '박스', '라벨', '테이프', '케이스']);
  });
});
