import { describe, expect, it } from 'vitest';
import { purchaseReturnAvailable, purchaseReturnRequest, salesReturnRequest } from './purchaseReturnRequest';
import type { IssuedStatement, Item } from '../../shared/types';

const item = { id: 'box', companyId: 'taebaek', type: 'submaterial', name: '박스', unit: '개' } as Item;
const source = { id: 'purchase', companyId: 'taebaek', partnerId: 'supplier', type: '매입',
  totalSupply: 200, totalTax: 20, totalAmount: 220,
  items: [{ itemId: 'box', accountCode: '500', qty: 2, supply: 200, tax: 20, total: 220 }] } as IssuedStatement;
const request = (s = source, i = item, qty = '1') => purchaseReturnRequest('taebaek', 'supplier', s, [{ itemId: 'box', qty }], [i]);
describe('purchase return request', () => {
  it('links source and exact proportional supply plus tax', () => {
    expect(request()).toMatchObject({ companyId: 'taebaek', linkedStatementId: 'purchase', totalAmount: 110,
      returnType: '매입', status: 'pending', items: [{ itemId: 'box', quantity: 1, isResellable: false }] });
  });
  it('fails closed for missing or foreign source and changed totals', () => {
    expect(() => purchaseReturnRequest('taebaek', 'supplier', undefined, [], [])).toThrow();
    for (const change of [{ companyId: 'punghoe' }, { partnerId: 'other' }, { type: '매출' }, { totalAmount: 221 }])
      expect(() => request({ ...source, ...change } as IssuedStatement)).toThrow();
  });
  it('rejects unsupported stock and unknown units', () => {
    for (const change of [{ unit: '' }, { type: 'raw' }, { subtype: '벌크' }, { lots: [{}] }, { rawMaterialName: '원료' }, { companyId: 'punghoe' }])
      expect(() => request(source, { ...item, ...change } as Item)).toThrow();
  });
  it('rejects over-return, fractional money and invalid quantities', () => {
    for (const qty of ['0', '-1', '3', 'NaN', '0.0001', '0.01']) expect(() => request(source, item, qty)).toThrow();
  });
  it('requires every company gate and release activation', () => {
    const release = { status: 'active', releaseId: 'r' };
    const gate = { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true, purchaseGeneralStockEnabled: true };
    expect(purchaseReturnAvailable('taebaek', release, gate, gate)).toBe(true);
    for (const change of [{ enabled: false }, { companyId: 'punghoe' }, { auditPassed: false }, { legacyWritersBlocked: false }, { purchaseGeneralStockEnabled: false }])
      expect(purchaseReturnAvailable('taebaek', release, { ...gate, ...change }, gate)).toBe(false);
    expect(purchaseReturnAvailable('taebaek', release, undefined, undefined)).toBe(false);
    expect(purchaseReturnAvailable('taebaek', { ...release, status: 'paused' }, gate, gate)).toBe(false);
  });
});

 describe('비재판매 매출반품', () => {
  it('완제품 lot을 재입고하지 않는 선택을 보존하고 원전표 양수 금액을 계산한다', () => {
    const sale = { ...source, type: '매출' } as IssuedStatement;
    const product = { ...item, type: 'product', lots: [{ id: 'lot', supplierName: '합성 공급처', kgIn: 5, kgRemaining: 5, receivedDate: '2026-10-01', status: 'active', createdAt: '2026-10-01T00:00:00Z' }] } as Item;
    const result = salesReturnRequest('taebaek', 'supplier', sale,
      [{ itemId: 'box', qty: '1', isResellable: false }], [product]);
    expect(result).toMatchObject({ totalAmount: 110, items: [{ isResellable: false, quantity: 1, price: 110 }] });
    expect(salesReturnRequest('taebaek', 'supplier', sale,
      [{ itemId: 'box', qty: '1', isResellable: true }], [product])).toMatchObject({ totalAmount: 110, items: [{ isResellable: true }] });
  });
  it('원료 홀더와 완제품의 원매입 반품도 접수하고 다른 회사 홀더는 쓰지 않는다', () => {
    for (const product of [
      { ...item, type: 'product' },
      { ...item, name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg' },
    ] as Item[]) expect(request(source, product)).toMatchObject({ totalAmount: 110 });
    const sku = { ...item, name: '참깨/포대', rawMaterialName: '참깨' } as Item;
    const foreign = { ...item, id: 'foreign', companyId: 'punghoe', name: '참깨', type: 'raw', subtype: '벌크' } as Item;
    expect(() => purchaseReturnRequest('taebaek', 'supplier', source, [{ itemId: 'box', qty: '1' }], [sku, foreign])).toThrow();
  });
});

 describe('원전표 없는 명시 반품 금액', () => {
  const explicit = { items: [{ itemId: 'box', supply: 100, tax: 10, accountCode: '500' }], payableAccountCode: '253' as const };
  it('현재 가격 없이 공급가·세액·계정과 매입 채무를 보존한다', () => {
    const result = purchaseReturnRequest('taebaek', 'supplier', undefined, [{ itemId: 'box', qty: '1' }], [item], explicit);
    expect(result).toMatchObject({ totalAmount: 110, payableAccountCode: '253', items: [{ supply: 100, tax: 10, accountCode: '500', price: 0, isResellable: false }] });
    expect(result).not.toHaveProperty('linkedStatementId');
  });
  it('폐기 선택과 명시 매출 금액을 유지한다', () => {
    expect(salesReturnRequest('taebaek', 'supplier', undefined, [{ itemId: 'box', qty: '1', isResellable: false }], [item], explicit))
      .toMatchObject({ returnType: '매출', totalAmount: 110, items: [{ isResellable: false }] });
  });
  it('손상 금액·품목·회사는 접수하지 않는다', () => {
    for(const change of [{supply:-1},{tax:0.1},{supply:NaN},{accountCode:''},{itemId:'other'}])
      expect(()=>purchaseReturnRequest('taebaek','supplier',undefined,[{itemId:'box',qty:'1'}],[item],{...explicit,items:[{...explicit.items[0],...change}]})).toThrow();
    expect(()=>purchaseReturnRequest('punghoe','supplier',undefined,[{itemId:'box',qty:'1'}],[item],explicit)).toThrow();
  });
  it('원전표 지정 시 명시 금액이 비례 계산을 덮지 않는다', () => {
    expect(purchaseReturnRequest('taebaek','supplier',source,[{itemId:'box',qty:'1'}],[item],{...explicit,items:[{...explicit.items[0],supply:999}]}).totalAmount).toBe(110);
  });
 });

describe('혼합 포장 매입 반품 화면 금액', () => {
  const raw = { id: 'raw', companyId: 'taebaek', type: 'raw', subtype: '벌크', name: '참깨', unit: 'kg' } as Item;
  const mixed = { ...source, totalSupply: 700, totalTax: 70, totalAmount: 770,
    items: [20, 25].map((unitKg, index) => ({ itemId: 'raw', accountCode: '500', qty: 2,
      supply: index ? 500 : 200, tax: index ? 50 : 20, total: index ? 550 : 220,
      purchaseUnitId: `unit-${index}`, purchaseUnit: '포대', purchaseQty: 2, unitKg, inventoryQty: unitKg * 2 })) } as IssuedStatement;
  it('동일품목 두 포장 줄의 원전표 index와 각 금액을 그대로 접수한다', () => {
    const result = purchaseReturnRequest('taebaek', 'supplier', mixed,
      [{ itemId: 'raw', sourceLineIndex: 0, qty: '1' }, { itemId: 'raw', sourceLineIndex: 1, qty: '1' }], [raw]);
    expect(result.totalAmount).toBe(385);
    expect(result.items.map(row => [row.sourceLineIndex, row.price])).toEqual([[0, 110], [1, 275]]);
  });
  it('원줄 미선택·같은 줄 중복·다른 품목·과반품을 거절한다', () => {
    for (const selected of [[{ itemId: 'raw', qty: '1' }], [{ itemId: 'raw', sourceLineIndex: 0, qty: '3' }], [{ itemId: 'other', sourceLineIndex: 0, qty: '1' }], [{ itemId: 'raw', sourceLineIndex: 0, qty: '1' }, { itemId: 'raw', sourceLineIndex: 0, qty: '1' }]]) {
      expect(() => purchaseReturnRequest('taebaek', 'supplier', mixed, selected, [raw])).toThrow();
    }
  });
});
