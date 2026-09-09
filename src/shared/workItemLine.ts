import type { Order } from './types';

/**
 * **작업순서 줄 → 그 주문의 어느 품목인가.**
 *
 * 2026-09-09 사장님: "주문 카드에는 한줄별로 체크박스가 달려있잖아 그거 그대로 쓰면
 * 되는거 아니야?" — 맞다. 작업순서 줄은 곧 주문의 품목 줄이라 체크 상태를 새로 만들
 * 이유가 없다. `order.items[i].checked` 를 그대로 쓰면 한 쪽에서 체크한 게 주문카드에도 뜬다.
 *
 * ---
 * **자리(몇 번째)로 찾지 않는다. 품목 id 로만 찾는다.**
 *
 * 2026-09-09 사장님: "애초에 번호가 아니라 품목 id로만 찾는게 낫지 않음? 몇번째 주문이냐는
 * 너무 위험한데". 맞다. 작업순서 줄은 담을 때 찍어 둔 **사본**이라, 주문에서 앞 품목을
 * 지우면 뒤 자리가 당겨진다 — 줄은 옛 자리를 가리키니 **화면엔 B 라고 떠 있는데
 * 체크는 C 에 찍힌다.** 자리는 언제든 밀리지만 품목 id 는 안 밀린다.
 *
 * 처음엔 자리를 먼저 보고 어긋날 때만 품목으로 되찾게 짰는데, 그러면 **틀릴 수 있는 길을
 * 하나 열어 둔 채 방어막을 치는 것**이다. 길 자체를 없앴다.
 *
 * 운영 데이터로 확인했다(2026-09-09) — 주문 314건 중 **한 주문에 같은 품목이 두 줄인 건 0건**.
 * 만에 하나 두 줄이 생기면 둘 다 첫 줄을 가리킨다. 같이 체크되는 건 눈에 보이지만,
 * 엉뚱한 품목에 찍히는 건 안 보인다 — 덜 나쁜 쪽으로 틀린다.
 *
 * 못 찾으면 `-1`. 부르는 쪽은 그 줄을 목록에서 뺀다.
 *
 * 부수효과 없음(입력 → 값).
 */
export function itemIndexOf(
  wi: { itemId?: string },
  order: Order | undefined,
): number {
  if (!wi.itemId) return -1;
  return (order?.items ?? []).findIndex(i => i.itemId === wi.itemId);
}

/** 이 작업순서 줄이 체크돼 있나 */
export const isLineChecked = (
  wi: { itemId?: string },
  order: Order | undefined,
): boolean => {
  const i = itemIndexOf(wi, order);
  return i >= 0 && !!order?.items?.[i]?.checked;
};
