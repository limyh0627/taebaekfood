import { describe, it, expect } from 'vitest';
import { unitsPerBoxOf } from './orderUnits';
import type { Item } from './types';

/**
 * 한 박스에 몇 개 드나 — 근거는 **품목 자신**이다.
 * 예전엔 '향미유면 12'로 코드에 박아 둬서, 고춧가루처럼 규격마다 개입수가 다른 것을
 * 담을 수 없었다(1kg 20개 · 5kg 4개, 둘 다 20kg 박스).
 */
const it_ = (p: Partial<Item>) => p as Item;

describe('박스 개입수', () => {
  it('고춧가루 — 규격이 다르면 개입수도 다르다, 둘 다 20kg 박스', () => {
    expect(unitsPerBoxOf(it_({ name: '고춧가루 1kg', spec: '1kg * 20', boxSize: 20, category: '고춧가루' }))).toBe(20);
    expect(unitsPerBoxOf(it_({ name: '고춧가루 5kg', spec: '5kg * 4', boxSize: 4, category: '고춧가루' }))).toBe(4);
  });

  it('boxSize가 규격보다 세다 — 품목에 직접 박아 둔 값이 최종', () => {
    expect(unitsPerBoxOf(it_({ spec: '1kg * 20', boxSize: 6 }))).toBe(6);
  });

  it('boxSize가 없으면 규격의 개입수', () => {
    expect(unitsPerBoxOf(it_({ spec: '300ml * 24' }))).toBe(24);
  });

  it('향미유는 규격이 없어도 12 — 옛 품목이 아직 있다', () => {
    expect(unitsPerBoxOf(it_({ name: '참진한기름', category: '향미유' }))).toBe(12);
    expect(unitsPerBoxOf(it_({ name: '참향기름', subtype: '향미유' }))).toBe(12);
  });

  it('그 외는 0 — 박스로 주문하지 않는다', () => {
    expect(unitsPerBoxOf(it_({ name: '참기름/병/A/300ml', spec: '300ml * 1', category: '참기름' }))).toBe(0);
    expect(unitsPerBoxOf(undefined)).toBe(0);
  });
});
