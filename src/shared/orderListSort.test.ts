import { describe, it, expect } from 'vitest';
import { sortOrdersByHead, nextHeadSort, headSortTitle, type OrderListHeadSort } from './orderListSort';
import type { Order, OrderItem } from './types';

/**
 * 표 머리를 눌러 정렬한다(2026-09-14 사장님).
 * 거래처·주문일은 세 단계(가나다 → 거꾸로 → 없음), 비고는 두 단계다.
 */
const 주문 = (partnerName: string, createdAt: string, items: Partial<OrderItem>[] = []): Order =>
  ({ id: partnerName, partnerName, createdAt, items } as unknown as Order);

const 이름들 = (rows: { partnerName: string }[]) => rows.map(r => r.partnerName);

describe('표 머리 정렬', () => {
  const 목록 = [
    주문('해내음', '2026-09-10T00:00:00.000Z', [{ checked: true }, { checked: false }]),
    주문('가미김밥', '2026-09-12T00:00:00.000Z', [{ checked: true }, { checked: true }]),
    주문('나라식품', '2026-09-08T00:00:00.000Z', [{ checked: false }, { checked: false }]),
  ];

  it('거래처를 한 번 누르면 가나다 순', () => {
    expect(이름들(sortOrdersByHead(목록, { key: 'partner', dir: 'asc' }))).toEqual(['가미김밥', '나라식품', '해내음']);
  });

  it('거래처를 두 번 누르면 거꾸로', () => {
    expect(이름들(sortOrdersByHead(목록, { key: 'partner', dir: 'desc' }))).toEqual(['해내음', '나라식품', '가미김밥']);
  });

  it('주문일은 오래된 것부터 → 최근 것부터', () => {
    expect(이름들(sortOrdersByHead(목록, { key: 'orderDate', dir: 'asc' }))).toEqual(['나라식품', '해내음', '가미김밥']);
    expect(이름들(sortOrdersByHead(목록, { key: 'orderDate', dir: 'desc' }))).toEqual(['가미김밥', '해내음', '나라식품']);
  });

  it('날짜가 깨진 주문은 맨 뒤로 — 가운데 끼면 차례가 거짓말이 된다', () => {
    const 깨진것 = [주문('없음', ''), ...목록];
    expect(이름들(sortOrdersByHead(깨진것, { key: 'orderDate', dir: 'asc' })).at(-1)).toBe('없음');
  });

  it('작업완료 여부는 한 번 누르면 작업도 높은 주문이 위로', () => {
    expect(이름들(sortOrdersByHead(목록, { key: 'completion', dir: 'asc' }))).toEqual(['가미김밥', '해내음', '나라식품']);
    expect(이름들(sortOrdersByHead(목록, { key: 'completion', dir: 'desc' }))).toEqual(['나라식품', '해내음', '가미김밥']);
  });

  it('품목이 없는 주문도 작업도 0 으로 셈에 든다 — 빼면 차례에서 사라진다', () => {
    const 빈것 = [주문('빈주문', '2026-09-09T00:00:00.000Z', []), ...목록];
    expect(sortOrdersByHead(빈것, { key: 'completion', dir: 'asc' })).toHaveLength(4);
  });

  it('비고는 단 주문이 위로 온다', () => {
    const 비고목록 = [
      주문('가', '2026-09-10T00:00:00.000Z', [{ note: '' }]),
      주문('나', '2026-09-11T00:00:00.000Z', [{ note: '   ' }]),
      주문('다', '2026-09-12T00:00:00.000Z', [{ note: '' }, { note: '급함' }]),
    ];
    expect(이름들(sortOrdersByHead(비고목록, { key: 'note', dir: 'asc' }))).toEqual(['다', '가', '나']);
  });

  it('정렬을 안 걸면 원래 차례 그대로', () => {
    expect(이름들(sortOrdersByHead(목록, null))).toEqual(['해내음', '가미김밥', '나라식품']);
  });

  it('같은 값끼리는 원래 차례를 지킨다 — 그 위에 얹는 정렬이다', () => {
    const 같은작업도 = [주문('나중', '2026-09-01T00:00:00.000Z'), 주문('먼저', '2026-09-01T00:00:00.000Z')];
    expect(이름들(sortOrdersByHead(같은작업도, { key: 'completion', dir: 'asc' }))).toEqual(['나중', '먼저']);
  });
});

describe('머리를 다시 누를 때', () => {
  it('거래처는 가나다 → 거꾸로 → 없음', () => {
    let s: OrderListHeadSort | null = null;
    s = nextHeadSort(s, 'partner'); expect(s).toEqual({ key: 'partner', dir: 'asc' });
    s = nextHeadSort(s, 'partner'); expect(s).toEqual({ key: 'partner', dir: 'desc' });
    s = nextHeadSort(s, 'partner'); expect(s).toBeNull();
  });

  it('비고는 두 단계뿐 — 있는 것 위로 → 없음', () => {
    let s: OrderListHeadSort | null = null;
    s = nextHeadSort(s, 'note'); expect(s).toEqual({ key: 'note', dir: 'asc' });
    s = nextHeadSort(s, 'note'); expect(s).toBeNull();
  });

  it('다른 머리를 누르면 그쪽 첫 단계로 간다', () => {
    expect(nextHeadSort({ key: 'partner', dir: 'desc' }, 'orderDate')).toEqual({ key: 'orderDate', dir: 'asc' });
  });

  it('무엇이 될지 말로 알려 준다', () => {
    expect(headSortTitle(null, 'partner')).toBe('눌러서 가나다 순');
    expect(headSortTitle({ key: 'completion', dir: 'asc' }, 'completion')).toBe('눌러서 작업도 낮은 순');
    expect(headSortTitle({ key: 'note', dir: 'asc' }, 'note')).toBe('눌러서 정렬 없음');
  });
});
