import { describe, it, expect } from 'vitest';
import { groupByMonth } from './groupByMonth';

const 날 = (d: string) => ({ d });
const 날짜 = (r: { d: string }) => r.d;

describe('groupByMonth', () => {
  it('달로 묶는다', () => {
    const g = groupByMonth([날('2026-09-03'), 날('2026-09-20'), 날('2026-08-01')], 날짜);
    expect(g.map(x => x.month)).toEqual(['2026-09', '2026-08']);
    expect(g[0].rows).toHaveLength(2);
  });

  it('최신 달이 위로', () => {
    const g = groupByMonth([날('2026-07-01'), 날('2026-09-01'), 날('2026-08-01')], 날짜);
    expect(g.map(x => x.month)).toEqual(['2026-09', '2026-08', '2026-07']);
  });

  it('달 안에서도 최신이 위 — 오늘 것을 찾으러 오는 화면이다', () => {
    const g = groupByMonth([날('2026-09-03'), 날('2026-09-20'), 날('2026-09-11')], 날짜);
    expect(g[0].rows.map(날짜)).toEqual(['2026-09-20', '2026-09-11', '2026-09-03']);
  });

  it('날짜를 못 읽으면 미정으로 모은다 — 조용히 사라지면 안 된다', () => {
    const g = groupByMonth([날('2026-09-01'), 날(''), 날('')], 날짜);
    expect(g.find(x => x.month === '미정')?.rows).toHaveLength(2);
  });

  it('원본을 안 건드린다', () => {
    const src = [날('2026-08-01'), 날('2026-09-01')];
    groupByMonth(src, 날짜);
    expect(src.map(날짜)).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('빈 목록은 빈 결과', () => {
    expect(groupByMonth([], 날짜)).toEqual([]);
  });

  it('날짜를 어디서 읽을지는 부르는 쪽이 정한다 — 주문은 납기, 발주는 등록일', () => {
    const 주문 = [{ deliveryDate: '2026-09-20', createdAt: '2026-08-01' }];
    const g = groupByMonth(주문, o => o.deliveryDate || o.createdAt);
    expect(g[0].month).toBe('2026-09');
  });
});
