import type { Order } from './types';

/**
 * **재고가 이미 움직인 주문은 품목을 못 고친다.**
 *
 * 2026-09-09 에 무경유통 볶음참깨에서 로트가 **10배(2,000kg)** 빠진 걸 쫓다 찾았다.
 *
 * `handleUpdateItems` 는 `orders.items` 만 덮어썼다 — **재고·로트는 손도 안 댔다.**
 * 그래서 생산처리·출고가 끝난 뒤 수량을 고치면 이미 빠진 재고가 그대로 남는다.
 * 무경 건은 200으로 출고된 뒤 20으로 고쳐졌고, 로트에서는 200이 빠진 채였다.
 * 아무 표시도 안 났다 — 주문 카드에는 20이라고 적혀 있으니 볼 방법이 없다.
 *
 * ---
 * **고치는 길을 막는 게 맞다.** 되돌렸다 다시 처리하면 엔진이 재고를 정확히 맞춰 준다
 * (`reconcileOrderStock`). 여기서 차이를 계산해 재고를 손보려 들면, 되돌리기와 두 벌이 되고
 * 그 둘이 갈리는 순간 어느 쪽이 맞는지 알 방법이 없어진다.
 *
 * 앱이 이미 같은 규칙을 쓴다 — 예전 주문(DELIVERED)은 삭제를 막는다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 이 주문 때문에 재고가 이미 움직였나 */
export const stockMoved = (o: Pick<Order, 'producedAt' | 'shippedOut'> | undefined): boolean =>
  !!o?.producedAt || !!o?.shippedOut;

/** 품목(수량·구성)을 고쳐도 되나 */
export const canEditItems = (o: Pick<Order, 'producedAt' | 'shippedOut'> | undefined): boolean =>
  !stockMoved(o);

/**
 * 못 고칠 때 보여줄 말. **무엇이 이미 움직였는지 짚어 준다** —
 * "안 됩니다"만 뜨면 왜 안 되는지 몰라 다른 길로 우회한다.
 */
export function editBlockMessage(o: Pick<Order, 'producedAt' | 'shippedOut'> | undefined): string {
  const 한일: string[] = [];
  if (o?.producedAt) 한일.push('생산처리');
  if (o?.shippedOut) 한일.push('출고');
  if (한일.length === 0) return '';
  return `이미 ${한일.join('·')}된 주문이라 품목을 고칠 수 없습니다.\n\n`
    + `여기서 수량만 고치면 이미 빠진 재고·로트는 그대로 남아 장부가 갈립니다.\n`
    + `주문 상태를 되돌린 뒤 고치고 다시 처리해 주세요 — 그때 재고가 같이 따라옵니다.`;
}
