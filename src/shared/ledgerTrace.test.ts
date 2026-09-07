import { describe, it, expect } from 'vitest';
import { ledgerTrace, orderIndex } from './ledgerTrace';
import type { Order } from './types';

const 주문 = (o: Partial<Order>): Order => ({
  id: 'ORD-1', partnerName: '한중교역', items: [], totalAmount: 0,
  status: 'delivered' as Order['status'], createdAt: '', deliveryDate: '', email: '',
  source: '일반', ...o,
});

const 표 = orderIndex([
  주문({
    id: 'ORD-1', cardNo: 'ORD-260901-01', partnerName: '한중교역',
    items: [
      { itemId: 'a', name: '참기름/병/분/전통/350ml', quantity: 10, price: 0 },
      { itemId: 'b', name: '들기름/병/1.8L', quantity: 2, price: 0 },
      { itemId: 'c', name: '통깨/1kg', quantity: 1, price: 0 },
    ],
  }),
]);

describe('누가 · 어디 쓰였나', () => {
  it('자동 줄은 주문에서 거래처와 품목을 낸다', () => {
    const t = ledgerTrace({ note: '자동: 한중교역 ▸ 대성 15kg', orderId: 'ORD-1' }, 표);
    expect(t.where).toBe('한중교역 · 참기름/병/분/전통/350ml 외 2개');
    expect(t.cardNo).toBe('ORD-260901-01');
  });

  it("비고에서 '자동: 거래처' 머리를 떼고 로트 자취만 남긴다 — 거래처가 두 번 뜨면 안 된다", () => {
    const t = ledgerTrace({ note: '자동: 한중교역 ▸ 대성 15kg + 한성 3kg', orderId: 'ORD-1' }, 표);
    expect(t.note).toBe('대성 15kg + 한성 3kg');
  });

  it('주문을 못 찾아도 비고에 적힌 거래처는 살린다 — 지워진 주문·옛 기록', () => {
    const t = ledgerTrace({ note: '자동: 없는거래처 ▸ 대성 15kg', orderId: 'ORD-없음' }, 표);
    expect(t.where).toBe('없는거래처');
    expect(t.note).toBe('대성 15kg');
    expect(t.cardNo).toBeUndefined();
  });

  it('거래처명이 바뀌면 주문에 적힌 지금 이름이 이긴다 — 비고는 찍힐 때 값이다', () => {
    const t = ledgerTrace({ note: '자동: 옛이름 ▸ 대성 15kg', orderId: 'ORD-1' }, 표);
    expect(t.where.startsWith('한중교역')).toBe(true);
  });

  it('로트 자취가 없는 자동 줄(임가공)은 비고가 빈다 — 거래처만 남는다', () => {
    const t = ledgerTrace({ note: '자동: 한중교역', orderId: 'ORD-1' }, 표);
    expect(t.note).toBe('');
    expect(t.where).toBe('한중교역 · 참기름/병/분/전통/350ml 외 2개');
  });

  it('손으로 넣은 줄은 비고를 그대로 둔다 — 머리를 잘못 떼면 안 된다', () => {
    const t = ledgerTrace({ note: '대성 입고', addedBy: '임영훈' });
    expect(t.note).toBe('대성 입고');
    expect(t.where).toBe('');
    expect(t.who).toBe('임영훈');
  });

  it('누가 없으면 빈 값이다 — 화면이 "모른다"를 그릴 수 있어야 한다', () => {
    expect(ledgerTrace({ note: '자동: 한중교역', orderId: 'ORD-1' }, 표).who).toBe('');
    expect(ledgerTrace({ note: '', addedBy: '  ' }).who).toBe('');
  });

  it('주문 표가 없어도 터지지 않는다', () => {
    expect(ledgerTrace({ note: '자동: 한중교역 ▸ 대성 15kg', orderId: 'ORD-1' }).where).toBe('한중교역');
  });
});
