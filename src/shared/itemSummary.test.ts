import { describe, it, expect } from 'vitest';
import { itemSummary } from './itemSummary';

const it2 = [{ name: '참기름/병/분/전통/350ml' }, { name: '참기름/병/특/알찬/350ml' }];

describe('itemSummary', () => {
  it('하나면 이름만', () => {
    expect(itemSummary([{ name: '참기름' }])).toBe('참기름');
  });
  it('**둘이면 외 1개** — 전에는 둘을 다 이어 붙여 잘렸다', () => {
    expect(itemSummary(it2)).toBe('참기름/병/분/전통/350ml 외 1개');
  });
  it('여럿이면 나머지를 센다', () => {
    expect(itemSummary([...it2, { name: '들기름' }, { name: '고춧가루' }]))
      .toBe('참기름/병/분/전통/350ml 외 3개');
  });
  it('앞에 몇 개 보일지 정할 수 있다', () => {
    expect(itemSummary([...it2, { name: '들기름' }], 2))
      .toBe('참기름/병/분/전통/350ml, 참기름/병/특/알찬/350ml 외 1개');
  });
  it('비면 빈 글', () => {
    expect(itemSummary([])).toBe('');
    expect(itemSummary(undefined)).toBe('');
  });
  it('이름 없는 줄은 안 센다 — 빈 줄이 "외 1개"가 되면 거짓말이다', () => {
    expect(itemSummary([{ name: '참기름' }, { name: '' }, {}])).toBe('참기름');
  });
});
