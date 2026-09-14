import type { Order, OrderItem } from './types';

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
 * **이 손질이 재고를 건드리나 — 줄 단위로 본다.**
 *
 * 2026-09-14 사장님: "푸드원에 비고 다는데 왜 생산완료처리된 품목이라 변경이 불가능하다는
 * 알림이 떠", 그리고 "애초에 작업완료된게 푸드원은 참기름 골드밖에 없는데 왜 나머지 품목에도
 * 그런 경고가 떠".
 *
 * 두 가지가 겹쳐 있었다 —
 *   ① **비고는 재고와 아무 상관이 없는데** 품목 수정 전체가 한 덩어리로 막혔다.
 *   ② **잠그는 단위가 주문 전체였다.** 한 줄만 생산했어도 나머지 줄까지 같이 잠겼다.
 *      지금은 줄마다 생산 기록이 남는다(`order.itemInventory[lineId]`) — 그 줄만 잠그면 된다.
 *
 * **고쳐도 되는 칸을 열거한다**(막을 칸이 아니라). 새 칸이 생겼을 때 깜빡하고 안 적으면
 * 막히는 쪽으로 떨어져야 한다 — 반대로 적으면 새 칸이 조용히 통과해 재고가 갈린다.
 *
 * `checked` 는 **여기 없다.** 작업완료는 재고를 움직이는 길(`handleToggleItemChecked`)이
 * 따로 있고, 그 길은 재고 확인창·생산처리를 지난다. 여기로 우회시키면 안 된다.
 */
const 재고와무관한칸 = new Set([
  'note', 'noteBy', 'noteAt',
  //  비고의 **중요 표시** — 빨간 느낌표를 붙일지 말지다. 재고와 아무 상관이 없다.
  //  2026-09-15: 이 칸을 만들면서 여기 적는 걸 빠뜨려, 생산된 줄에 중요만 체크해도
  //  "이미 생산처리돼서 수량·구성을 고칠 수 없습니다" 가 떴다. 위 설계대로 막힌 것이다.
  'noteImportant',
  'labelType', 'mfgDate', 'displaySize', 'boxType',
  //  라벨·제조일을 **누가 언제** 바꿨나(`stampOrderItemEdits` 가 찍는다). 기록일 뿐이다.
  'labelBy', 'labelAt', 'mfgBy', 'mfgAt',
]);

type 줄 = OrderItem & Record<string, unknown>;

/**
 * 그 줄이 **지금** 생산돼 있나 — 줄 기록이 근거다.
 *
 * **기록이 있는지가 아니라 `applied` 인지를 본다.** 체크를 풀면 엔진은 그 기록을 지우지 않고
 * `applied: false` 로 표시만 남긴다(되돌린 이력을 남겨야 하니까). 그런데 여기서 "기록이
 * 있으면 생산됨" 으로 보던 탓에, **한 번 체크했다 푼 줄이 영영 잠겼다** —
 * 2026-09-15 사장님: "애초에 생산 체크도 안돼있어 완도식품은".
 *
 * 되돌린 줄은 재고가 이미 제자리로 돌아갔다. 잠글 이유가 없다.
 */
const 줄이생산됨 = (order: Pick<Order, 'itemInventory' | 'producedAt' | 'shippedOut'>, line: 줄): boolean => {
  //  **줄 기록이 아예 없는 옛 주문**은 근거가 없다 — 주문 단위로 본다(안전한 쪽).
  if (!order.itemInventory) return stockMoved(order);
  return !!(line.lineId && order.itemInventory[line.lineId]?.applied);
};

/**
 * 막아야 하는 손질인가. 막을 게 없으면 `null`, 있으면 **걸린 줄의 이름**을 돌려준다.
 *
 * 줄을 더하거나 뺐으면 짝을 맞출 수 없으니 **주문 단위로 판단한다** — 그때는 재고가 움직인
 * 주문 자체를 막는다(옛 규칙 그대로).
 */
export function blockedEditLine(
  order: Pick<Order, 'itemInventory' | 'producedAt' | 'shippedOut'> & { items?: OrderItem[] },
  after: readonly OrderItem[],
): string | null {
  const before = order.items;
  if (!before || before.length !== after.length) return stockMoved(order) ? '주문 전체' : null;

  for (let i = 0; i < before.length; i++) {
    const 옛 = before[i] as unknown as 줄;
    const 새 = after[i] as unknown as 줄;
    const 칸들 = new Set([...Object.keys(옛), ...Object.keys(새)]);
    const 재고건드림 = [...칸들].some(k =>
      !재고와무관한칸.has(k) && JSON.stringify(옛[k]) !== JSON.stringify(새[k]));
    if (재고건드림 && 줄이생산됨(order, 옛)) return String(옛.name ?? 옛.itemId ?? '이 품목');
  }
  return null;
}

/**
 * 못 고칠 때 보여줄 말. **무엇이 이미 움직였는지, 어느 줄이 걸렸는지 짚어 준다** —
 * "안 됩니다"만 뜨면 왜 안 되는지 몰라 다른 길로 우회한다.
 */
export function editBlockMessage(
  o: Pick<Order, 'producedAt' | 'shippedOut'> | undefined,
  걸린줄?: string,
): string {
  const 한일: string[] = [];
  if (o?.producedAt) 한일.push('생산처리');
  if (o?.shippedOut) 한일.push('출고');
  //  **아무것도 안 움직였으면 할 말이 없다** — 빈 글자를 돌려준다(옛 규칙 그대로).
  //  다만 줄 단위로 걸렸으면(주문에는 도장이 없고 그 줄만 생산된 경우) 할 말이 있다.
  if (한일.length === 0 && !걸린줄) return '';
  const 무엇 = 한일.length ? 한일.join('·') : '생산처리';

  //  **어느 품목이 걸렸는지 이름으로 짚는다.** 주문 전체가 잠긴 것처럼 보이면
  //  멀쩡한 다른 품목까지 못 고치는 줄 알고 딴 길로 돌아간다(2026-09-14 사장님).
  if (걸린줄 && 걸린줄 !== '주문 전체') {
    return `“${걸린줄}” 은 이미 ${무엇}돼서 수량·구성을 고칠 수 없습니다.

`
      + `여기서 고치면 이미 빠진 재고·로트는 그대로 남아 장부가 갈립니다.
`
      + `그 품목의 작업완료를 풀고 고친 뒤 다시 완료해 주세요 — 그때 재고가 같이 따라옵니다.

`
      + `(비고·라벨·제조일은 지금도 고칠 수 있습니다)`;
  }
  return `이미 ${무엇}된 주문이라 품목을 고칠 수 없습니다.

`
    + `여기서 수량만 고치면 이미 빠진 재고·로트는 그대로 남아 장부가 갈립니다.
`
    + `주문 상태를 되돌린 뒤 고치고 다시 처리해 주세요 — 그때 재고가 같이 따라옵니다.`;
}
