import { describe, it, expect } from 'vitest';
import { planFor, withPlan, dayRows, bySlot, 정한이, toggleDone, stamp, EMPTY_PLAN, type DeliveryPlanDoc, type DayPlan } from './deliveryPlan';
import { OrderStatus, type Order } from './types';

const 오늘 = '2026-09-09';
const 내일 = '2026-09-10';

const 주문 = (o: Partial<Order> & { id: string }): Order => ({
  partnerName: '거래처', items: [], totalAmount: 0, status: OrderStatus.DISPATCHED,
  createdAt: '', deliveryDate: `${오늘}T00:00:00.000Z`, email: '', source: '일반', ...o,
});

describe('날짜별로 계획을 가른다', () => {
  it('그 날짜 계획을 꺼낸다', () => {
    const doc: DeliveryPlanDoc = { byDate: { [오늘]: { ordering: ['A'], timeSlots: {}, done: [] } } };
    expect(planFor(doc, 오늘, 오늘).ordering).toEqual(['A']);
    expect(planFor(doc, 내일, 오늘)).toEqual(EMPTY_PLAN);
  });

  it('옛 모양(날짜 없는 목록)은 오늘 것으로 읽는다 — 짜 둔 순서를 잃으면 안 된다', () => {
    const 옛doc: DeliveryPlanDoc = { ordering: ['A', 'B'], timeSlots: { B: '오후' } };
    expect(planFor(옛doc, 오늘, 오늘).ordering).toEqual(['A', 'B']);
    expect(planFor(옛doc, 오늘, 오늘).timeSlots).toEqual({ B: '오후' });
  });

  it('옛 모양을 다른 날짜로는 안 읽는다 — 어제 순서가 내일에 뜨면 안 된다', () => {
    const 옛doc: DeliveryPlanDoc = { ordering: ['A', 'B'] };
    expect(planFor(옛doc, 내일, 오늘)).toEqual(EMPTY_PLAN);
  });

  it('byDate 가 있으면 옛 칸을 안 본다 — 한 번 옮겨졌으면 그게 임자다', () => {
    const doc: DeliveryPlanDoc = { ordering: ['옛'], byDate: { [오늘]: { ordering: ['새'], timeSlots: {}, done: [] } } };
    expect(planFor(doc, 오늘, 오늘).ordering).toEqual(['새']);
  });

  it('한 날짜를 고쳐도 다른 날짜는 안 건드린다', () => {
    const doc: DeliveryPlanDoc = { byDate: { [오늘]: { ordering: ['A'], timeSlots: {}, done: [] } } };
    const 다음 = withPlan(doc, 내일, { ordering: ['B'], timeSlots: {}, done: [] });
    expect(다음.byDate![오늘].ordering).toEqual(['A']);
    expect(다음.byDate![내일].ordering).toEqual(['B']);
  });

  it('옛 칸을 지우지 않는다 — 아직 안 옮긴 날짜가 그걸 읽고 있을 수 있다', () => {
    const doc: DeliveryPlanDoc = { ordering: ['옛'] };
    expect(withPlan(doc, 내일, EMPTY_PLAN).ordering).toEqual(['옛']);
  });
});

describe('줄 만들기 — 손으로 넣은 게 먼저, 캘린더에서 온 게 뒤', () => {
  const 주문들 = [
    주문({ id: 'A' }),
    주문({ id: 'B' }),
    주문({ id: 'C' }),                                    // 캘린더에만 있다
    주문({ id: '내일것', deliveryDate: `${내일}T00:00:00.000Z` }),
  ];

  it('캘린더에 그 날짜로 잡힌 주문은 아무도 안 건드려도 뜬다 — 자동', () => {
    const rows = dayRows({ plan: EMPTY_PLAN, orders: 주문들, dateStr: 오늘 });
    expect(rows.map(r => r.orderId)).toEqual(['A', 'B', 'C']);
    expect(rows.every(r => r.auto)).toBe(true);
  });

  it('사람이 정한 차례가 먼저 오고, 그것들은 자동이 아니다', () => {
    const plan: DayPlan = { ordering: ['C', 'A'], timeSlots: {}, done: [] };
    const rows = dayRows({ plan, orders: 주문들, dateStr: 오늘 });
    expect(rows.map(r => r.orderId)).toEqual(['C', 'A', 'B']);
    expect(rows.map(r => r.auto)).toEqual([false, false, true]);
  });

  it('다른 날짜 주문은 저절로 안 들어온다', () => {
    const rows = dayRows({ plan: EMPTY_PLAN, orders: 주문들, dateStr: 오늘 });
    expect(rows.map(r => r.orderId)).not.toContain('내일것');
  });

  it('손으로 넣었으면 날짜가 달라도 남는다 — 일부러 끌어다 놓은 것이다', () => {
    const plan: DayPlan = { ordering: ['내일것'], timeSlots: {}, done: [] };
    const rows = dayRows({ plan, orders: 주문들, dateStr: 오늘 });
    expect(rows[0].orderId).toBe('내일것');
    expect(rows[0].auto).toBe(false);
  });

  it('배송완료·생산기록은 안 뜬다', () => {
    const 목록 = [
      주문({ id: '끝난것', status: OrderStatus.DELIVERED }),
      주문({ id: '가짜', partnerName: '생산기록' }),
      주문({ id: '살아있음' }),
    ];
    expect(dayRows({ plan: EMPTY_PLAN, orders: 목록, dateStr: 오늘 }).map(r => r.orderId)).toEqual(['살아있음']);
  });

  it('없어진 주문이 순서에 남아 있어도 줄로 안 만든다', () => {
    const plan: DayPlan = { ordering: ['지워진것', 'A'], timeSlots: {}, done: [] };
    expect(dayRows({ plan, orders: 주문들, dateStr: 오늘 }).map(r => r.orderId)).toEqual(['A', 'B', 'C']);
  });

  it('오전·오후와 체크를 줄에 싣는다', () => {
    const plan: DayPlan = { ordering: ['A', 'B'], timeSlots: { B: '오후' }, done: ['A'] };
    const rows = dayRows({ plan, orders: 주문들, dateStr: 오늘 });
    expect(bySlot(rows).오전.map(r => r.orderId)).toEqual(['A', 'C']);   // 기본은 오전
    expect(bySlot(rows).오후.map(r => r.orderId)).toEqual(['B']);
    expect(rows.find(r => r.orderId === 'A')!.done).toBe(true);
    expect(rows.find(r => r.orderId === 'B')!.done).toBe(false);
  });
});

describe('누가 정했나', () => {
  it('아무도 안 건드렸으면 자동', () => {
    expect(정한이(EMPTY_PLAN)).toBe('자동');
  });

  it('손댔으면 이름과 시각', () => {
    const plan: DayPlan = { ...EMPTY_PLAN, by: stamp('임영훈', new Date(2026, 8, 9, 14, 30)) };
    expect(정한이(plan)).toBe('임영훈 · 9/9 14:30');
  });

  it('시각이 깨져 있으면 이름만 — 빈칸보다 낫다', () => {
    expect(정한이({ ...EMPTY_PLAN, by: { name: '임영훈', at: '이상한값' } })).toBe('임영훈');
  });
});

describe('체크박스', () => {
  it('켜고 끈다', () => {
    const p1 = toggleDone(EMPTY_PLAN, 'A');
    expect(p1.done).toEqual(['A']);
    expect(toggleDone(p1, 'A').done).toEqual([]);
  });

  it('다른 것은 안 건드린다', () => {
    const plan: DayPlan = { ...EMPTY_PLAN, done: ['A', 'B'] };
    expect(toggleDone(plan, 'B').done).toEqual(['A']);
  });

  it('순서·시간대는 그대로 둔다', () => {
    const plan: DayPlan = { ordering: ['A'], timeSlots: { A: '오후' }, done: [] };
    const next = toggleDone(plan, 'A');
    expect(next.ordering).toEqual(['A']);
    expect(next.timeSlots).toEqual({ A: '오후' });
  });
});
