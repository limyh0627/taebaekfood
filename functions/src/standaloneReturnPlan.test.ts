import { describe, expect, it } from 'vitest';
import { planStandaloneReturn } from './returnReversalPlan';

describe('원전표 없는 반품 전표', () => {
  const item = { itemId: 'box', quantity: 2, supply: 200, tax: 20, accountCode: '404', isResellable: true };
  it('매출 반품은 기존 전표 없이 새 전표의 차대와 재고 입고를 계산한다', () => {
    expect(planStandaloneReturn({ returnType: '매출', totalAmount: 220, items: [item] })).toEqual({
      amount: 220, supply: 200, tax: 20,
      journalLines: [
        { accountCode: '404', side: '차변', amount: 200 },
        { accountCode: '255', side: '차변', amount: 20 },
        { accountCode: '108', side: '대변', amount: 220 },
      ],
      stockEffects: [{ itemId: 'box', quantityDelta: 2 }],
    });
  });
  it('매입 반품은 지정 채무계정과 재고 출고를 사용한다', () => {
    const result = planStandaloneReturn({ returnType: '매입', payableAccountCode: '253',
      totalAmount: 220, items: [{ ...item, accountCode: '500', isResellable: false }] });
    expect(result.journalLines).toContainEqual({ accountCode: '253', side: '차변', amount: 220 });
    expect(result.stockEffects).toEqual([{ itemId: 'box', quantityDelta: -2 }]);
  });
  it('금액 불일치·중복 품목·매입 채무계정 누락은 전표 발행 전에 거절한다', () => {
    expect(() => planStandaloneReturn({ returnType: '매출', totalAmount: 221, items: [item] })).toThrow();
    expect(() => planStandaloneReturn({ returnType: '매출', totalAmount: 440, items: [item, item] })).toThrow();
    expect(() => planStandaloneReturn({ returnType: '매입', totalAmount: 220, items: [item] })).toThrow();
  });
});
