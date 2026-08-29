import { describe, it, expect, beforeEach } from 'vitest';
import { buildItemLedger } from './itemLedger';
import { buildBomIndex, setBomIndex } from '../../shared/bomIndex';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * 제품별원장 — 근거는 **주문에 남은 스냅샷**뿐이다. 짐작하지 않는다.
 * 재고조정·실사처럼 주문 밖에서 움직인 것은 안 잡히므로, 맞춘 잔량이 아니라 흐름을 보여주고
 * 지금 재고와의 차이(gap)를 따로 밝힌다.
 */
const items = [
  { id: 'box', name: '참기름/350ml', spec: '350ml * 20', unit: '박스', type: 'product', stock: 5 },
  { id: 'loose', name: '참기름-낱개/350ml', spec: '350ml', unit: '병', type: 'product', stock: 0 },
  { id: 'cap', name: '병캡-빨강', unit: '개', type: 'submaterial', stock: 100 },
] as unknown as Item[];

const order = (id: string, over: Partial<Order>): Order => ({
  id, partnerName: '대왕푸드', status: OrderStatus.DELIVERED, deliveredAt: '2026-08-10',
  items: [], ...over,
} as unknown as Order);

beforeEach(() => {
  //  박스 1개 = 낱개 20 + 캡 20
  setBomIndex(buildBomIndex(items, [
    { id: 'b1', parent_id: 'box', child_id: 'loose', quantity: 20 },
    { id: 'b2', parent_id: 'box', child_id: 'cap', quantity: 20 },
  ] as never));
});

describe('제품별원장', () => {
  it('생산은 +, 출고는 −로 잡고 잔량을 굴린다', () => {
    const l = buildItemLedger('box', [
      order('o1', { producedUnits: [{ itemId: 'box', qty: 3 }], shippedOut: true,
        items: [{ itemId: 'box', name: '참기름/350ml', quantity: 3 } as never] } as never),
    ], items);
    expect(l.rows.map(r => [r.kind, r.qty])).toEqual([['생산', 3], ['출고', -3]]);
    expect(l.rows.at(-1)!.balance).toBe(0);
    expect(l.inSum).toBe(3);
    expect(l.outSum).toBe(-3);
  });

  it('상위 품목을 만들면 그 구성품이 자재사용으로 빠진다', () => {
    const l = buildItemLedger('cap', [
      order('o1', { producedUnits: [{ itemId: 'box', qty: 3 }] } as never),
    ], items);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].kind).toBe('자재사용');
    expect(l.rows[0].qty).toBe(-60);                        // 3박스 × 캡 20
    expect(l.rows[0].note).toContain('참기름/350ml 3 생산에 씀');
  });

  it('먼저 만든 구성품도 잡는다 — 그것도 실제로 만든 것이다', () => {
    const l = buildItemLedger('loose', [
      order('o1', { producedUnits: [{ itemId: 'box', qty: 2 }], autoBuilt: [{ itemId: 'loose', qty: 40 }] } as never),
    ], items);
    //  먼저 40병을 만들고(+40) 박스 2개를 만들며 40병을 썼다(−40)
    expect(l.rows.map(r => r.kind).sort()).toEqual(['먼저생산', '자재사용']);
    expect(l.net).toBe(0);
  });

  it('출고 안 한 주문은 출고 줄이 없다', () => {
    const l = buildItemLedger('box', [
      order('o1', { producedUnits: [{ itemId: 'box', qty: 3 }],
        items: [{ itemId: 'box', name: 'x', quantity: 3 } as never] } as never),
    ], items);
    expect(l.rows.map(r => r.kind)).toEqual(['생산']);
  });

  it('지금 재고와 흐름이 다르면 차이를 밝힌다 — 억지로 맞추지 않는다', () => {
    //  흐름은 +3인데 재고는 5 → 주문 밖에서 2가 움직였다(실사·조정)
    const l = buildItemLedger('box', [
      order('o1', { producedUnits: [{ itemId: 'box', qty: 3 }] } as never),
    ], items);
    expect(l.net).toBe(3);
    expect(l.gap).toBe(2);
  });

  it('날짜·주문 순으로 못 박는다 — 순서가 흔들리면 잔량이 달라진다', () => {
    const l = buildItemLedger('box', [
      order('o2', { deliveredAt: '2026-08-20', producedUnits: [{ itemId: 'box', qty: 1 }] } as never),
      order('o1', { deliveredAt: '2026-08-05', producedUnits: [{ itemId: 'box', qty: 2 }] } as never),
    ], items);
    expect(l.rows.map(r => r.date)).toEqual(['2026-08-05', '2026-08-20']);
    expect(l.rows.map(r => r.balance)).toEqual([2, 3]);
  });
});
