import { describe, it, expect } from 'vitest';
import { categoryOf } from './productChip';

/**
 * 칸 이름이 '카테고리'면 `category` 를 본다. 품목관리 화면이 `subtype` 을 먼저 봐서
 * 낱개·박스·벌크가 카테고리 칸에 찍히고 있었다(518품목). 그리고 subtype 이 비면
 * 이름으로 짚어서, 라벨 부자재 '하남댁 알찬 참기름/350ml' 이 **참기름**으로 찍혔다.
 */
describe('갈래 딱지는 카테고리를 본다', () => {
  it('카테고리가 있으면 그대로', () => {
    expect(categoryOf({ category: '라벨' })).toBe('라벨');
    expect(categoryOf({ category: '참기름' })).toBe('참기름');
  });

  it('**이름으로 짚지 않는다** — 라벨이 참기름으로 찍히던 자국이다', () => {
    expect(categoryOf({ category: '라벨' })).toBe('라벨');
  });

  it('**subtype 을 보지 않는다** — 낱개·박스는 카테고리가 아니다', () => {
    expect(categoryOf({ category: '참기름' })).toBe('참기름');
  });

  /**
   * 2026-09-06 사장님: "완제품이라는 카테고리가 어딨나 없으면 비워놔"
   * 전에는 비면 타입 이름으로 메꿔서 카테고리 칸에 '완제품'·'부자재'가 찍혔다.
   * 완제품은 **타입**이지 카테고리가 아니다. 칸을 비운다.
   */
  it('비어 있으면 빈 값이다 — 타입 이름으로 메꾸지 않는다', () => {
    expect(categoryOf({})).toBe('');
    expect(categoryOf({ category: undefined })).toBe('');
  });

  it('공백만 있는 카테고리도 빈 값이다', () => {
    expect(categoryOf({ category: '   ' })).toBe('');
  });
});
