import { describe, it, expect } from 'vitest';
import { itemIndexOf, isLineChecked } from './workItemLine';
import { OrderStatus, type Order, type OrderItem } from './types';

const 품목 = (itemId: string, checked = false): OrderItem =>
  ({ itemId, name: itemId, quantity: 1, price: 0, ...(checked ? { checked } : {}) });

const 주문 = (items: OrderItem[]): Order => ({
  id: 'ORD-1788768673611', partnerName: '거래처', items, totalAmount: 0,
  status: OrderStatus.PENDING, createdAt: '', deliveryDate: '', email: '', source: '일반',
});

describe('작업순서 줄 → 그 주문의 어느 품목인가', () => {
  const o = 주문([품목('A'), 품목('B'), 품목('C')]);

  it('품목 id 로 찾는다', () => {
    expect(itemIndexOf({ itemId: 'A' }, o)).toBe(0);
    expect(itemIndexOf({ itemId: 'C' }, o)).toBe(2);
  });

  it('그 품목이 없으면 -1 — 부르는 쪽이 줄을 목록에서 뺀다', () => {
    expect(itemIndexOf({ itemId: '없는것' }, o)).toBe(-1);
  });

  it('주문이 없거나 품목이 비면 -1', () => {
    expect(itemIndexOf({ itemId: 'A' }, undefined)).toBe(-1);
    expect(itemIndexOf({ itemId: 'A' }, 주문([]))).toBe(-1);
  });

  it('품목 id 가 없는 줄은 -1 — 짐작해서 아무 줄이나 고르지 않는다', () => {
    expect(itemIndexOf({}, o)).toBe(-1);
    //  주문에도 품목 id 가 빈 줄이 있으면 **빈 것끼리 짝이 맞아** 엉뚱한 줄을 고른다.
    //  택배비처럼 품목이 없는 줄이 그렇다 — 앞에서 막아야 한다.
    const 빈줄있음 = 주문([{ itemId: '', name: '택배비', quantity: 1, price: 4500 }, 품목('B')]);
    expect(itemIndexOf({}, 빈줄있음)).toBe(-1);
    expect(itemIndexOf({ itemId: '' }, 빈줄있음)).toBe(-1);
  });
});

/**
 * **자리로 찾으면 왜 위험한가** — 사장님이 "몇번째 주문이냐는 너무 위험한데" 라고 한 자리다.
 *
 * 작업순서 줄은 담을 때 찍어 둔 **사본**이라, 주문에서 앞 품목을 지우면 뒤 자리가 당겨진다.
 * 자리를 믿으면 **화면엔 B 라고 떠 있는데 체크는 C 에 찍힌다.** 품목 id 는 안 밀린다.
 */
describe('앞 품목이 지워져도 따라간다', () => {
  it('A·B·C 에서 A 를 지우면 B 는 0번이 된다 — 줄은 B 를 그대로 가리킨다', () => {
    const 지운뒤 = 주문([품목('B'), 품목('C')]);
    expect(itemIndexOf({ itemId: 'B' }, 지운뒤)).toBe(0);
    //  자리(1번)를 믿었으면 C 를 가리켰을 것이다
    expect(지운뒤.items[1].itemId).toBe('C');
  });

  it('순서를 바꿔도 따라간다', () => {
    expect(itemIndexOf({ itemId: 'A' }, 주문([품목('C'), 품목('B'), 품목('A')]))).toBe(2);
  });

  it('B 자신이 지워지면 -1 — 줄이 목록에서 통째로 빠진다', () => {
    expect(itemIndexOf({ itemId: 'B' }, 주문([품목('A'), 품목('C')]))).toBe(-1);
  });
});

describe('그 줄이 체크돼 있나', () => {
  const o = 주문([품목('A', true), 품목('B')]);

  it('체크된 줄 · 안 체크된 줄', () => {
    expect(isLineChecked({ itemId: 'A' }, o)).toBe(true);
    expect(isLineChecked({ itemId: 'B' }, o)).toBe(false);
  });

  it('못 찾는 줄은 안 체크된 것으로 본다', () => {
    expect(isLineChecked({ itemId: '없는것' }, o)).toBe(false);
    expect(isLineChecked({ itemId: 'A' }, undefined)).toBe(false);
  });
});
