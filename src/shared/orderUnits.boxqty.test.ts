import { describe, it, expect } from 'vitest';
import { unpackQty, boxQtyLabel, unitsPerBoxOf } from './orderUnits';
import type { Item } from './types';

/**
 * 개입수 12를 화면 일곱 군데가 손으로 박아 놓고 있었다.
 * 박스 품목 140개 중 102개가 12개입이 아니다 — 쓰는 날 바로 틀리는 자리였다.
 */
const 품목 = (over: Partial<Item> = {}): Item => ({ id: 'i1', name: '참기름', ...over } as Item);

describe('개입수는 품목이 안다', () => {
  it('boxSize 가 가장 세다', () => {
    expect(unitsPerBoxOf(품목({ boxSize: 20, spec: '1kg * 10' }))).toBe(20);
  });
  it('없으면 규격에서 읽는다', () => {
    expect(unitsPerBoxOf(품목({ spec: '1kg * 20' }))).toBe(20);
    expect(unitsPerBoxOf(품목({ spec: '300ml * 40' }))).toBe(40);
  });
  it('향미유는 규격이 없을 때만 12로 물러선다', () => {
    expect(unitsPerBoxOf(품목({ category: '향미유' }))).toBe(12);
    //  규격이 있으면 규격이 이긴다 — 여기를 12로 박아 두면 20개입이 12개로 잡힌다
    expect(unitsPerBoxOf(품목({ category: '향미유', spec: '1750ml * 10' }))).toBe(10);
  });
  it('박스로 안 파는 품목은 0', () => {
    expect(unitsPerBoxOf(품목({ spec: '1kg' }))).toBe(0);
    expect(unitsPerBoxOf(undefined)).toBe(0);
  });
});

describe('박스를 낱개로 편다', () => {
  it('박스면 개입수를 곱한다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }), true)).toBe(60);
  });
  it('낱개면 그대로 — 곱하면 안 된다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }), false)).toBe(3);
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }))).toBe(3);
  });
  it('개입수를 모르면 그대로 둔다 — 12를 지어내지 않는다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg' }), true)).toBe(3);
    expect(unpackQty(3, undefined, true)).toBe(3);
  });
  it('20개입 품목을 12로 세면 48개가 샌다', () => {
    const p = 품목({ spec: '1kg * 20' });
    expect(unpackQty(3, p, true)).toBe(60);
    expect(3 * 12).toBe(36);          // 옛 화면이 찍던 값
  });
});

describe('박스 수량 표기', () => {
  it('개입수를 알면 낱개까지 적는다', () => {
    expect(boxQtyLabel(3, 20)).toBe('3BOX(60개)');
    expect(boxQtyLabel('3', 20, 'B')).toBe('3B(60개)');
  });
  it('**모르면 개수를 안 적는다** — 12라고 지어내면 틀린 값을 확신에 차서 보여준다', () => {
    expect(boxQtyLabel(3, 0)).toBe('3BOX');
    expect(boxQtyLabel(3, undefined)).toBe('3BOX');
    expect(boxQtyLabel(3, 1)).toBe('3BOX');
  });
  it('빈 값이어도 개입수를 알면 그대로 적는다', () => {
    expect(boxQtyLabel('', 20)).toBe('0BOX(0개)');
  });
});
