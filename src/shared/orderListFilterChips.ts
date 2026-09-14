import type { OrderListHeadSort } from './orderListSort';

/**
 * **지금 무엇이 걸려 있나** — 조회 결과 옆에 적을 말.
 *
 * 2026-09-14 사장님: "조회 N건 옆에 어떤 필터 적용되는지 적히게 하고 그 옆에다 초기화 버튼
 * 넣어놔". 조건이 여섯 군데(날짜·검색 필드·거래처·정렬·전체 검색·상태 탭)에 흩어져 있어서,
 * **왜 16건만 보이는지** 알려면 화면을 위아래로 훑어야 했다. 한 줄로 모아 적는다.
 *
 * **기본값은 안 적는다.** 늘 걸려 있는 것까지 적으면 줄이 길어져 정작 이상한 조건이 묻힌다.
 * 기본은 이달 1일~오늘 · 전체 상태 · 출고예정일 임박 순이다.
 *
 * 순수 함수다 — 화면은 이 목록을 그리기만 한다.
 */
export interface ListFilterState {
  dateFrom: string;
  dateTo: string;
  /** 기본 날짜 범위(이달 1일 ~ 오늘) — 이것과 같으면 안 적는다. */
  defaultFrom: string;
  defaultTo: string;
  filterFieldLabel?: string;
  filterValue?: string;
  partnerName?: string;
  searchTerm?: string;
  statusLabel?: string;
  sortLabel?: string;
  /** 기본 정렬 이름 — 이것과 같으면 안 적는다. */
  defaultSortLabel?: string;
  headSort: OrderListHeadSort | null;
}

export interface ListFilterChip {
  key: string;
  /** `거래처` 처럼 무엇에 건 조건인지 */
  name: string;
  /** `완도식품` 처럼 무엇으로 걸었는지 */
  value: string;
}

const 머리정렬말 = (sort: OrderListHeadSort) => {
  if (sort.key === 'partner') return sort.dir === 'asc' ? '거래처 가나다 순' : '거래처 가나다 거꾸로';
  if (sort.key === 'orderDate') return sort.dir === 'asc' ? '주문일 오래된 순' : '주문일 최근 순';
  if (sort.key === 'completion') return sort.dir === 'asc' ? '작업도 높은 순' : '작업도 낮은 순';
  return '비고 있는 것 먼저';
};

export function listFilterChips(state: ListFilterState): ListFilterChip[] {
  const chips: ListFilterChip[] = [];

  if (state.dateFrom !== state.defaultFrom || state.dateTo !== state.defaultTo) {
    chips.push({ key: 'date', name: '주문일', value: `${state.dateFrom || '처음'} ~ ${state.dateTo || '끝'}` });
  }
  if (state.statusLabel) chips.push({ key: 'status', name: '상태', value: state.statusLabel });
  //  검색 필드는 **값까지 골라야** 걸린 것이다 — 필드만 고르면 아무것도 안 걸러진다.
  if (state.filterFieldLabel && state.filterValue) {
    chips.push({ key: 'field', name: state.filterFieldLabel, value: state.filterValue });
  }
  if (state.partnerName) chips.push({ key: 'partner', name: '거래처', value: state.partnerName });
  if ((state.searchTerm ?? '').trim()) chips.push({ key: 'search', name: '검색', value: state.searchTerm!.trim() });
  if (state.sortLabel && state.sortLabel !== state.defaultSortLabel) {
    chips.push({ key: 'sort', name: '정렬', value: state.sortLabel });
  }
  //  표 머리 정렬은 목록 정렬 **위에** 얹히는 것이라 따로 적는다 — 둘이 같이 걸릴 수 있다.
  if (state.headSort) chips.push({ key: 'headSort', name: '표 정렬', value: 머리정렬말(state.headSort) });

  return chips;
}
