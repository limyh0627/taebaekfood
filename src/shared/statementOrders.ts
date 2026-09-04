import { OrderStatus } from './types';
import type { Order } from './types';
import { dateOfLocal } from './day';

/**
 * **전표를 끊을 주문을 고르는 셈.**
 *
 * [TradeStatement.tsx](../../components/TradeStatement.tsx) 안에 있던 것을 떼어 왔다
 * (양식 쪼개기 ②, 2026-09-05). 규칙이 미묘한데 화면에 붙어 있어 시험할 방법이 없었다 —
 * 특히 **날짜 필터가 발행완료 건에만 걸린다**는 것.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 아직 끝나지 않은 주문 — 대기·작업·출고·배송중. */
export const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.SHIPPED,
]);

export const isActive = (o: Pick<Order, 'status'>) => ACTIVE_STATUSES.has(o.status as OrderStatus);

/** 전표가 걸렸나 — 판정은 부르는 쪽이 준다(전표 실물을 봐야 한다). */
export type Vouchered = (o: Order) => boolean;

const 늦은순 = (a: Order, b: Order) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** 전표 안 걸린 것부터. 같으면 뒤 비교로 넘긴다. */
const 미발행먼저 = (v: Vouchered) => (a: Order, b: Order) => {
  const aP = v(a), bP = v(b);
  return aP === bP ? 0 : aP ? 1 : -1;
};

export interface PartnerOrdersInput {
  orders: readonly Order[];
  partnerId: string;
  isVouchered: Vouchered;
  /** 진행 주문만 볼지 */
  onlyActive?: boolean;
  /** 'YYYY-MM-DD' */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 한 거래처의 주문 목록.
 *
 * **날짜 필터는 발행완료 건에만 건다.** 미발행 주문은 아무리 오래됐어도 보여야 한다 —
 * 안 그러면 지난달에 놓친 주문이 화면에서 영영 사라진다. 그게 놓치면 아픈 건이다.
 */
export function partnerOrders(input: PartnerOrdersInput): Order[] {
  const { orders, partnerId, isVouchered, onlyActive, dateFrom, dateTo } = input;

  let list = orders.filter(o => o.partnerId === partnerId).sort(늦은순);

  if (onlyActive) {
    // 진행주문 = 미발행(배송완료·예전주문이어도 전표가 안 걸렸으면 표시) + 진행중 상태.
    // 발행완료는 발행내역에서 본다. **판정은 전표 실물** — 플래그만 남고 전표가 없는 건 여기 떠야 한다.
    list = list.filter(o => !isVouchered(o) || isActive(o));
    list = [...list].sort((a, b) => 미발행먼저(isVouchered)(a, b) || 늦은순(a, b));
  }

  if (dateFrom) list = list.filter(o => !isVouchered(o) || dateOfLocal(o.createdAt) >= dateFrom);
  if (dateTo)   list = list.filter(o => !isVouchered(o) || dateOfLocal(o.createdAt) <= dateTo);
  return list;
}

/**
 * 거래처를 안 고른 화면의 목록 — **진행 주문 + 전표 안 걸린 배송완료 주문.**
 *
 * 예전엔 진행 상태만 담아서, 배송완료로 넘어간 주문은 전표를 안 끊었어도 여기 영영
 * 안 떴다. 거래처를 콕 집어 골라야만 보였다. 배송이 끝났다고 전표가 선 건 아니다 —
 * 오히려 그쪽이 놓치면 아픈 건이다.
 *
 * 전표가 걸린 배송완료 주문은 계속 뺀다(발행내역에서 본다).
 * 납기 이른 순 — 급한 것이 위로 온다.
 */
export function activeOrders(orders: readonly Order[], isVouchered: Vouchered): Order[] {
  return orders
    .filter(o => o.partnerName !== '생산기록')   // 생산기록은 주문이 아니다
    .filter(o => isActive(o) || !isVouchered(o))
    .sort((a, b) =>
      미발행먼저(isVouchered)(a, b) ||
      new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime());
}

/** 진행 주문이 있는 거래처 id — 목록에서 표를 다는 데 쓴다. */
export function activePartnerIds(orders: readonly Order[]): Set<string> {
  return new Set(orders.filter(isActive).map(o => o.partnerId ?? ''));
}
