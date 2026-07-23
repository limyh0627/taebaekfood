import { describe, it, expect } from 'vitest';
import { toChosung, isChosungQuery, matchesSearch } from './hangul';

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
