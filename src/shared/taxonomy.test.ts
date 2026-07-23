import { describe, it, expect } from 'vitest';
import { buildTaxonomy, defaultTaxonomyRows, CATEGORY_KEYS, TaxonomyRow } from './taxonomy';

const row = (r: Partial<TaxonomyRow>): TaxonomyRow => ({ id: Math.random().toString(36), kind: 'subtype', label: '', ...r } as TaxonomyRow);

describe('저장본이 없을 때', () => {
  it('기본 이름·기본 하위분류를 쓴다', () => {
    const t = buildTaxonomy([]);
    expect(t.seeded).toBe(false);
    expect(t.labelOf('product')).toBe('완제품');
    expect(t.labelOf('submaterial')).toBe('부자재');
    expect(t.subtypesOf('submaterial')).toEqual(['마개', '용기', '박스', '테이프', '라벨']);
    expect(t.subtypesOf('product')).toEqual([]);
    expect(t.categories.map(c => c.key)).toEqual([...CATEGORY_KEYS]);
  });
  it('undefined도 견딘다', () => {
    expect(buildTaxonomy(undefined).labelOf('goods')).toBe('상품');
  });
});

describe('사용자가 이름을 바꾸면', () => {
  it('그 이름으로 나온다', () => {
    const t = buildTaxonomy([
      row({ kind: 'category', key: 'product', label: '우리제품', order: 0 }),
      row({ kind: 'category', key: 'wip', label: '중간재', order: 1 }),
    ]);
    expect(t.labelOf('product')).toBe('우리제품');
    expect(t.labelOf('wip')).toBe('중간재');
    expect(t.labelOf('goods')).toBe('상품');   // 안 건드린 건 기본값
  });
  it('순서도 바꿀 수 있다', () => {
    const t = buildTaxonomy([
      row({ kind: 'category', key: 'submaterial', label: '부자재', order: -1 }),
    ]);
    expect(t.categories[0].key).toBe('submaterial');
  });
  it('키는 그대로 — 엔진 분기가 깨지지 않는다', () => {
    const t = buildTaxonomy([row({ kind: 'category', key: 'product', label: '완성품' })]);
    expect(t.categories.map(c => c.key).sort()).toEqual([...CATEGORY_KEYS].sort());
  });
});

describe('하위 분류', () => {
  it('저장본이 있으면 저장본만 쓴다 (지운 게 되살아나지 않게)', () => {
    const t = buildTaxonomy([
      row({ kind: 'subtype', parent: 'submaterial', label: '박스', order: 0 }),
      row({ kind: 'subtype', parent: 'submaterial', label: '실링', order: 1 }),
    ]);
    expect(t.seeded).toBe(true);
    expect(t.subtypesOf('submaterial')).toEqual(['박스', '실링']);   // 마개·용기·라벨은 지워진 상태
    expect(t.subtypesOf('goods')).toEqual([]);
  });
  it('order대로 정렬', () => {
    const t = buildTaxonomy([
      row({ kind: 'subtype', parent: 'goods', label: 'ㄴ', order: 2 }),
      row({ kind: 'subtype', parent: 'goods', label: 'ㄱ', order: 1 }),
    ]);
    expect(t.subtypesOf('goods')).toEqual(['ㄱ', 'ㄴ']);
  });
  it('아무 카테고리에나 넣을 수 있다', () => {
    const t = buildTaxonomy([row({ kind: 'subtype', parent: 'product', label: '선물용', order: 0 })]);
    expect(t.subtypesOf('product')).toEqual(['선물용']);
  });
});

describe('defaultTaxonomyRows — 최초 시딩', () => {
  it('카테고리 7개 + 기본 하위분류 전부', () => {
    const rows = defaultTaxonomyRows();
    expect(rows.filter(r => r.kind === 'category')).toHaveLength(7);
    expect(rows.filter(r => r.kind === 'subtype' && r.parent === 'submaterial')).toHaveLength(5);
    expect(rows.filter(r => r.kind === 'subtype' && r.parent === 'goods')).toHaveLength(7);
  });
  it('시딩 결과를 다시 읽으면 기본값과 같다', () => {
    const rows = defaultTaxonomyRows().map((r, i) => ({ ...r, id: `t${i}` })) as TaxonomyRow[];
    const t = buildTaxonomy(rows);
    expect(t.labelOf('raw')).toBe('원료');
    expect(t.subtypesOf('submaterial')).toEqual(['마개', '용기', '박스', '테이프', '라벨']);
    expect(t.subtypesOf('goods')).toEqual(['향미유', '고춧가루', '참기름', '들기름', '참깨', '들깨', '검정깨']);
  });
});
