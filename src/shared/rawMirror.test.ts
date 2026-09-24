import { describe, expect, it } from 'vitest';
import { rawMirrorMatches } from './rawMirror';

describe('원료 상태와 품목 사본의 0.001kg 등식', () => {
  it.each([0, 0.001, 0.002, 0.5, 1, -0.001])('차이 %skg', delta => {
    expect(rawMirrorMatches(100 + delta, 100)).toBe(delta === 0);
  });

  it('부동소수 연산의 극소 오차만 같은 저장값으로 본다', () => {
    expect(rawMirrorMatches(0.1 + 0.2, 0.3)).toBe(true);
    expect(rawMirrorMatches(100.00000001, 100)).toBe(true);
  });

  it('숫자가 아닌 값은 불일치로 본다', () => {
    expect(rawMirrorMatches(Number.NaN, 100)).toBe(false);
    expect(rawMirrorMatches(100, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
