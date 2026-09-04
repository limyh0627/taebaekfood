import { describe, it, expect } from 'vitest';
import { typeOptions, categoryOptions, filterItems, keepCategory, ALL } from './itemFilter';

const 품목 = [
  { name: '참기름 180ml', spec: '180ml', type: 'product',     category: '참기름' },
  { name: '참기름 320ml', spec: '320ml', type: 'product',     category: '참기름' },
  { name: '들기름 180ml', spec: '180ml', type: 'product',     category: '들기름' },
  { name: '향미유 1.8L',  spec: '1.8L',  type: 'goods',       category: '향미유' },
  { name: '갈색병 180',   spec: '180',   type: 'submaterial', category: '용기' },
  { name: '이중캡골드',   spec: '',      type: 'submaterial', category: '마개' },
  { name: '분류없음',     spec: '',      type: '',            category: '' },
];

describe('typeOptions', () => {
  it('있는 타입만, 분류표 차례대로', () => {
    expect(typeOptions(품목).map(o => o.key)).toEqual(['product', 'goods', 'submaterial']);
  });
  it('이름은 한글로 보여준다', () => {
    expect(typeOptions(품목).map(o => o.label)).toEqual(['완제품', '상품', '부자재']);
  });
  it('몇 개인지 센다', () => {
    expect(typeOptions(품목).find(o => o.key === 'product')?.count).toBe(3);
  });
  it('타입이 빈 품목은 칸을 안 만든다', () => {
    expect(typeOptions(품목).some(o => o.key === '')).toBe(false);
  });
  it('분류표에 없는 키는 뒤로 — 옛 품목에 붙은 값일 수 있다', () => {
    const opts = typeOptions([...품목, { name: 'x', type: '옛것', category: '' }]);
    expect(opts[opts.length - 1].key).toBe('옛것');
  });
});

describe('categoryOptions', () => {
  it('고른 타입 안에서만 뽑는다', () => {
    expect(categoryOptions(품목, 'product').map(o => o.key)).toEqual(['들기름', '참기름']);
    expect(categoryOptions(품목, 'submaterial').map(o => o.key)).toEqual(['마개', '용기']);
  });
  it('전체면 다 모은다', () => {
    expect(categoryOptions(품목, ALL).map(o => o.key)).toEqual(['들기름', '마개', '용기', '참기름', '향미유']);
  });
});

describe('filterItems', () => {
  it('타입으로 좁힌다', () => {
    expect(filterItems(품목, { type: 'product' })).toHaveLength(3);
  });
  it('카테고리로 좁힌다', () => {
    expect(filterItems(품목, { type: 'product', category: '참기름' })).toHaveLength(2);
  });
  it('검색어는 이름·규격 둘 다 본다', () => {
    expect(filterItems(품목, { q: '320' }).map(i => i.name)).toEqual(['참기름 320ml']);
  });
  it('분류와 검색어가 함께 걸린다', () => {
    expect(filterItems(품목, { type: 'product', q: '들기름' })).toHaveLength(1);
  });
  it('아무것도 안 고르면 그대로', () => {
    expect(filterItems(품목, {})).toHaveLength(품목.length);
  });
  it('초성으로도 찾힌다', () => {
    expect(filterItems(품목, { q: 'ㅊㄱㄹ' }).length).toBeGreaterThan(0);
  });
});

describe('keepCategory — 타입을 바꿨을 때', () => {
  it('새 타입에 그 카테고리가 있으면 지킨다', () => {
    expect(keepCategory(품목, ALL, '참기름')).toBe('참기름');
  });
  it('**없으면 전체로 돌린다** — 아무것도 안 나오는 빈 화면을 막는다', () => {
    expect(keepCategory(품목, 'submaterial', '참기름')).toBe(ALL);
  });
  it('전체는 그대로 전체', () => {
    expect(keepCategory(품목, 'product', ALL)).toBe(ALL);
  });
});
