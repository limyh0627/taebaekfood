import { describe, expect, it } from 'vitest';
import { resolveOrderItem } from './orderResolvedItem';

const products = [{ id: 'box', name: 'box' }, { id: 'loose', name: 'loose' }, { id: 'unit', name: 'unit' }];
const inputs = {
  bom: { of: (id: string) => id === 'box' ? [{ childId: 'loose', qty: 20, child: { type: 'product' } }] : [] },
  pack: { of: (id: string) => id === 'unit' ? 12 : 0 },
};
describe('resolveOrderItem 서버 공통 원본', () => {
  it('박스 품목은 명시 박스 수와 낱개 품목을 사용한다', () => {
    expect(resolveOrderItem({ itemId: 'box', quantity: 100, boxQuantity: 3 }, products, inputs)).toEqual({ product: products[1], qty: 60, perBox: 20, unknownItem: false });
  });
  it('명시 0과 음수 및 이전 수량을 보존한다', () => {
    expect(resolveOrderItem({ itemId: 'box', quantity: 4, boxQuantity: 0 }, products, inputs).qty).toBe(0);
    expect(resolveOrderItem({ itemId: 'box', quantity: -2 }, products, inputs).qty).toBe(-40);
    expect(resolveOrderItem({ itemId: 'box', quantity: 4 }, products, inputs).qty).toBe(80);
  });
  it('낱개 품목의 박스 환산은 명시 0과 undefined를 구분한다', () => {
    expect(resolveOrderItem({ itemId: 'unit', quantity: 2, isBoxUnit: true, boxQuantity: 2, unitsPerBox: 0 }, products, inputs)).toEqual({ product: products[2], qty: 2, perBox: 1, unknownItem: false });
    expect(resolveOrderItem({ itemId: 'unit', quantity: 2, isBoxUnit: true, boxQuantity: 2 }, products, inputs)).toEqual({ product: products[2], qty: 24, perBox: 12, unknownItem: false });
  });
  it('품목 또는 낱개가 없으면 원 수량과 품목 판정을 지킨다', () => {
    expect(resolveOrderItem({ itemId: 'missing', quantity: 7 }, products, inputs)).toEqual({ product: undefined, qty: 7, perBox: 1, unknownItem: true });
    expect(resolveOrderItem({ itemId: 'box', quantity: 7 }, [products[0]], inputs)).toEqual({ product: products[0], qty: 7, perBox: 1, unknownItem: false });
  });
});
