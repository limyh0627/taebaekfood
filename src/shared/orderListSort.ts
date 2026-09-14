import type { Order } from './types';

/**
 * **표 머리를 눌러 정렬한다** — 2026-09-14 사장님이 정한 대로.
 *
 * | 머리 | 한 번 | 두 번 |
 * |---|---|---|
 * | 거래처 | 가나다 | 거꾸로 |
 * | 주문일 | 오래된 것부터 | 최근 것부터 |
 * | 작업완료 여부 | 작업도 높은 주문이 위로 | 낮은 주문이 위로 |
 * | 비고 | 비고 있는 주문이 위로 | (그대로) |
 *
 * **푸는 것은 머리를 더 눌러서가 아니라 '초기화' 로 한다**(2026-09-14 사장님: "내가 여러번
 * 눌러서 필터 취소하라고 했는데 그거말고 … 초기화 버튼 넣어놔"). 세 번째 눌러 꺼지게 두면
 * 몇 번 눌렀는지를 세고 있어야 하고, 실수로 한 번 더 눌러 정렬이 사라지면 왜 그런지 모른다.
 *
 * **셈은 여기 하나다** — 화면은 무엇을 눌렀는지만 들고 있는다.
 * 정렬은 **제자리 정렬(stable)** 이라, 같은 값끼리는 원래 차례(출고예정일 임박 순 등)를 지킨다.
 * 그래서 목록 차례를 먼저 세우고 그 위에 이 정렬을 얹는다.
 */
export type OrderListSortKey = 'partner' | 'orderDate' | 'completion' | 'note';
export interface OrderListHeadSort {
  key: OrderListSortKey;
  dir: 'asc' | 'desc';
}

/** 비고는 거꾸로가 없다 — '비고 없는 것 먼저'는 쓸 데가 없어 더 눌러도 그대로 둔다. */
const 한방향 = new Set<OrderListSortKey>(['note']);

/**
 * 머리를 한 번 더 눌렀을 때 다음 상태. **여기서는 절대 꺼지지 않는다** — 푸는 것은 '초기화'다.
 */
export function nextHeadSort(current: OrderListHeadSort | null, key: OrderListSortKey): OrderListHeadSort {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (한방향.has(key)) return current;
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** 그 주문에서 체크가 끝난 품목 비율(0~1). 품목이 없으면 0 — 나눗셈이 NaN 이면 차례가 뒤죽박죽 된다. */
export const 작업도 = (order: Pick<Order, 'items'>) => order.items.length === 0
  ? 0
  : order.items.filter(item => item.checked).length / order.items.length;

/** 비고를 하나라도 단 주문인가. */
const 비고있나 = (order: Pick<Order, 'items'>) => order.items.some(item => (item.note ?? '').trim().length > 0);

const 때 = (value?: string) => {
  const t = new Date(value ?? '').getTime();
  //  날짜가 없거나 깨진 주문은 **맨 뒤**로 — 가운데 끼면 차례가 거짓말이 된다.
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

export function sortOrdersByHead<T extends Pick<Order, 'items' | 'createdAt' | 'partnerName'>>(
  rows: readonly T[],
  sort: OrderListHeadSort | null,
): T[] {
  if (!sort) return [...rows];
  const 뒤집기 = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case 'partner':
        //  한글 차례는 `localeCompare('ko')` 가 맡는다 — 글자 코드로 비교하면 'ㄱ'과 '가'가 갈린다.
        return (a.partnerName || '').localeCompare(b.partnerName || '', 'ko') * 뒤집기;
      case 'orderDate':
        return (때(a.createdAt) - 때(b.createdAt)) * 뒤집기;
      case 'completion':
        //  **한 번 누르면 작업도 높은 것이 위로** — 내림차순이 'asc' 자리에 온다.
        //  사장님이 정한 차례가 그렇다. 여기서 맞춰 두면 화면은 아무것도 안 뒤집어도 된다.
        return (작업도(b) - 작업도(a)) * 뒤집기;
      case 'note':
        return (Number(비고있나(b)) - Number(비고있나(a))) * 뒤집기;
      default:
        return 0;
    }
  });
}

/** 머리에 붙일 이름 — 눌렀을 때 무엇이 될지 말로 알려 준다. */
export function headSortTitle(sort: OrderListHeadSort | null, key: OrderListSortKey): string {
  const 다음 = nextHeadSort(sort, key);
  const 말 = (s: OrderListHeadSort) => {
    if (s.key === 'partner') return s.dir === 'asc' ? '가나다 순' : '가나다 거꾸로';
    if (s.key === 'orderDate') return s.dir === 'asc' ? '오래된 주문부터' : '최근 주문부터';
    if (s.key === 'completion') return s.dir === 'asc' ? '작업도 높은 순' : '작업도 낮은 순';
    return '비고 있는 것 먼저';
  };
  //  이미 그 상태면 '눌러서 …' 라고 하면 거짓말이 된다 — 비고를 한 번 더 누를 때가 그렇다.
  const 그대로 = sort?.key === 다음.key && sort?.dir === 다음.dir;
  return `${그대로 ? '지금' : '눌러서'} ${말(다음)} · 풀려면 조회 결과의 초기화`;
}
