import { describe, expect, it } from 'vitest';
import { formatQuantity } from './quantityDisplay';

describe('서류 수량 표시', () => {
  it.each([
    [0, '0'],
    [0.0001, '0.0001'],
    [1.2345, '1.2345'],
    [2.5, '2.5'],
    [20, '20'],
    [-0.0001, '-0.0001'],
    [1.2345678901234567, '1.2345678901234567'],
    [9007199254740991, '9,007,199,254,740,991'],
    [1e-20, '0.00000000000000000001'],
    [Number.MIN_VALUE, `0.${'0'.repeat(323)}5`],
  ] as const)('%s의 수량을 정수 반올림이나 소수 세 자리 제한 없이 표시한다', (qty, expected) => {
    const shown = formatQuantity(qty);
    expect(shown).toBe(expected);
    expect(Number(shown.replaceAll(',', ''))).toBe(qty);
  });
});
