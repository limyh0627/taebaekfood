import { describe, it, expect } from 'vitest';
import { sortByColumns, toggleSort, sortRank, sortSummary, type TimelineSort } from './timelineColumnSort';
import type { TimelineRow } from './timelineRows';

/**
 * 전표 표의 머리를 눌러 세운다 — **여러 칸을 겹칠 수 있다**(2026-09-15 사장님:
 * "정렬 중복 가능하게 해"). 누른 차례가 곧 우선순위다.
 */
const 전표 = (이름: string, 날: string, 금액: number, 담당?: string): TimelineRow =>
  ({ kind: 'stmt', data: { id: 이름 + 날, partnerName: 이름, tradeDate: 날, totalAmount: 금액, type: '매출', createdBy: 담당 },
     dateKey: 날, ts: 날 } as unknown as TimelineRow);

const 이름들 = (rows: TimelineRow[]) => rows.map(r => (r as { data: { partnerName: string } }).data.partnerName);
const 날들 = (rows: TimelineRow[]) => rows.map(r => (r as { data: { tradeDate: string } }).data.tradeDate);

describe('머리로 세우기', () => {
  const 목록 = [
    전표('해내음', '2026-09-03', 300),
    전표('가미김밥', '2026-09-05', 100),
    전표('해내음', '2026-09-01', 200),
  ];

  it('업체명 가나다', () => {
    expect(이름들(sortByColumns(목록, [{ column: 'partner', dir: 'asc' }]))).toEqual(['가미김밥', '해내음', '해내음']);
  });

  it('거꾸로도 된다', () => {
    expect(이름들(sortByColumns(목록, [{ column: 'partner', dir: 'desc' }]))).toEqual(['해내음', '해내음', '가미김밥']);
  });

  it('**겹쳐 세운다** — 업체명으로 묶고 그 안에서 날짜 순', () => {
    const 결과 = sortByColumns(목록, [{ column: 'partner', dir: 'asc' }, { column: 'date', dir: 'asc' }]);
    expect(이름들(결과)).toEqual(['가미김밥', '해내음', '해내음']);
    expect(날들(결과)).toEqual(['2026-09-05', '2026-09-01', '2026-09-03']);
  });

  it('누른 차례가 우선순위다 — 뒤집으면 결과가 달라진다', () => {
    const 날짜먼저 = sortByColumns(목록, [{ column: 'date', dir: 'asc' }, { column: 'partner', dir: 'asc' }]);
    expect(날들(날짜먼저)).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
  });

  it('금액은 숫자로 견준다 — 글자로 보면 100 이 300 보다 크다', () => {
    expect(sortByColumns(목록, [{ column: 'amount', dir: 'asc' }])
      .map(r => (r as { data: { totalAmount: number } }).data.totalAmount)).toEqual([100, 200, 300]);
  });

  it('안 걸면 원래 차례 그대로', () => {
    expect(이름들(sortByColumns(목록, []))).toEqual(['해내음', '가미김밥', '해내음']);
  });

  it('담당자가 빈 줄은 맨 뒤로 — 가나다 앞에 몰리면 찾는 것이 밀린다', () => {
    const 섞임 = [전표('가', '2026-09-01', 1), 전표('나', '2026-09-02', 1, '윤주임')];
    const 결과 = sortByColumns(섞임, [{ column: 'owner', dir: 'asc' }]);
    expect(이름들(결과)).toEqual(['나', '가']);
  });

  it('화면이 셈해 그리는 칸은 부르는 쪽이 글자를 넘긴다', () => {
    const 결과 = sortByColumns(목록, [{ column: 'settle', dir: 'asc' }], {
      textOf: row => (row as { data: { partnerName: string } }).data.partnerName === '해내음' ? '미수' : '완료',
    });
    //  한글 차례로 '미수' 가 '완료' 보다 앞이다(ㅁ < ㅇ) — 화면에 보이는 글자대로 선다.
    expect(이름들(결과)[0]).toBe('해내음');
  });
});

describe('머리를 눌렀을 때', () => {
  it('처음 누르면 뒤에 붙는다 — 겹치기다', () => {
    let s: TimelineSort[] = [];
    s = toggleSort(s, 'partner');
    s = toggleSort(s, 'date');
    expect(s).toEqual([{ column: 'partner', dir: 'asc' }, { column: 'date', dir: 'asc' }]);
  });

  it('이미 걸린 칸을 누르면 방향만 뒤집는다 — 차례는 그대로', () => {
    const s = toggleSort([{ column: 'partner', dir: 'asc' }, { column: 'date', dir: 'asc' }], 'partner');
    expect(s).toEqual([{ column: 'partner', dir: 'desc' }, { column: 'date', dir: 'asc' }]);
  });

  it('**눌러서는 안 빠진다** — 푸는 것은 정렬 해제 하나다', () => {
    let s: TimelineSort[] = [{ column: 'partner', dir: 'asc' }];
    s = toggleSort(s, 'partner');
    s = toggleSort(s, 'partner');
    expect(s).toHaveLength(1);
  });

  it('몇 번째로 걸렸는지 센다 — 안 걸렸으면 0', () => {
    const s: TimelineSort[] = [{ column: 'partner', dir: 'asc' }, { column: 'date', dir: 'desc' }];
    expect(sortRank(s, 'partner')).toBe(1);
    expect(sortRank(s, 'date')).toBe(2);
    expect(sortRank(s, 'amount')).toBe(0);
  });

  it('걸린 정렬을 사람 말로 적는다', () => {
    expect(sortSummary([{ column: 'partner', dir: 'asc' }, { column: 'amount', dir: 'desc' }]))
      .toBe('업체명 오름 · 금액 내림');
  });
});

/**
 * 구분은 가나다가 아니라 **장부를 읽는 차례**다(2026-09-15 사장님:
 * "구분 정렬은 매출 매입 입금 출금 순으로 바뀌게") — 판 것 → 산 것 → 받은 돈 → 낸 돈.
 */
describe('구분 정렬 차례', () => {
  const 줄 = (kind: '매출' | '매입' | '입금' | '출금'): TimelineRow =>
    kind === '매출' || kind === '매입'
      ? ({ kind: 'stmt', data: { id: kind, partnerName: kind, tradeDate: '2026-09-01', totalAmount: 1, type: kind }, dateKey: '2026-09-01', ts: '2026-09-01' } as unknown as TimelineRow)
      : ({ kind: 'cash', entry: { id: kind }, dir: kind, amount: 1, date: '2026-09-01', dateKey: '2026-09-01', ts: '2026-09-01' } as unknown as TimelineRow);

  it('매출 · 매입 · 입금 · 출금 차례로 선다', () => {
    const 섞임 = [줄('출금'), 줄('매입'), 줄('입금'), 줄('매출')];
    const 결과 = sortByColumns(섞임, [{ column: 'kind', dir: 'asc' }]);
    expect(결과.map(r => (r.kind === 'stmt' ? (r as { data: { type: string } }).data.type : (r as { dir: string }).dir)))
      .toEqual(['매출', '매입', '입금', '출금']);
  });

  it('가나다였다면 매입이 매출보다 앞이었다 — 그게 아니라는 것이 핵심이다', () => {
    const 결과 = sortByColumns([줄('매입'), 줄('매출')], [{ column: 'kind', dir: 'asc' }]);
    expect((결과[0] as { data: { type: string } }).data.type).toBe('매출');
  });
});
