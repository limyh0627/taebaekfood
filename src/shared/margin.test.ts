import { describe, it, expect } from 'vitest';
import { marginOf, marginFromSupply, ratePct } from './margin';

/**
 * 마진 셈이 네 벌로 흩어져 있었고, 둘은 **세금 포함 단가를 그대로 나눴다.**
 * 실제 거래처 단가 328줄 중 308줄이 갈렸고 부호까지 뒤집혔다.
 */
describe('마진은 공급가에서 센다', () => {
  it('**부가세를 뺀 값이 분모다** — 판매가로 나누면 마진이 부풀어 보인다', () => {
    //  볶음참깨/1kg 단가 5,600 원가 5,510 (과세)
    const m = marginOf(5600, 5510);
    expect(m.supply).toBe(5091);                    // round(5600 / 1.1)
    expect(m.margin).toBe(-419);                    // 밑진다
    expect(Math.round(m.marginRate * 1000) / 10).toBe(-8.2);
    //  옛 방식은 +1.6% 로 보였다 — 부호가 뒤집힌다
    expect(Math.round((5600 - 5510) / 5600 * 1000) / 10).toBe(1.6);
  });

  it('면세면 판매가가 곧 공급가다', () => {
    const m = marginOf(5600, 5510, true);
    expect(m.supply).toBe(5600);
    expect(m.margin).toBe(90);
  });

  it('밑지면 음수 그대로 — 감추면 밑지는 걸 못 본다', () => {
    expect(marginOf(1100, 2000).margin).toBeLessThan(0);
    expect(marginOf(1100, 2000).marginRate).toBeLessThan(0);
  });

  it('마진율과 원가율은 다르다', () => {
    //  공급가 1,000 · 원가 800 → 남는 돈 200
    const m = marginOf(1100, 800);
    expect(m.supply).toBe(1000);
    expect(m.margin).toBe(200);
    expect(m.marginRate).toBeCloseTo(0.2, 6);     // 판 값 대비
    expect(m.markupRate).toBeCloseTo(0.25, 6);    // 든 값 대비
  });

  it('0이거나 빈 값이면 0으로 — 나누기가 터지지 않는다', () => {
    expect(marginOf(0, 0)).toMatchObject({ supply: 0, cost: 0, margin: 0, marginRate: 0, markupRate: 0 });
    expect(marginOf(NaN as number, NaN as number).marginRate).toBe(0);
    expect(marginOf(1100, 0).markupRate).toBe(0);   // 원가가 0이면 원가율은 셀 수 없다
  });

  it('공급가를 이미 아는 화면은 두 번 안 뺀다', () => {
    //  견적서는 줄마다 세액을 따로 세므로 공급가를 손에 들고 있다
    expect(marginFromSupply(1000, 800)).toMatchObject({ supply: 1000, margin: 200 });
    //  같은 값을 marginOf 에 넣으면 또 나눠서 909 가 된다 — 그래서 갈라 뒀다
    expect(marginOf(1000, 800).supply).toBe(909);
  });

  it('백분율 표기', () => {
    expect(ratePct(0.2)).toBe('20.0%');
    expect(ratePct(-0.082)).toBe('-8.2%');
    expect(ratePct(0.2, 0)).toBe('20%');
  });
});
