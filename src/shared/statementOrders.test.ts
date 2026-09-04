import { describe, it, expect } from 'vitest';
import { partnerOrders, activeOrders, activePartnerIds, isActive } from './statementOrders';
import { OrderStatus } from './types';

const 주문 = (o: any) => ({
  partnerId: 'A', partnerName: '희성실업', status: OrderStatus.PENDING,
  createdAt: '2026-09-01T10:00:00+09:00', items: [], ...o,
} as any);

/** 전표가 걸린 주문 id 들 */
const 발행된 = (...ids: string[]) => (o: any) => ids.includes(o.id);
const 아무것도안발행 = () => false;

describe('isActive', () => {
  it('대기·작업·출고·배송중은 진행이다', () => {
    for (const s of [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.SHIPPED]) {
      expect(isActive({ status: s })).toBe(true);
    }
  });
  it('배송완료는 진행이 아니다', () => {
    expect(isActive({ status: OrderStatus.DELIVERED })).toBe(false);
  });
});

describe('partnerOrders — 고른 거래처만', () => {
  const list = [주문({ id: 'a' }), 주문({ id: 'b', partnerId: 'B' })];

  it('다른 거래처는 안 섞인다', () => {
    const r = partnerOrders({ orders: list, partnerId: 'A', isVouchered: 아무것도안발행 });
    expect(r.map(o => o.id)).toEqual(['a']);
  });

  it('늦게 들어온 것이 위로 온다', () => {
    const r = partnerOrders({
      orders: [주문({ id: '먼저', createdAt: '2026-09-01T10:00:00+09:00' }),
               주문({ id: '나중', createdAt: '2026-09-03T10:00:00+09:00' })],
      partnerId: 'A', isVouchered: 아무것도안발행,
    });
    expect(r.map(o => o.id)).toEqual(['나중', '먼저']);
  });
});

describe('partnerOrders — onlyActive(진행 주문만)', () => {
  const 배송완료_미발행 = 주문({ id: '놓친것', status: OrderStatus.DELIVERED });
  const 배송완료_발행됨 = 주문({ id: '끝난것', status: OrderStatus.DELIVERED });
  const 진행중 = 주문({ id: '진행', status: OrderStatus.PROCESSING });
  const 목록 = [배송완료_미발행, 배송완료_발행됨, 진행중];

  it('전표가 걸린 배송완료는 뺀다 — 발행내역에서 본다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', onlyActive: true, isVouchered: 발행된('끝난것') });
    expect(r.map(o => o.id)).not.toContain('끝난것');
  });

  it('배송완료라도 전표가 안 걸렸으면 남긴다 — 놓치면 아픈 건이다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', onlyActive: true, isVouchered: 발행된('끝난것') });
    expect(r.map(o => o.id)).toContain('놓친것');
  });

  it('전표가 걸린 진행중 주문은 남되 아래로 내려간다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', onlyActive: true, isVouchered: 발행된('진행') });
    expect(r.map(o => o.id)).toEqual(['놓친것', '끝난것', '진행']);
  });
});

describe('partnerOrders — 날짜 필터는 발행완료에만 건다', () => {
  const 옛날_미발행 = 주문({ id: '옛날미발행', createdAt: '2026-07-01T10:00:00+09:00' });
  const 옛날_발행됨 = 주문({ id: '옛날발행', createdAt: '2026-07-01T10:00:00+09:00' });
  const 이번달 = 주문({ id: '이번달', createdAt: '2026-09-03T10:00:00+09:00' });
  const 목록 = [옛날_미발행, 옛날_발행됨, 이번달];
  const v = 발행된('옛날발행');

  it('미발행은 기간 밖이어도 보인다 — 안 그러면 놓친 주문이 영영 사라진다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', isVouchered: v, dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(r.map(o => o.id)).toContain('옛날미발행');
  });

  it('발행완료는 기간 밖이면 숨는다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', isVouchered: v, dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(r.map(o => o.id)).not.toContain('옛날발행');
  });

  it('기간 안의 발행완료는 보인다', () => {
    const r = partnerOrders({ orders: 목록, partnerId: 'A', isVouchered: 발행된('이번달'), dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(r.map(o => o.id)).toContain('이번달');
  });

  it('기간을 안 주면 다 보인다', () => {
    expect(partnerOrders({ orders: 목록, partnerId: 'A', isVouchered: v })).toHaveLength(3);
  });
});

describe('activeOrders — 거래처를 안 골랐을 때', () => {
  it('생산기록은 주문이 아니다', () => {
    const r = activeOrders([주문({ id: 'x', partnerName: '생산기록' })], 아무것도안발행);
    expect(r).toEqual([]);
  });

  it('배송완료라도 전표가 안 걸렸으면 뜬다 — 전에는 영영 안 떴다', () => {
    const r = activeOrders([주문({ id: '놓친것', status: OrderStatus.DELIVERED })], 아무것도안발행);
    expect(r.map(o => o.id)).toEqual(['놓친것']);
  });

  it('전표가 걸린 배송완료는 뺀다', () => {
    const r = activeOrders([주문({ id: '끝', status: OrderStatus.DELIVERED })], 발행된('끝'));
    expect(r).toEqual([]);
  });

  it('납기가 이른 것이 위로 — 급한 것이 먼저다', () => {
    const r = activeOrders([
      주문({ id: '늦은납기', deliveryDate: '2026-09-20' }),
      주문({ id: '이른납기', deliveryDate: '2026-09-06' }),
    ], 아무것도안발행);
    expect(r.map(o => o.id)).toEqual(['이른납기', '늦은납기']);
  });

  it('전표 걸린 것은 납기와 무관하게 아래로', () => {
    const r = activeOrders([
      주문({ id: '발행됨', deliveryDate: '2026-09-01' }),
      주문({ id: '미발행', deliveryDate: '2026-09-20' }),
    ], 발행된('발행됨'));
    expect(r.map(o => o.id)).toEqual(['미발행', '발행됨']);
  });
});

describe('activePartnerIds', () => {
  it('진행 주문이 있는 거래처만', () => {
    const s = activePartnerIds([
      주문({ partnerId: 'A', status: OrderStatus.PENDING }),
      주문({ partnerId: 'B', status: OrderStatus.DELIVERED }),
    ]);
    expect([...s]).toEqual(['A']);
  });
});
