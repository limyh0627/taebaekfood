import { describe, it, expect } from 'vitest';
import { toChosung, isChosungQuery, matchesSearch, splitCompoundJamo } from './hangul';

describe('toChosung', () => {
  it('한글에서 초성만 뽑는다', () => {
    expect(toChosung('참기름')).toBe('ㅊㄱㄹ');
    expect(toChosung('볶음참깨')).toBe('ㅂㅇㅊㄲ');
    expect(toChosung('들기름')).toBe('ㄷㄱㄹ');
  });
  it('한글이 아니면 그대로 둔다', () => {
    expect(toChosung('300ML-사각병')).toBe('300ML-ㅅㄱㅂ');
    expect(toChosung('B-05')).toBe('B-05');
  });
});

describe('isChosungQuery', () => {
  it('전부 초성이면 true', () => {
    expect(isChosungQuery('ㅊㄱㄹ')).toBe(true);
    expect(isChosungQuery('ㅂㅇ')).toBe(true);
  });
  it('완성형·영문·빈값이면 false', () => {
    expect(isChosungQuery('참기름')).toBe(false);
    expect(isChosungQuery('ㅊ기름')).toBe(false);
    expect(isChosungQuery('abc')).toBe(false);
    expect(isChosungQuery('')).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('초성 검색', () => {
    expect(matchesSearch('참기름/300ml', 'ㅊㄱㄹ')).toBe(true);
    expect(matchesSearch('참진한기름', 'ㅊㅈㅎ')).toBe(true);
    expect(matchesSearch('들기름', 'ㅊㄱㄹ')).toBe(false);
  });
  it('중간부터도 걸린다', () => {
    expect(matchesSearch('시골향 볶음참깨', 'ㅂㅇㅊㄲ')).toBe(true);
  });
  it('일반 부분일치도 그대로', () => {
    expect(matchesSearch('참기름/300ml', '참기')).toBe(true);
    expect(matchesSearch('300ML-사각병', '사각')).toBe(true);
    expect(matchesSearch('B-05호박스', 'b-05')).toBe(true);   // 대소문자 무시
  });
  it('공백은 무시한다', () => {
    expect(matchesSearch('시골향 참기름', '향참')).toBe(true);
    expect(matchesSearch('참기름', 'ㅊ ㄱㄹ')).toBe(true);
  });
  it('빈 검색어는 전부 통과', () => {
    expect(matchesSearch('아무거나', '')).toBe(true);
  });
});

/**
 * 겹자음 — 자판이 자음을 잇달아 치면 붙여 버린다(ㄱ·ㅅ → ㄳ).
 * 초성은 19자뿐이라 겹자음은 초성으로 절대 안 나오고, 안 펴면 초성 검색이 통째로 빗나간다.
 */
describe('겹자음 펴기 — ㄳ → ㄱㅅ', () => {
  it('낱자로 편다', () => {
    expect(splitCompoundJamo('ㄳ')).toBe('ㄱㅅ');
    expect(splitCompoundJamo('ㅄ')).toBe('ㅂㅅ');
    expect(splitCompoundJamo('ㄺ')).toBe('ㄹㄱ');
    expect(splitCompoundJamo('ㄶ')).toBe('ㄴㅎ');
  });
  it('겹자음도 초성 검색으로 본다', () => {
    expect(isChosungQuery('ㄳ')).toBe(true);
    expect(isChosungQuery('ㅄㄱ')).toBe(true);
  });
  it('ㄳ으로 "고소한"을 찾는다', () => {
    expect(matchesSearch('고소한기름', 'ㄳ')).toBe(true);
    expect(matchesSearch('참기름', 'ㄳ')).toBe(false);
  });
  it('ㅄ으로 "박스"를 찾는다', () => {
    expect(matchesSearch('2호박스', 'ㅄ')).toBe(true);
    expect(matchesSearch('볶음실링', 'ㅄ')).toBe(false);   // 초성이 ㅂㅇㅅㄹ이라 ㅂㅅ가 안 붙는다
  });
  it('겹자음이 섞여도 이어서 견준다', () => {
    expect(matchesSearch('고소한들기름', 'ㄳㅎㄷㄱㄹ')).toBe(true);
  });
});
