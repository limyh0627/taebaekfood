import { describe, it, expect } from 'vitest';
import type { Partner, PartnerType } from './types';

/**
 * 금융기관은 **사고파는 상대가 아니다.** 매입처로 두면 발주·입고·매입전표 거래처 목록에
 * 은행이 섞인다. 화면들이 쓰는 필터 식을 그대로 옮겨 두고, 새 갈래가 거기 안 걸리는지 본다.
 */
const p = (name: string, partnerType?: PartnerType): Partner =>
  ({ id: name, name, type: '일반', partnerType } as Partner);

// 화면에 흩어져 있는 필터와 **같은 식**
const 매입처 = (c: Partner) => c.partnerType === '매입처' || c.partnerType === '매출+매입처';
const 매출처 = (c: Partner) => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처';

const 목록 = [
  p('가득찬식품', '매출처'),
  p('한국농수산물유통공사', '매입처'),
  p('풍회유통', '매출+매입처'),
  p('농협', '금융기관'),
  p('옛거래처'),                 // partnerType 없음 = 매출처(하위 호환)
];

describe('금융기관 갈래', () => {
  it('매입처 목록에 안 뜬다 — 발주·입고·매입전표', () => {
    expect(목록.filter(매입처).map(c => c.name)).toEqual(['한국농수산물유통공사', '풍회유통']);
  });

  it('매출처 목록에 안 뜬다 — 주문 생성·매출전표', () => {
    expect(목록.filter(매출처).map(c => c.name)).toEqual(['가득찬식품', '풍회유통', '옛거래처']);
  });

  it('갈래 없는 옛 거래처는 여전히 매출처로 본다 — 하위 호환', () => {
    expect(매출처(p('옛거래처'))).toBe(true);
    expect(매입처(p('옛거래처'))).toBe(false);
  });

  it('일반전표는 전체에서 고르므로 은행도 보인다 — 대출상환·이자', () => {
    expect(목록.some(c => c.name === '농협')).toBe(true);
  });
});
