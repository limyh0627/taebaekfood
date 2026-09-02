import { describe, it, expect } from 'vitest';
import { lineAmount, lineAmountOf, sumLines } from './lineAmount';

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
