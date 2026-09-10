import type { Order } from './types';
import { findLineIndex } from './orderLine';

/**
 * **작업순서 줄 → 그 주문의 어느 품목 줄인가.**
 *
 * 2026-09-09 사장님: "주문 카드에는 한줄별로 체크박스가 달려있잖아 그거 그대로 쓰면
 * 되는거 아니야?" — 맞다. 작업순서 줄은 곧 주문의 품목 줄이라 체크를 새로 만들 이유가 없다.
 * `order.items[i].checked` 를 그대로 쓰면 한 쪽에서 체크한 게 주문카드에도 뜬다.
 *
 * ---
 * **자리(몇 번째)로 찾지 않는다.** 작업순서 줄은 담을 때 찍어 둔 **사본**이라, 주문에서
 * 앞 품목을 지우면 뒤 자리가 당겨진다 — 화면엔 B 라고 떠 있는데 체크는 C 에 찍힌다.
 *
 * 되찾는 이름은 **주문 쪽이 만든다** — [orderLine.lineKeyAt](./orderLine.ts).
 * 같은 품목이 한 주문에 두 줄이면 `참기름#1` · `참기름#2` 로 갈라진다(2026-09-09 사장님).
 *
 * 못 찾으면 `-1`. 부르는 쪽은 그 줄을 목록에서 뺀다.
 *
 * 부수효과 없음(입력 → 값).
 */
export function itemIndexOf(
  wi: { lineKey?: string; itemId?: string },
  order: Order | undefined,
): number {
  //  lineKey 가 임자다. 없는 옛 줄은 품목 id 를 이름표로 쓴다(그때는 한 줄뿐이었다).
  return findLineIndex(order?.items, wi.lineKey || wi.itemId);
}

/** 이 작업순서 줄이 체크돼 있나 */
export const isLineChecked = (
  wi: { lineKey?: string; itemId?: string },
  order: Order | undefined,
): boolean => {
  const i = itemIndexOf(wi, order);
  return i >= 0 && !!order?.items?.[i]?.checked;
};
