import { describe, it, expect } from 'vitest';
import { listFilterChips, type ListFilterState } from './orderListFilterChips';

/**
 * 조회 결과 옆에 "지금 무엇이 걸려 있나"를 적는다(2026-09-14 사장님).
 * **기본값은 안 적는다** — 늘 걸린 것까지 적으면 정작 이상한 조건이 묻힌다.
 */
const 기본: ListFilterState = {
  dateFrom: '2026-09-01', dateTo: '2026-09-14',
  defaultFrom: '2026-09-01', defaultTo: '2026-09-14',
  sortLabel: '출고예정일 임박 순', defaultSortLabel: '출고예정일 임박 순',
  headSort: null,
};
const 말 = (s: Partial<ListFilterState> = {}) => listFilterChips({ ...기본, ...s }).map(c => `${c.name} ${c.value}`);

describe('걸린 조건 적기', () => {
  it('기본 상태면 아무것도 안 적는다', () => {
    expect(말()).toEqual([]);
  });

  it('날짜를 기본에서 벗어나게 잡으면 적는다', () => {
    expect(말({ dateFrom: '2026-08-01' })).toEqual(['주문일 2026-08-01 ~ 2026-09-14']);
  });

  it('상태 탭·거래처·전체 검색을 적는다', () => {
    expect(말({ statusLabel: '작업중', partnerName: '완도식품', searchTerm: '  참기름 ' }))
      .toEqual(['상태 작업중', '거래처 완도식품', '검색 참기름']);
  });

  it('검색 필드는 값까지 골라야 적는다 — 필드만 고르면 안 걸러진다', () => {
    expect(말({ filterFieldLabel: '라벨 작업' })).toEqual([]);
    expect(말({ filterFieldLabel: '라벨 작업', filterValue: '부착' })).toEqual(['라벨 작업 부착']);
  });

  it('정렬은 기본과 다를 때만 적는다', () => {
    expect(말({ sortLabel: '출고예정일 임박 순' })).toEqual([]);
    expect(말({ sortLabel: '작업도 높은 순' })).toEqual(['정렬 작업도 높은 순']);
  });

  it('표 머리 정렬은 목록 정렬 위에 얹히므로 따로 적는다', () => {
    expect(말({ sortLabel: '주문일 최신 순', headSort: { key: 'partner', dir: 'desc' } }))
      .toEqual(['정렬 주문일 최신 순', '표 정렬 거래처 가나다 거꾸로']);
  });

  it('표 머리 정렬을 넷 다 말로 옮긴다', () => {
    expect(말({ headSort: { key: 'orderDate', dir: 'asc' } })).toEqual(['표 정렬 주문일 오래된 순']);
    expect(말({ headSort: { key: 'orderDate', dir: 'desc' } })).toEqual(['표 정렬 주문일 최근 순']);
    expect(말({ headSort: { key: 'completion', dir: 'asc' } })).toEqual(['표 정렬 작업도 높은 순']);
    expect(말({ headSort: { key: 'completion', dir: 'desc' } })).toEqual(['표 정렬 작업도 낮은 순']);
    expect(말({ headSort: { key: 'note', dir: 'asc' } })).toEqual(['표 정렬 비고 있는 것 먼저']);
  });

  it('여럿 걸리면 걸린 차례대로 다 적는다', () => {
    expect(말({ dateFrom: '2026-07-01', statusLabel: '대기중', partnerName: '해내음', headSort: { key: 'note', dir: 'asc' } }))
      .toEqual(['주문일 2026-07-01 ~ 2026-09-14', '상태 대기중', '거래처 해내음', '표 정렬 비고 있는 것 먼저']);
  });
});
