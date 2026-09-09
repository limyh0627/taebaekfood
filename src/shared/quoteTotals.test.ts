import { describe, it, expect } from 'vitest';
import { quoteTotals, type QuoteLineLike } from './quoteTotals';

const 줄 = (o: Partial<QuoteLineLike>): QuoteLineLike => ({ name: '참기름', qty: 1, price: 10000, ...o });

describe('견적 합계', () => {
  it('과세 줄은 공급가에 10% 를 붙인다 — 단가는 세별도다', () => {
    const t = quoteTotals([줄({ isTaxExempt: false })]);
    expect(t).toMatchObject({ supply: 10000, tax: 1000, total: 11000 });
  });

  it('면세 줄은 세액이 0', () => {
    expect(quoteTotals([줄({ isTaxExempt: true })])).toMatchObject({ supply: 10000, tax: 0, total: 10000 });
  });

  it('수량을 곱한다', () => {
    expect(quoteTotals([줄({ qty: 3, isTaxExempt: false })])).toMatchObject({ supply: 30000, tax: 3000 });
  });

  it('마진은 공급가 기준이다 — 부가세는 받아서 그대로 내는 돈이라 남는 게 아니다', () => {
    const t = quoteTotals([줄({ price: 10000, cost: 6000, isTaxExempt: false })]);
    expect(t.cost).toBe(6000);
    expect(t.margin).toBe(4000);
    //  marginRate 는 **비율**이다(0.4 = 40%). 화면은 shared/margin.ratePct 로 % 를 붙인다.
    expect(t.marginRate).toBeCloseTo(0.4, 5);
  });
});

/**
 * **안 고른 줄은 안 더한다**(2026-09-09 사장님: "-가 디폴트고 사용자가 고르게 만들어").
 * 과세로 쳐서 더하면 화면에 그럴듯한 숫자가 떠서 안 골랐다는 걸 못 알아챈다.
 */
describe('과세·면세를 안 고른 줄', () => {
  it('합계에 안 들어간다', () => {
    const t = quoteTotals([줄({ isTaxExempt: false }), 줄({ price: 50000 })]);
    expect(t.supply).toBe(10000);            // 5만원짜리는 안 더해졌다
    expect(t.total).toBe(11000);
  });

  it('몇 줄이 안 정해졌는지 같이 돌려준다 — 저장을 막는 근거다', () => {
    expect(quoteTotals([줄({ isTaxExempt: false }), 줄({}), 줄({})]).undecided).toBe(2);
  });

  it('다 골랐으면 0', () => {
    expect(quoteTotals([줄({ isTaxExempt: false }), 줄({ isTaxExempt: true })]).undecided).toBe(0);
  });

  it('빈 줄은 안 센다 — 아직 아무것도 안 적은 줄까지 막으면 저장을 영영 못 한다', () => {
    expect(quoteTotals([줄({ name: '' }), 줄({ name: '   ' })]).undecided).toBe(0);
  });

  it('줄이 없으면 전부 0', () => {
    expect(quoteTotals([])).toMatchObject({ supply: 0, tax: 0, total: 0, cost: 0, undecided: 0 });
  });
});
