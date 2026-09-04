import { describe, it, expect } from 'vitest';
import { salePriceOf, purchasePriceOf, salePriceRange, isPurchaseLine } from './partnerPrice';

const pi = (o: any) => o as any;
const 목록 = [
  pi({ itemId: 'i1', partnerId: 'A', Direction: 'out', price: 10000 }),
  pi({ itemId: 'i1', partnerId: 'B', Direction: 'out', price: 12000 }),
  pi({ itemId: 'i1', partnerId: 'C', price: 9000 }),              // Direction 없는 옛 줄 = 판매
  pi({ itemId: 'i1', partnerId: 'S', Direction: 'in',  price: 6000 }),  // 매입
  pi({ itemId: 'i2', partnerId: 'A', Direction: 'out', price: 0 }),     // 값이 0
];

describe('isPurchaseLine', () => {
  it("'in' 만 매입이다", () => {
    expect(isPurchaseLine({ Direction: 'in' } as any)).toBe(true);
    expect(isPurchaseLine({ Direction: 'out' } as any)).toBe(false);
  });
  it('**비어 있으면 판매다** — 옛 줄이 그렇다. 이걸 매입으로 치면 단가가 사라진다', () => {
    expect(isPurchaseLine({} as any)).toBe(false);
  });
});

describe('salePriceOf', () => {
  it('그 거래처 단가를 준다', () => {
    expect(salePriceOf(목록, 'A', 'i1')).toBe(10000);
    expect(salePriceOf(목록, 'B', 'i1')).toBe(12000);
  });
  it('Direction 이 빈 옛 줄도 판매로 잡는다', () => {
    expect(salePriceOf(목록, 'C', 'i1')).toBe(9000);
  });
  it('매입 줄은 판매단가가 아니다', () => {
    expect(salePriceOf(목록, 'S', 'i1')).toBeUndefined();
  });
  it('**없으면 undefined — 0 이 아니다.** 0 은 공짜고 undefined 는 모른다는 뜻이다', () => {
    expect(salePriceOf(목록, 'Z', 'i1')).toBeUndefined();
    expect(salePriceOf(undefined, 'A', 'i1')).toBeUndefined();
  });
  it('0 이 적혀 있으면 0 을 준다 — 안 적힌 것과 다르다', () => {
    expect(salePriceOf(목록, 'A', 'i2')).toBe(0);
  });
});

describe('purchasePriceOf', () => {
  it('매입 줄만 본다', () => {
    expect(purchasePriceOf(목록, 'S', 'i1')).toBe(6000);
    expect(purchasePriceOf(목록, 'A', 'i1')).toBeUndefined();
  });
});

describe('salePriceRange — 품목 하나에 값 하나가 없다', () => {
  it('파는 곳들의 폭을 준다', () => {
    expect(salePriceRange(목록, 'i1')).toEqual({ min: 9000, max: 12000, count: 3 });
  });
  it('0 은 안 센다 — 안 정한 것이지 공짜가 아니다', () => {
    expect(salePriceRange(목록, 'i2')).toBeNull();
  });
  it('파는 곳이 없으면 null', () => {
    expect(salePriceRange(목록, 'i9')).toBeNull();
    expect(salePriceRange(undefined, 'i1')).toBeNull();
  });
});
