import { describe, it, expect } from 'vitest';
import { itemIndexOf, isLineChecked } from './workItemLine';
import { OrderStatus, type Order, type OrderItem } from './types';

const 품목 = (itemId: string, checked = false): OrderItem =>
  ({ itemId, name: itemId, quantity: 1, price: 0, ...(checked ? { checked } : {}) });

const 주문 = (items: OrderItem[]): Order => ({
  id: 'ORD-1788768673611', partnerName: '거래처', items, totalAmount: 0,
  status: OrderStatus.PENDING, createdAt: '', deliveryDate: '', email: '', source: '일반',
});

const 줄 = (idx: number, itemId?: string) =>
  ({ key: `ORD-1788768673611-${idx}`, ...(itemId ? { itemId } : {}) });

describe('작업순서 줄 → 품목 번호', () => {
  const o = 주문([품목('A'), 품목('B'), 품목('C')]);

  it('열쇠 끝의 번호를 읽는다 — 주문 id 안에도 - 가 있다', () => {
    expect(itemIndexOf(줄(0, 'A'), o)).toBe(0);
    expect(itemIndexOf(줄(2, 'C'), o)).toBe(2);
  });

  it('번호 자리 품목이 어긋났으면 품목 id 로 다시 찾는다 — 엉뚱한 줄에 체크가 찍히면 안 된다', () => {
    //  줄은 'B를 가리키는 1번' 인데 그 사이 A가 지워져 B가 0번이 됐다
    const 지워진뒤 = 주문([품목('B'), 품목('C')]);
    expect(itemIndexOf(줄(1, 'B'), 지워진뒤)).toBe(0);
  });

  it('번호가 목록 밖이어도 품목으로 찾는다', () => {
    expect(itemIndexOf(줄(9, 'B'), o)).toBe(1);
  });

  it('그 품목이 아예 없으면 -1 — 부르는 쪽은 체크칸을 안 그린다', () => {
    expect(itemIndexOf(줄(1, '없는것'), o)).toBe(-1);
  });

  it('주문이 없거나 품목이 비면 -1', () => {
    expect(itemIndexOf(줄(0, 'A'), undefined)).toBe(-1);
    expect(itemIndexOf(줄(0, 'A'), 주문([]))).toBe(-1);
  });

  it('열쇠 끝이 숫자가 아니면 품목으로만 찾는다', () => {
    expect(itemIndexOf({ key: 'ORD-1788768673611-xx', itemId: 'B' }, o)).toBe(1);
  });

  it('품목 id 가 없으면 번호만 믿는다 — 옛 줄', () => {
    expect(itemIndexOf({ key: 'ORD-1788768673611-1' }, o)).toBe(1);
  });
});

describe('그 줄이 체크돼 있나', () => {
  const o = 주문([품목('A', true), 품목('B')]);

  it('체크된 줄', () => {
    expect(isLineChecked(줄(0, 'A'), o)).toBe(true);
  });

  it('안 체크된 줄', () => {
    expect(isLineChecked(줄(1, 'B'), o)).toBe(false);
  });

  it('못 찾는 줄은 안 체크된 것으로 본다', () => {
    expect(isLineChecked(줄(0, '없는것'), o)).toBe(false);
    expect(isLineChecked(줄(0, 'A'), undefined)).toBe(false);
  });
});

/**
 * **왜 번호만 믿으면 안 되나** — 사장님이 물은 그 자리다(2026-09-09).
 *
 * 작업순서 줄은 담을 때 찍어 둔 **사본**이라, 주문에서 앞 품목을 지우면 뒤 번호가 당겨진다.
 * 줄은 여전히 옛 번호를 가리키므로 **화면엔 B 라고 떠 있는데 체크는 C 에 찍힌다.**
 */
describe('앞 품목이 지워졌을 때 — 엉뚱한 줄에 체크가 찍히면 안 된다', () => {
  it('A·B·C 에서 A 를 지우면 B 줄은 0번으로 따라간다', () => {
    const B줄 = 줄(1, 'B');                       // 담을 때 B 는 1번이었다
    const 지운뒤 = 주문([품목('B'), 품목('C')]);   // A 가 빠져 B 가 0번, C 가 1번
    expect(itemIndexOf(B줄, 지운뒤)).toBe(0);
    //  번호만 믿었으면 1번(C)을 가리켜 C 에 체크가 찍혔을 것이다
    expect(지운뒤.items[1].itemId).toBe('C');
  });

  it('B 자신이 지워지면 -1 — 줄이 목록에서 통째로 빠진다', () => {
    const B줄 = 줄(1, 'B');
    expect(itemIndexOf(B줄, 주문([품목('A'), 품목('C')]))).toBe(-1);
  });
});
