import { describe, it, expect } from 'vitest';
import { bomQty } from './bom';

describe('bomQty', () => {
  it('박힌 수량을 그대로 쓴다', () => {
    expect(bomQty({ stock: 2 })).toBe(2);    // 이중캡-골드 ×2
    expect(bomQty({ stock: 3 })).toBe(3);    // 180ml캡-골드 ×3
    expect(bomQty({ stock: 20 })).toBe(20);  // 20kg박스 ← 낱개 ×20
  });
  it('없거나 0 이하면 1', () => {
    expect(bomQty({ stock: 1 })).toBe(1);
    expect(bomQty({ stock: 0 })).toBe(1);
    expect(bomQty({ stock: -5 })).toBe(1);
    expect(bomQty({} as { stock: number })).toBe(1);
    expect(bomQty(undefined as unknown as { stock: number })).toBe(1);
  });
});
