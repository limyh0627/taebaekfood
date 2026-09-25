import type { CompanyId, Order } from '../../shared/types';
import { companyOf } from '../../shared/types';

/** 실시간 주문이 최신이다. 이전 세션의 상태가 한 프레임 남아도 다른 회사 주문은 합치지 않는다. */
export function mergeCompanyOrders(orders: Order[], historicalOrders: Order[], companyId: CompanyId): Order[] {
  const map = new Map<string, Order>();
  for (const order of historicalOrders) if (companyOf(order) === companyId) map.set(order.id, order);
  for (const order of orders) if (companyOf(order) === companyId) map.set(order.id, order);
  return Array.from(map.values());
}
