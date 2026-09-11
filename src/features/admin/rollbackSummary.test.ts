import { describe, it, expect } from 'vitest';
import { buildRollbackPlan } from './rollbackSummary';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * 작업완료·출고에서 되돌릴 때 **무엇이 되돌아오는지** 적어 보여주고 확인을 받는다.
 * 되돌리기는 재고를 조용히 움직여서, 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면 되짚기 어렵다.
 */
const items = [
  { id: 'box', name: '시골향참기름/A/1750ml', spec: '1750ml * 10', unit: '박스' },
  { id: 'loose', name: '시골향참기름/A/1750ml', spec: '1750ml', unit: '병' },
] as unknown as Item[];

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', partnerName: '거산농산', status: OrderStatus.DISPATCHED,
  items: [{ itemId: 'box', name: '시골향참기름/A/1750ml', quantity: 3 } as never],
  ...over,
} as unknown as Order);

describe('되돌리기 안내문', () => {
  it('출고된 건이면 재고가 다시 는다고 알린다', () => {
    const p = buildRollbackPlan(order({ shippedOut: true }), items, OrderStatus.SHIPPED, OrderStatus.PENDING);
    expect(p.needed).toBe(true);
    expect(p.text).toContain("'출고' → '대기중'로 되돌립니다.");
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml * 10 +3');
  });

  it('생산분과 원료를 각각 적는다', () => {
    const p = buildRollbackPlan(order({
      producedUnits: [{ itemId: 'box', qty: 3 }],
      rawConsumedLots: [
        { material: '깨분참기름', supplierName: '청정', kg: 38.472 },
        { material: '깨분참기름', supplierName: '이월', kg: 1.528 },
        { material: '통깨참기름', supplierName: '압착', kg: 9.618 },
      ],
    } as never), items, OrderStatus.DISPATCHED, OrderStatus.PROCESSING);
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml * 10 −3');
    expect(p.text).toContain('깨분참기름 40kg');       // 같은 원료는 합쳐 적는다
    expect(p.text).toContain('통깨참기름 9.618kg');
    expect(p.text).toContain('원료수불부에 적힌 그 사용 줄도 함께 지워집니다');
  });

  it('먼저 만들었던 구성품도 알린다', () => {
    const p = buildRollbackPlan(order({ autoBuilt: [{ itemId: 'loose', qty: 30 }] } as never), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.text).toContain('먼저 만들었던 구성품도 되돌립니다');
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml 30');
  });

  it('되돌릴 재고가 없으면 그렇게 적는다 — 그래도 확인은 받는다', () => {
    const p = buildRollbackPlan(order(), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.needed).toBe(false);
    expect(p.text).toContain('되돌릴 재고는 없습니다');
  });

  it('박스 주문은 박스 개수로 적는다 — 낱개로 적으면 자릿수가 달라 놀란다', () => {
    const o = order({ shippedOut: true, items: [{ itemId: 'box', name: 'x', quantity: 30, isBoxUnit: true, boxQuantity: 3 } as never] });
    expect(buildRollbackPlan(o, items, OrderStatus.SHIPPED, OrderStatus.PENDING).text).toContain('+3');
  });

  it('작업 당시 스냅샷이 있으면 현재 BOM 대신 실제 증감을 품목별로 보여준다', () => {
    const p = buildRollbackPlan(order({
      producedAt: '2026-09-01T00:00:00.000Z',
      inventorySnapshots: {
        version: 1,
        production: {
          capturedAt: '2026-09-01T00:00:00.000Z',
          stockDeltas: [{ itemId: 'box', delta: 3 }, { itemId: 'loose', delta: -30 }],
          bomLines: [{ parentItemId: 'box', childItemId: 'loose', quantity: 10 }],
        },
      },
    }), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.legacyEvidenceWarning).toBe(false);
    expect(p.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'box', delta: -3 }),
      expect.objectContaining({ itemId: 'loose', delta: 30 }),
    ]));
  });

  it('스냅샷 없는 옛 생산 주문은 원복 근거 부족으로 별도 경고한다', () => {
    const p = buildRollbackPlan(order({ producedAt: '2026-08-01T00:00:00.000Z' }), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.legacyEvidenceWarning).toBe(true);
    expect(p.warnings.join(' ')).toContain('현재 데이터로 추정');
  });
});
