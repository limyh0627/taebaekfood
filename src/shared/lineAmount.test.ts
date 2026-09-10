import { describe, it, expect } from 'vitest';
import { lineAmount, lineAmountOf, sumLines, lineAmountFromSupply, priceParts, vatOn, costOfPurchase, VAT_RATE } from './lineAmount';

/**
 * 이 셈이 아홉 군데로 흩어져 두 갈래로 갈려 있었다. 여기 하나로 모았으니
 * **갈렸던 자리**를 먼저 잠근다.
 */
describe('세금 포함 단가에서 공급가액·세액을 푼다', () => {
  it('과세 — 합계에서 역산한다', () => {
    expect(lineAmount(1, 1100)).toEqual({ gross: 1100, supply: 1000, tax: 100 });
  });

  it('면세 — 합계가 그대로 공급가액이고 세액은 0', () => {
    expect(lineAmount(3, 5000, true)).toEqual({ gross: 15000, supply: 15000, tax: 0 });
  });

  it('**합계를 나눈다** — 단가를 먼저 나누던 자리가 2원 어긋났다', () => {
    //  단가 1,070 × 7개
    //    합계 기준 : round(7490 / 1.1) = 6809   ← 이게 맞다(세금계산서는 공급대가에서 역산)
    //    단가 기준 : round(1070 / 1.1) * 7 = 973 * 7 = 6811
    expect(lineAmount(7, 1070).supply).toBe(6809);
    expect(Math.round(1070 / 1.1) * 7).toBe(6811);   // 옛 주문 경로가 내던 값
  });

  it('공급가액 + 세액 = 합계 — 언제나', () => {
    for (const [q, p] of [[1, 1070], [7, 1070], [3, 999], [13, 8877], [2.5, 4400], [1, 1]] as const) {
      const r = lineAmount(q, p);
      expect(r.supply + r.tax).toBe(r.gross);
    }
  });

  it('반품은 음수 그대로 — >0 으로 거르면 세 칸이 통째로 빈다', () => {
    const r = lineAmount(-1, 1100);
    expect(r).toEqual({ gross: -1100, supply: -1000, tax: -100 });
    expect(r.supply + r.tax).toBe(r.gross);
  });

  it('소수 수량도 원 단위로 맞춘다 — 합계가 1원씩 어긋나던 자리다', () => {
    const r = lineAmount(2.5, 4400);
    expect(Number.isInteger(r.gross)).toBe(true);
    expect(Number.isInteger(r.supply)).toBe(true);
    expect(Number.isInteger(r.tax)).toBe(true);
  });

  it('0이거나 빈 값이면 0', () => {
    expect(lineAmount(0, 1100)).toEqual({ gross: 0, supply: 0, tax: 0 });
    expect(lineAmount(NaN as number, NaN as number)).toEqual({ gross: 0, supply: 0, tax: 0 });
  });
});

describe('입력칸에서 오는 글자', () => {
  it('쉼표·원·공백을 걷어낸다', () => {
    expect(lineAmountOf('7', '1,070원')).toEqual(lineAmount(7, 1070));
    expect(lineAmountOf(' 3 ', ' 5 000 ')).toEqual(lineAmount(3, 5000));
  });
  it('빈 칸은 0', () => {
    expect(lineAmountOf('', '')).toEqual({ gross: 0, supply: 0, tax: 0 });
  });
});

describe('줄을 더할 때', () => {
  it('줄마다 반올림한 값을 더한다 — 합계를 다시 나누면 줄 합과 안 맞는다', () => {
    const lines = [lineAmount(7, 1070), lineAmount(3, 999), lineAmount(1, 1)];
    const t = sumLines(lines);
    expect(t.supply).toBe(lines.reduce((a, l) => a + l.supply, 0));
    expect(t.supply + t.tax).toBe(t.gross);
    //  전표 합계를 다시 나눈 값과는 다를 수 있다 — 그래도 줄 합이 진짜다
    expect(t.gross).toBe(7490 + 2997 + 1);
  });

  it('과세와 면세가 섞여도 더해진다', () => {
    const t = sumLines([lineAmount(1, 1100), lineAmount(1, 5000, true)]);
    expect(t).toEqual({ gross: 6100, supply: 6000, tax: 100 });
  });

  it('빈 목록은 0', () => {
    expect(sumLines([])).toEqual({ gross: 0, supply: 0, tax: 0 });
  });
});

/**
 * **단가라는 말이 두 뜻이다.** (2026-09-03 사장님 지적 — "화면에서 판매단가와 공급가액이 구분이 안 된다")
 *
 *   판매단가(세포함)   손님한테 부르는 값 — 전표·거래명세서    `lineAmount`
 *   공급가 단가(세별도) 원가에 마진을 얹은 값 — 견적서          `lineAmountFromSupply`
 */
describe('공급가 단가에서 세액을 얹는다', () => {
  it('사장님 셈 그대로 — 공급가 13,000 → 세 1,300 → 판매가 14,300', () => {
    expect(lineAmountFromSupply(1, 13_000)).toEqual({ supply: 13_000, tax: 1_300, gross: 14_300 });
  });

  it('화면의 그 줄 — 공급가 99,000 → 세 9,900 → 108,900', () => {
    expect(lineAmountFromSupply(1, 99_000)).toEqual({ supply: 99_000, tax: 9_900, gross: 108_900 });
  });

  it('면세면 세액이 0이고 판매가가 곧 공급가다', () => {
    expect(lineAmountFromSupply(3, 5_000, true)).toEqual({ supply: 15_000, tax: 0, gross: 15_000 });
  });

  it('수량을 곱한 뒤 세를 얹는다 — 줄마다 반올림한다', () => {
    expect(lineAmountFromSupply(7, 1_070)).toEqual({ supply: 7_490, tax: 749, gross: 8_239 });
  });

  it('**반품(음수)도 그대로** — 거르면 반품 줄이 통째로 비어 보인다', () => {
    expect(lineAmountFromSupply(-2, 10_000)).toEqual({ supply: -20_000, tax: -2_000, gross: -22_000 });
  });

  it('**거울이지만 완전한 왕복은 아니다** — 근거가 다르면 1원쯤 갈린다', () => {
    //  공급가 99,000 로 매기면 판매가 108,900. 그 108,900 을 세포함으로 되풀면 다시 99,000.
    const 올림 = lineAmountFromSupply(1, 99_000);
    expect(lineAmount(1, 올림.gross).supply).toBe(99_000);
    //  그런데 딱 안 떨어지는 값은 갈린다 — 어느 쪽이 근거인지 화면이 정해야 한다
    const 갈림 = lineAmountFromSupply(1, 13_333);
    expect(갈림.gross).toBe(14_666);
    expect(lineAmount(1, 14_666).supply).toBe(13_333);
  });
});

describe('단가 딱지 — 과세면 공급가액을 곁들인다', () => {
  it('과세면 둘 다 — 원가(세별도)와 나란히 두려면 공급가가 보여야 한다', () => {
    expect(priceParts(99_000)).toEqual({ sale: 99_000, supply: 90_000, showSupply: true });
  });
  it('면세면 곁들일 게 없다', () => {
    expect(priceParts(99_000, true)).toEqual({ sale: 99_000, supply: 99_000, showSupply: false });
  });
  it('0이나 빈 값이면 안 곁들인다 — 0원 옆에 0원을 또 적지 않는다', () => {
    expect(priceParts(0).showSupply).toBe(false);
    expect(priceParts(undefined).showSupply).toBe(false);
    expect(priceParts(null).sale).toBe(0);
  });
});

describe('vatOn — 공급가액에 붙는 세액', () => {
  it('공급가액의 10%', () => {
    expect(vatOn(100000)).toBe(10000);
  });
  it('면세는 0', () => {
    expect(vatOn(100000, true)).toBe(0);
  });
  it('원 단위로 반올림한다', () => {
    expect(vatOn(13333)).toBe(1333);
    expect(vatOn(13335)).toBe(1334);
  });
  it('반품(음수)도 음수로 낸다 — 0으로 뭉개면 반품 세액이 사라진다', () => {
    expect(vatOn(-100000)).toBe(-10000);
  });
  it('빈 값은 0', () => {
    expect(vatOn(NaN)).toBe(0);
    expect(vatOn(undefined as any)).toBe(0);
  });
  it('lineAmountFromSupply 의 세액과 같다 — 두 셈이 갈리면 안 된다', () => {
    for (const s of [1000, 13333, 99999, 1_234_567]) {
      expect(vatOn(s)).toBe(lineAmountFromSupply(1, s).tax);
    }
  });
});

/**
 * **매입 원가는 공급가액이다.**
 *
 * 전표에 치는 단가는 **세포함**이고 품목 원가는 **공급가액**이다. 둘을 한 필드처럼 복사하면
 * 과세 품목 원가가 10% 부푼다 — 2026-09-06 에 60개를 되돌렸는데 전표를 다시 끊자 되살아났다.
 * 밑을 맞추는 셈은 `costOfPurchase` 한 곳뿐이다.
 *
 * 여기 있던 `VAT_UP` 시험은 지웠다(2026-09-10). 그 상수는 **앱 코드가 한 번도 안 썼고**,
 * 인수인계 표에만 "면세 원료가 과세품 원가에 얹는 곱수" 로 남아 "원가는 공급가액" 절과
 * 서로 어긋나 있었다. 다음 사람이 옛 셈을 되살릴 자리라 상수째 없앴다.
 */
describe('매입 원가 — 세포함 단가에서 공급가액을 낸다', () => {
  it('과세 11,000원을 사면 원가는 10,000원이다', () => {
    expect(costOfPurchase(11000, false)).toBe(10000);
  });

  it('면세 11,000원을 사면 원가도 11,000원이다 — 뗄 세금이 없다', () => {
    expect(costOfPurchase(11000, true)).toBe(11000);
  });

  it('`exempt` 를 안 넘기면 과세로 본다 — 빠뜨려서 원가가 부푸는 쪽이 아니라 줄어드는 쪽으로', () => {
    expect(costOfPurchase(11000)).toBe(10000);
  });

  it('lineAmount 의 공급가액과 같은 값이다 — 셈이 두 벌이면 언젠가 갈린다', () => {
    for (const price of [1000, 4021, 18000, 135000, 1233780]) {
      expect(costOfPurchase(price, false)).toBe(lineAmount(1, price, false).supply);
      expect(costOfPurchase(price, true)).toBe(lineAmount(1, price, true).supply);
    }
  });
});
