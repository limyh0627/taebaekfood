import { describe, expect, it } from 'vitest';
import { planGeneralReturnReceipt } from './returnGeneralStockPlan';

const input = { operationId: 'return-1', companyId: 'taebaek', date: '2026-10-02',
  createdAt: '2026-10-02T00:00:00Z', partnerId: 'partner-1', partnerName: '거래처',
  item: { id: 'box', companyId: 'taebaek', type: 'submaterial', name: '박스', unit: '개', stock: 5, lots: [] },
  quantityDelta: 2, rawTargetExists: false };

describe('inactive general-stock return write plan', () => {
  it('prepares one deterministic receipt and current stock update', () => {
    const plan = planGeneralReturnReceipt(input);
    expect(plan).toMatchObject({ itemId: 'box', nextStock: 7,
      receipt: { companyId: 'taebaek', itemId: 'box', itemName: '박스',
        quantity: 2, unit: '개', partnerId: 'partner-1', partnerName: '거래처',
        date: '2026-10-02', createdAt: '2026-10-02T00:00:00Z', returnOperationId: 'return-1' } });
    expect(plan.receiptId).toMatch(/^rcv-return-[0-9a-f]{64}$/);
    expect(plan.receipt.id).toBe(plan.receiptId);
    expect(plan.receipt.returnReceiptFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(planGeneralReturnReceipt(input).receiptId).toBe(plan.receiptId);
  });

  it('rejects raw-target, unit, bulk and existing-lot branches', () => {
    expect(() => planGeneralReturnReceipt({ ...input, rawTargetExists: true })).toThrow('adapter');
    for (const type of ['raw', 'product', 'wip'])
      expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, type } })).toThrow('adapter');
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, subtype: '벌크' } })).toThrow('adapter');
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, lots: [{}] } })).toThrow('adapter');
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, lots: {} as unknown as unknown[] } })).toThrow('adapter');
  });

  it('rejects wrong company, purchase-return outflow, missing stock and unknown classification', () => {
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, companyId: 'punghoe' } })).toThrow('adapter');
    expect(() => planGeneralReturnReceipt({ ...input, quantityDelta: -2 })).toThrow('수량');
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, stock: Number.NaN } })).toThrow('수량');
    expect(() => planGeneralReturnReceipt({ ...input, rawTargetExists: undefined as unknown as boolean })).toThrow('adapter');
  });

  it('rejects sub-millistock amounts and keeps ambiguous hyphen pairs distinct', () => {
    expect(() => planGeneralReturnReceipt({ ...input, quantityDelta: 0.0004 })).toThrow('수량');
    expect(() => planGeneralReturnReceipt({ ...input, item: { ...input.item, stock: 5.0004 } })).toThrow('수량');
    const one = planGeneralReturnReceipt({ ...input, operationId: 'a-b', item: { ...input.item, id: 'c' } });
    const two = planGeneralReturnReceipt({ ...input, operationId: 'a', item: { ...input.item, id: 'b-c' } });
    expect(one.receiptId).not.toBe(two.receiptId);
    expect(one.receipt.returnReceiptFingerprint).not.toBe(two.receipt.returnReceiptFingerprint);
    expect(planGeneralReturnReceipt({ ...input, quantityDelta: 2.001 }).nextStock).toBe(7.001);
    expect(planGeneralReturnReceipt({ ...input, quantityDelta: 1.001, item: { ...input.item, stock: 1.001 } }))
      .toMatchObject({ nextStock: 2.002, receipt: { quantity: 1.001 } });
    expect(planGeneralReturnReceipt({ ...input, quantityDelta: 1.005, item: { ...input.item, stock: 1.005 } }))
      .toMatchObject({ nextStock: 2.01, receipt: { quantity: 1.005 } });
  });
});
