import { describe, expect, it } from 'vitest';
import { planReturnReversal } from './returnReversalPlan';

const source = { id: 'sale-1', companyId: 'taebaek', type: '매출' as const, partnerId: 'partner-1',
  totalSupply: 100, totalTax: 10, totalAmount: 110,
  items: [{ itemId: 'item-1', accountCode: '404', qty: 2, supply: 100, tax: 10, total: 110 }] };
const request = { id: 'return-1', companyId: 'taebaek', linkedStatementId: source.id,
  partnerId: source.partnerId, status: 'pending' as const, returnType: '매출' as const,
  totalAmount: 110, items: [{ itemId: 'item-1', quantity: 2, isResellable: true }] };

describe('source-linked return reverse-journal plan', () => {
  it('reverses sales receivable, revenue and VAT without inventing cash', () => {
    expect(planReturnReversal('taebaek', request, source, [])).toEqual({ amount: 110, supply: 100, tax: 10,
      journalLines: [{ accountCode: '404', side: '차변', amount: 100 },
        { accountCode: '255', side: '차변', amount: 10 }, { accountCode: '108', side: '대변', amount: 110 }],
      stockEffects: [{ itemId: 'item-1', quantityDelta: 2 }] });
  });

  it('reverses purchase payable, item account and input VAT with outgoing physical stock', () => {
    const purchase = { ...source, id: 'purchase-1', type: '매입' as const,
      items: [{ ...source.items[0], accountCode: '500' }] };
    const purchaseRequest = { ...request, linkedStatementId: purchase.id, returnType: '매입' as const,
      items: [{ ...request.items[0], isResellable: false }] };
    expect(planReturnReversal('taebaek', purchaseRequest, purchase, [])).toEqual({ amount: 110, supply: 100, tax: 10,
      journalLines: [{ accountCode: '500', side: '대변', amount: 100 },
        { accountCode: '135', side: '대변', amount: 10 }, { accountCode: '251', side: '차변', amount: 110 }],
      stockEffects: [{ itemId: 'item-1', quantityDelta: -2 }] });
    expect(planReturnReversal('taebaek', purchaseRequest, { ...purchase,
      items: [{ ...purchase.items[0], accountCode: '253' }] }, []).journalLines.at(-1)?.accountCode).toBe('253');
  });

  it('enforces remaining source quantity and exact partial supply/tax', () => {
    const half = { ...request, totalAmount: 55, items: [{ ...request.items[0], quantity: 1 }] };
    expect(planReturnReversal('taebaek', half, source, []).amount).toBe(55);
    const prior = { ...half, id: 'older', status: 'processed' as const };
    expect(planReturnReversal('taebaek', half, source, [prior]).amount).toBe(55);
    expect(() => planReturnReversal('taebaek', request, source, [prior])).toThrow('남은 수량');
    expect(() => planReturnReversal('taebaek', half, { ...source, totalTax: 9 }, [])).toThrow('금액 근거');
  });

  it('fails closed on missing source, other company, missing account and legacy zero price', () => {
    expect(() => planReturnReversal('taebaek', { ...request, linkedStatementId: undefined }, source, [])).toThrow('원전표');
    expect(() => planReturnReversal('taebaek', { ...request, companyId: 'punghoe' }, source, [])).toThrow('회사');
    expect(() => planReturnReversal('taebaek', request, { ...source, items: [{ ...source.items[0], accountCode: undefined }] }, []))
      .toThrow('계정');
    expect(() => planReturnReversal('taebaek', { ...request, totalAmount: 0 }, source, [])).toThrow('역분개 금액');
    const freeSource = { ...source, totalSupply: 0, totalTax: 0, totalAmount: 0,
      items: [{ ...source.items[0], supply: 0, tax: 0, total: 0 }] };
    expect(() => planReturnReversal('taebaek', { ...request, totalAmount: 0 }, freeSource, []))
      .toThrow('금액 근거');
    const mixedSource = { ...source, totalSupply: 100, totalTax: 10, totalAmount: 110,
      items: [{ ...source.items[0], itemId: 'free', supply: 0, tax: 0, total: 0 },
        { ...source.items[0], itemId: 'paid' }] };
    const freeLineRequest = { ...request, totalAmount: 0, items: [{ ...request.items[0], itemId: 'free' }] };
    expect(() => planReturnReversal('taebaek', freeLineRequest, mixedSource, []))
      .toThrow('대상 품목의 원전표 금액');
  });

});
