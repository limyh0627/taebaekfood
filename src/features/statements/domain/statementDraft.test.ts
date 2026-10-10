import { describe, expect, it } from 'vitest';
import { buildIssuedStatementDraft } from './statementDraft';

describe('buildIssuedStatementDraft', () => {
  it('전표 줄의 품목 열쇠·갈래·차대와 묶인 주문을 보존한다', () => {
    const statement = buildIssuedStatementDraft({
      identity: { id: 'stmt-1', docNo: '260916-01' }, tradeDate: '2026-09-16', type: '매출',
      partnerId: 'partner-1', partnerName: '거래처', orderIds: ['o1', 'o2'], memo: '비고',
      totals: { supply: 10000, tax: 1000, amount: 11000 }, partySnapshot: undefined,
      lines: [{ key: 'line-1', no: 1, itemId: 'item-1', lineKind: 'item', side: '차변', name: '참기름', spec: '350ml', qty: 1, price: 11000, supply: 10000, tax: 1000, total: 11000, isTaxExempt: false, accountCode: '800' }],
      allItems: [],
    });
    expect(statement.orderId).toBe('o1,o2');
    expect(statement.items[0]).toMatchObject({ itemId: 'item-1', lineKind: 'item', side: '차변', accountCode: '800' });
  });

  it('매입 전표에는 실제 품목 id만 발주 연결값으로 남긴다', () => {
    const statement = buildIssuedStatementDraft({
      identity: { id: 'stmt-2', docNo: '260916-02' }, tradeDate: '2026-09-16', type: '매입',
      partnerId: 'supplier', partnerName: '공급처', orderIds: [], memo: '',
      totals: { supply: 5000, tax: 0, amount: 5000 }, partySnapshot: undefined,
      lines: [
        { key: 'a', no: 1, itemId: 'item-1', name: '원료', spec: '', qty: 1, price: 5000, supply: 5000, tax: 0, total: 5000, isTaxExempt: true, accountCode: '500' },
        { key: 'b', no: 2, name: '택배비', spec: '', qty: 1, price: 0, supply: 0, tax: 0, total: 0, isTaxExempt: false, accountCode: '813' },
      ],
      allItems: [{ id: 'item-1', name: '원료', type: 'raw', stock: 0, minStock: 0, unit: 'kg', image: '' }],
    });
    expect((statement as typeof statement & { purchaseOrderIds?: string[] }).purchaseOrderIds).toEqual(['item-1']);
  });
});

it('신규 매입의 명시 기본 kg를 발행 원문에 보존한다', () => {
  const statement = buildIssuedStatementDraft({
    identity: { id: 'explicit-kg', docNo: 'preview' }, tradeDate: '2026-10-10', type: '매입',
    partnerId: 'p', partnerName: '매입처', orderIds: [], memo: '', totals: { supply: 40000, tax: 4000, amount: 44000 },
    partySnapshot: undefined, allItems: [], lines: [{ key: 'raw', no: 1, itemId: 'raw', name: '원료 20kg포', spec: '20kg',
      qty: 2, price: 22000, supply: 40000, tax: 4000, total: 44000, isTaxExempt: false, accountCode: '500', purchaseQuantityKg: 40 }],
  });
  expect(statement.items[0]).toMatchObject({ qty: 2, total: 44000, purchaseQuantityKg: 40 });
});
