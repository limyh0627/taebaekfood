import { describe, it, expect } from 'vitest';
import { bomQty } from './bom';

describe('bomQty', () => {
  it('박힌 수량을 그대로 쓴다', () => {
    expect(bomQty({ stock: 2 })).toBe(2);    // 이중캡-골드 ×2
    expect(bomQty({ stock: 3 })).toBe(3);    // 180ml캡-골드 ×3
    expect(bomQty({ stock: 20 })).toBe(20);  // 20kg박스 ← 낱개 ×20
  });
  it('0은 0 — BOM에 두되 차감은 안 한다(테이프)', () => {
    expect(bomQty({ stock: 0 })).toBe(0);
    expect(bomQty({ stock: -5 })).toBe(0);
  });
  it('값이 안 박힌 옛 데이터는 1', () => {
    expect(bomQty({ stock: 1 })).toBe(1);
    expect(bomQty({} as { stock: number })).toBe(1);
    expect(bomQty(undefined as unknown as { stock: number })).toBe(1);
  });
});
