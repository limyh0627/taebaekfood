import { expect, it } from 'vitest';
import { arrayUnion, Timestamp } from 'firebase/firestore';
import { itemWritePayload } from './itemWritePayload';

it('품목 가격만 얕게 제거하고 명시 원가 0과 중첩 거래 단가·SDK 객체를 보존한다', () => {
  const sentinel = arrayUnion('lot');
  const timestamp = Timestamp.fromMillis(100);
  const nested = { price: 50 };
  const original = Object.freeze({ price: 9000, cost: 0, nested, sentinel, timestamp });
  const result = itemWritePayload('items', original);
  expect(result).not.toHaveProperty('price');
  expect(result.cost).toBe(0);
  expect(result.nested).toBe(nested);
  expect(result.sentinel).toBe(sentinel);
  expect(result.timestamp).toBe(timestamp);
  expect(original.price).toBe(9000);
});
it('가격 값이 무엇이든 원가를 만들어내지 않는다', () => {
  for (const price of [0, 5, '5', null, NaN, undefined]) {
    expect(itemWritePayload('items', { price, stock: 4 })).toEqual({ stock: 4 });
  }
});
it('거래 문서와 거래처 단가는 원문 그대로 유지한다', () => {
  const original = { price: 5, items: [{ price: 7 }] };
  for (const collection of ['partner_item', 'orders', 'issuedStatements'] as const) {
    expect(itemWritePayload(collection, original)).toBe(original);
  }
});
it('품목 dotted 가격만 제외하고 다른 중첩값과 비슷한 필드는 유지한다', () => {
  const original = Object.freeze({ 'price.foo': 5, 'price.foo.bar': 6, prices: 8, priceTag: 9, 'cost.value': 0, 'nested.price': 7 });
  expect(itemWritePayload('items', original)).toEqual({ prices: 8, priceTag: 9, 'cost.value': 0, 'nested.price': 7 });
  expect(itemWritePayload('partner_item', original)).toBe(original);
  expect(original['price.foo']).toBe(5);
});
