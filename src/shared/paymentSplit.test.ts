import { describe, it, expect } from 'vitest';
import { splitPayment, owedNow } from './paymentSplit';

describe('받은 돈을 갚은 몫과 초과분으로 가른다', () => {
  it('갚을 것 안쪽이면 전액이 상계다', () => {
    expect(splitPayment(500_000, 632_000)).toEqual({ settled: 500_000, over: 0 });
  });
  it('딱 맞으면 초과가 0이다', () => {
    expect(splitPayment(632_000, 632_000)).toEqual({ settled: 632_000, over: 0 });
  });
  it('넘게 받으면 넘은 만큼만 초과다', () => {
    expect(splitPayment(700_000, 632_000)).toEqual({ settled: 632_000, over: 68_000 });
  });
  it('갚을 게 없으면 전액이 초과다 — 이게 진짜 선수금이다', () => {
    expect(splitPayment(300_000, 0)).toEqual({ settled: 0, over: 300_000 });
  });
  it('잔액이 음수(이미 더 받았다)여도 0으로 본다 — 더 깎으면 안 된다', () => {
    expect(splitPayment(100_000, -500_000)).toEqual({ settled: 0, over: 100_000 });
  });
  it('갚은 몫 + 초과분 = 받은 돈 — 언제나', () => {
    for (const [t, o] of [[632_000, 0], [700_000, 632_000], [1, 0], [999_999, 1]] as const) {
      const r = splitPayment(t, o);
      expect(r.settled + r.over).toBe(t);
    }
  });
  it('0이거나 음수면 아무것도 안 가른다', () => {
    expect(splitPayment(0, 100)).toEqual({ settled: 0, over: 0 });
    expect(splitPayment(-1, 100)).toEqual({ settled: 0, over: 0 });
  });
});

describe('지금 갚을 것 — 방금 끊은 전표를 빠뜨리면 안 된다', () => {
  /**
   * 발행하면서 같은 클릭으로 수금하면 거래처 잔액은 **그 전표를 모른다**.
   * 그때 잔액만 보면 받을 돈이 0이라 전액이 선수금으로 간다 — 실제로 그랬다.
   */
  it('방금 끊은 전표를 더한다 — 이게 없어서 632,000이 통째로 선수금에 앉았다', () => {
    const owed = owedNow(0, 632_000);
    expect(owed).toBe(632_000);
    expect(splitPayment(632_000, owed)).toEqual({ settled: 632_000, over: 0 });
  });

  it('옛 미수가 있으면 같이 더한다', () => {
    expect(owedNow(1_000_000, 632_000)).toBe(1_632_000);
  });

  it('목록에서 수금할 때는 더할 게 없다 — 그 전표는 이미 잔액에 있다', () => {
    expect(owedNow(632_000, 0)).toBe(632_000);
    expect(splitPayment(632_000, owedNow(632_000, 0))).toEqual({ settled: 632_000, over: 0 });
  });

  it('잔액이 음수여도 방금 끊은 전표는 살아 있다', () => {
    //  이미 선수금이 깔린 거래처에 새로 팔았다 → 새 전표만큼은 갚을 것이 맞다
    expect(owedNow(-200_000, 632_000)).toBe(632_000);
  });

  it('잔액이 비어 있어도(거래 처음) 새 전표는 센다', () => {
    expect(owedNow(undefined, 632_000)).toBe(632_000);
  });

  it('발행하면서 전표보다 많이 받으면 그만큼만 선수금이다', () => {
    const owed = owedNow(0, 632_000);
    expect(splitPayment(700_000, owed)).toEqual({ settled: 632_000, over: 68_000 });
  });
});
