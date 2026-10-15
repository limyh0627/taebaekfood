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

describe('월 표시와 원문 정렬 분리',()=>{
 it('같은 로컬 날짜에서도 원문 시각 역순을 유지한다',()=>{const rows=[날('2026-10-31T15:00:00Z'),날('2026-10-31T22:00:00Z')];const g=groupByMonth(rows,날짜,()=> '2026-11-01');expect(g[0].month).toBe('2026-11');expect(g[0].rows.map(날짜)).toEqual([rows[1].d,rows[0].d]);});
 it('세 번째 인자를 생략한 기존 호출과 명시한 호출은 같다',()=>{const rows=[날('2026-09-01'),날(''),날('invalid')];expect(groupByMonth(rows,날짜)).toEqual(groupByMonth(rows,날짜,날짜));});
 it('월 콜백의 빈값은 미정이고 잘못된 문자열은 기존 절단 규칙을 따른다',()=>{expect(groupByMonth([날('a'),날('b')],날짜,r=>r.d==='a'?'':'invalid').find(g=>g.month==='미정')?.rows.map(row=>row.d)).toEqual(['a']);expect(groupByMonth([날('a')],날짜,()=> 'invalid')[0].month).toBe('invalid');});
});
