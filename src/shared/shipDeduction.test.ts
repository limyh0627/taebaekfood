import { describe, it, expect } from 'vitest';
import { shipQtyOfLine, shipDeductions, goodsShipQty } from './shipDeduction';
import type { Item, OrderItem } from './types';

/**
 * 출고 차감 셈은 한 곳이다 — 재고 엔진도, 카드의 출고 확인창도 이걸 본다(2026-09-15).
 * 화면이 따로 세면 "재고가 −5 차감됩니다" 라고 해 놓고 실제로는 다르게 빠진다.
 */
const 품목 = (over: Partial<Item> = {}): Item =>
  ({ id: 'p1', name: '참기름 골드', unit: '개', type: 'product', stock: 12, ...over } as Item);
const 줄 = (over: Partial<OrderItem> = {}): OrderItem =>
  ({ itemId: 'p1', name: '참기름 골드', quantity: 5, price: 0, ...over } as OrderItem);

describe('출고할 때 빠지는 양', () => {
  it('보통 완제품은 재고 단위로 뺀다', () => {
    expect(shipQtyOfLine(줄({ quantity: 5 }), 품목())).toBe(5);
  });

  it('**벌크는 안 뺀다** — 생산처리에서 로트·원장까지 이미 빠졌다', () => {
    expect(shipQtyOfLine(줄(), 품목({ subtype: '벌크' }))).toBe(0);
  });

  it('품목을 못 찾으면 0 — 모르는 것을 뺄 수는 없다', () => {
    expect(shipQtyOfLine(줄(), undefined)).toBe(0);
  });

  it('사입·임가공은 박스 개입수로 환산한다', () => {
    const 임가공 = 품목({ procureType: '임가공' });
    expect(goodsShipQty(줄({ isBoxUnit: true, boxQuantity: 3, unitsPerBox: 20 }), 임가공)).toBe(60);
    expect(shipQtyOfLine(줄({ isBoxUnit: true, boxQuantity: 3, unitsPerBox: 20 }), 임가공)).toBe(60);
  });

  it('개입수가 줄에 없으면 1 로 본다 — 12 로 물러서면 102개 품목이 어긋난다', () => {
    expect(goodsShipQty(줄({ isBoxUnit: true, boxQuantity: 3 }), 품목({ procureType: '완사입' }))).toBe(3);
  });
});

describe('출고 확인창에 적을 목록', () => {
  const items = [
    품목({ id: 'a', name: '참기름 골드', stock: 12 }),
    품목({ id: 'b', name: '볶음참깨', stock: 4 }),
    품목({ id: 'c', name: '참깨원료', stock: 900, subtype: '벌크' }),
  ];

  it('빠지는 품목마다 지금 재고와 뺀 뒤 재고를 적는다', () => {
    const rows = shipDeductions({ items: [줄({ itemId: 'a', quantity: 5 }), 줄({ itemId: 'b', quantity: 1 })] }, items);
    expect(rows).toEqual([
      { itemId: 'a', name: '참기름 골드', unit: '개', qty: 5, before: 12, after: 7 },
      { itemId: 'b', name: '볶음참깨', unit: '개', qty: 1, before: 4, after: 3 },
    ]);
  });

  it('벌크는 목록에 안 선다 — 여기서 빠지지 않는다', () => {
    expect(shipDeductions({ items: [줄({ itemId: 'c', quantity: 30 })] }, items)).toEqual([]);
  });

  it('같은 품목이 두 줄이면 합쳐 센다 — 따로 보이면 남는 재고를 못 셈한다', () => {
    const rows = shipDeductions({ items: [줄({ itemId: 'a', quantity: 5 }), 줄({ itemId: 'a', quantity: 3 })] }, items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 8, before: 12, after: 4 });
  });

  it('재고보다 많이 나가면 뺀 뒤가 음수로 보인다 — 가리지 않는다', () => {
    expect(shipDeductions({ items: [줄({ itemId: 'b', quantity: 10 })] }, items)[0]).toMatchObject({ after: -6 });
  });

  it('주문에 품목이 없으면 빈 목록', () => {
    expect(shipDeductions({ items: [] }, items)).toEqual([]);
  });
});
