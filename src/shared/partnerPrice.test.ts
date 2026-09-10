import { describe, it, expect } from 'vitest';
import { salePriceOf, purchasePriceOf, salePriceRange, isPurchaseLine, partnerNamesByItem } from './partnerPrice';
import type { PartnerItem } from './types';

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

/**
 * **품목 → 파는 거래처 이름 표**(2026-09-09 사장님: "품목명 검색이 왤케 느리냐").
 * 검색이 한 글자마다 품목×거래처×거래처단가를 돌고 있었다 — 실측 2억 번.
 */
describe('거래처 이름 표', () => {
  const 거래처 = [{ id: 'C1', name: '해피유통' }, { id: 'C2', name: '가득찬식품' }, { id: 'C3', name: '이름없음' }];
  const 연결 = (o: Partial<PartnerItem>): PartnerItem =>
    ({ id: 'x', itemId: 'i1', partnerId: 'C1', price: 0, ...o } as PartnerItem);

  it('그 품목을 파는 거래처 이름을 한 줄로 모은다 — 부르는 쪽은 includes 한 번만 한다', () => {
    const 표 = partnerNamesByItem([연결({}), 연결({ id: 'y', partnerId: 'C2' })], 거래처);
    expect(표.get('i1')).toBe('해피유통 가득찬식품');
  });

  it('소문자로 담는다 — 검색어도 소문자라 그대로 견줄 수 있다', () => {
    const 표 = partnerNamesByItem([연결({ partnerId: 'C1' })], [{ id: 'C1', name: 'HappY' }]);
    expect(표.get('i1')).toBe('happy');
  });

  it('매입 연결은 안 담는다 — 파는 거래처가 아니다', () => {
    const 표 = partnerNamesByItem([연결({ Direction: 'in' })], 거래처);
    expect(표.get('i1')).toBeUndefined();
  });

  it('같은 거래처가 여러 줄이어도 이름은 한 번만', () => {
    const 표 = partnerNamesByItem([연결({}), 연결({ id: 'y' })], 거래처);
    expect(표.get('i1')).toBe('해피유통');
  });

  it('없는 거래처를 가리키는 줄은 건너뛴다 — 지워진 거래처', () => {
    expect(partnerNamesByItem([연결({ partnerId: '없음' })], 거래처).get('i1')).toBeUndefined();
  });

  it('빈 입력에도 안 터진다', () => {
    expect(partnerNamesByItem(undefined, undefined).size).toBe(0);
    expect(partnerNamesByItem([], 거래처).size).toBe(0);
  });
});
