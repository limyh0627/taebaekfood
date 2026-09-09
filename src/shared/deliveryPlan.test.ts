import { describe, it, expect } from 'vitest';
import { planFor, withPlan, dayRows, bySlot, 정한이, toggleDone, stamp, withGroup, ungroup, EMPTY_PLAN, type DeliveryPlanDoc, type DayPlan } from './deliveryPlan';
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

describe('같이 나가는 묶음', () => {
  const 주문들 = [주문({ id: 'A' }), 주문({ id: 'B' }), 주문({ id: 'C' }), 주문({ id: 'D' })];
  const 차례 = (rows: { orderId: string }[]) => rows.map(r => r.orderId);

  it('묶은 것끼리 붙어 선다 — 흩어져 있으면 "같이 간다"가 안 읽힌다', () => {
    const plan: DayPlan = { ordering: ['A', 'B', 'C', 'D'], timeSlots: {}, done: [] };
    const 묶음 = withGroup(plan, ['B', 'D'], '1차');
    expect(차례(dayRows({ plan: 묶음, orders: 주문들, dateStr: 오늘 }))).toEqual(['A', 'B', 'D', 'C']);
  });

  it('자리는 제일 앞 사람 자리다 — 묶는다고 순서가 통째로 뒤집히면 안 된다', () => {
    const plan: DayPlan = { ordering: ['A', 'B', 'C', 'D'], timeSlots: {}, done: [] };
    const 묶음 = withGroup(plan, ['C', 'A']);
    //  A 가 먼저 서 있으니 A 자리에 C 를 데려온다 (맨 앞으로 끌어올리지 않는다)
    expect(차례(dayRows({ plan: 묶음, orders: 주문들, dateStr: 오늘 }))).toEqual(['A', 'C', 'B', 'D']);
  });

  it('첫 줄·끝 줄을 표시한다 — 화면이 이걸로 이음선을 그린다', () => {
    const plan = withGroup({ ordering: ['A', 'B', 'C'], timeSlots: {}, done: [] }, ['A', 'B'], '1차');
    const rows = dayRows({ plan, orders: 주문들, dateStr: 오늘 });
    expect(rows[0]).toMatchObject({ orderId: 'A', groupName: '1차', groupFirst: true, groupLast: false });
    expect(rows[1]).toMatchObject({ orderId: 'B', groupFirst: false, groupLast: true });
    expect(rows[2].groupId).toBeUndefined();
  });

  it('한 사람은 한 차만 탄다 — 새로 묶으면 앞 묶음에서 빠진다', () => {
    let plan: DayPlan = { ordering: ['A', 'B', 'C', 'D'], timeSlots: {}, done: [] };
    plan = withGroup(plan, ['A', 'B'], '1차');
    plan = withGroup(plan, ['B', 'C'], '2차');
    expect(plan.groups).toHaveLength(1);                  // A 만 남은 1차는 묶음이 아니다
    expect(plan.groups![0]).toMatchObject({ name: '2차', orderIds: ['B', 'C'] });
  });

  it('묶음에서 빼면 혼자 간다. 한 명만 남으면 그 묶음도 없앤다', () => {
    const plan = withGroup({ ordering: ['A', 'B', 'C'], timeSlots: {}, done: [] }, ['A', 'B', 'C'], '1차');
    const 뺀뒤 = ungroup(plan, 'C');
    expect(뺀뒤.groups![0].orderIds).toEqual(['A', 'B']);
    expect(ungroup(뺀뒤, 'B').groups).toEqual([]);         // A 혼자 남으면 묶음이 아니다
  });

  it('캘린더에서 저절로 들어온 것도 묶을 수 있다', () => {
    const plan = withGroup(EMPTY_PLAN, ['C', 'A']);
    const rows = dayRows({ plan, orders: 주문들, dateStr: 오늘 });
    //  손으로 넣은 게 없으니 캘린더 차례(A,B,C,D)에서 A 자리에 C 를 데려온다
    expect(차례(rows)).toEqual(['A', 'C', 'B', 'D']);
    expect(rows[0].auto).toBe(true);
  });

  it('묶음이 없으면 차례를 안 건드린다', () => {
    const plan: DayPlan = { ordering: ['B', 'A'], timeSlots: {}, done: [] };
    expect(차례(dayRows({ plan, orders: 주문들, dateStr: 오늘 }))).toEqual(['B', 'A', 'C', 'D']);
  });
});
