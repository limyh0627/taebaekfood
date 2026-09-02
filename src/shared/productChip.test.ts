import { describe, it, expect } from 'vitest';
import { categoryOf } from './productChip';

/**
 * 칸 이름이 '카테고리'면 `category` 를 본다. 품목관리 화면이 `subtype` 을 먼저 봐서
 * 낱개·박스·벌크가 카테고리 칸에 찍히고 있었다(518품목). 그리고 subtype 이 비면
 * 이름으로 짚어서, 라벨 부자재 '하남댁 알찬 참기름/350ml' 이 **참기름**으로 찍혔다.
 */
describe('갈래 딱지는 카테고리를 본다', () => {
  it('카테고리가 있으면 그대로', () => {
    expect(categoryOf({ category: '라벨', type: 'submaterial' })).toBe('라벨');
    expect(categoryOf({ category: '참기름', type: 'product' })).toBe('참기름');
  });

  it('**이름으로 짚지 않는다** — 라벨이 참기름으로 찍히던 자국이다', () => {
    expect(categoryOf({ category: '라벨', type: 'submaterial' })).toBe('라벨');
    //  카테고리가 비어도 이름은 안 본다
    expect(categoryOf({ type: 'submaterial' })).toBe('부자재');
  });

  it('**subtype 을 보지 않는다** — 낱개·박스는 카테고리가 아니다', () => {
    expect(categoryOf({ category: '참기름', type: 'product' })).toBe('참기름');
    expect(categoryOf({ type: 'product' })).toBe('완제품');
  });

  it('비어 있으면 타입 이름 — 13품목이 그 상태다(대부분 반제품 벌크)', () => {
    expect(categoryOf({ type: 'wip' })).toBe('반제품');
    expect(categoryOf({ type: 'raw' })).toBe('원료');
    expect(categoryOf({ type: 'goods' })).toBe('상품');
  });

  it('공백만 있는 카테고리는 빈 것으로 본다', () => {
    expect(categoryOf({ category: '   ', type: 'wip' })).toBe('반제품');
  });

  it('모르는 타입은 그대로 — 지어내지 않는다', () => {
    expect(categoryOf({ type: '새타입' })).toBe('새타입');
  });
});
