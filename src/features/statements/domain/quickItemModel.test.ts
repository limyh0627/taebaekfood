import { describe, expect, it } from 'vitest';
import { quickItemMetrics } from './quickItemModel';

describe('빠른 품목 입력 계산', () => {
  it('과세 단가는 공급가로 내려서 금액과 마진을 계산한다', () => {
    expect(quickItemMetrics({ quantity: 2, unitPrice: 5_500, cost: 4_000, taxExempt: false })).toEqual({
      supply: 10_000, tax: 1_000, marginRate: 0.2, unitSupply: 5_000, showUnitSupply: true,
    });
  });

  it('면세 단가는 입력값 자체가 공급가다', () => {
    expect(quickItemMetrics({ quantity: 2, unitPrice: 5_000, cost: 4_000, taxExempt: true })).toEqual({
      supply: 10_000, tax: 0, marginRate: 0.2, unitSupply: 5_000, showUnitSupply: false,
    });
  });
});
