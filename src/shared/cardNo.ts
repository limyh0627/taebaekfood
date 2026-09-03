import type { Order, PurchaseOrder } from './types';
import { nextDocNo } from './voucherStamp';

/**
 * **카드번호 — 주문·발주 카드를 사람이 가리켜 부르는 이름.**
 *
 * 전표는 `260901-01` 로 번호가 있는데 주문·발주 카드에는 없었다. 있는 건 만들 때 찍힌
 * id 뿐이라(`ORD-1785712782954`) 읽을 수도, 화면끼리 가리킬 수도 없었다 —
 * 전표를 끊을 때 고른 주문이 어느 카드인지 확인할 길이 없었다(2026-09-03 사장님).
 *
 * **전표와 같은 규칙을 쓴다** — `nextDocNo`(그날 쓰인 가장 큰 번호 + 1).
 * 개수로 매기면 하나 지웠을 때 번호를 다시 쓰게 되는데, 그 함정은 전표에서 이미 겪었다.
 *
 *     주문  ORD-260901-001
 *     발주  PO-260901-001
 *
 * 규칙이 하나여야 하니 셈은 `voucherStamp.nextDocNo` 를 그대로 부른다.
 */
export const ORDER_PREFIX = 'ORD-';
export const PO_PREFIX = 'PO-';

/** 그날 다음 주문 카드번호. `existing` 은 이미 있는 주문 전부. */
export function nextOrderNo(date: string, existing: Pick<Order, 'cardNo'>[]): string {
  return nextDocNo(date, existing.map(o => ({ docNo: o.cardNo })), ORDER_PREFIX);
}

/** 그날 다음 발주 카드번호. */
export function nextPoNo(date: string, existing: Pick<PurchaseOrder, 'cardNo'>[]): string {
  return nextDocNo(date, existing.map(o => ({ docNo: o.cardNo })), PO_PREFIX);
}

/**
 * 화면에 찍을 카드번호.
 * 번호가 있으면 그대로, 없으면(2026-09-03 이전 카드) **id 뒤 여섯 자리**로 물러선다 —
 * 옛 카드도 가리킬 이름은 있어야 한다. 목록 검색이 id 부분일치라 그 여섯 자리로 찾힌다.
 */
export function cardNoLabel(card: { id?: string; cardNo?: string } | undefined): string {
  if (card?.cardNo) return card.cardNo;
  const digits = String(card?.id ?? '').replace(/\D/g, '');
  return digits ? `#${digits.slice(-6)}` : '';
}
