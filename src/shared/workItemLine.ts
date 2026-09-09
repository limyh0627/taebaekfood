import type { Order } from './types';

/**
 * **작업순서 줄 → 그 주문의 몇 번째 품목인가.**
 *
 * 2026-09-09 사장님: "지금 주문 카드에는 한줄별로 체크박스가 달려있잖아 그거 그대로 쓰면
 * 되는거 아니야?" — 맞다. 작업순서 줄은 **곧 주문의 품목 줄**이라 체크 상태를 새로 만들
 * 이유가 없다. `order.items[i].checked` 를 그대로 쓰면 한 쪽에서 체크한 게 주문카드에도 뜬다.
 *
 * 그러려면 줄에서 **품목 번호**를 되찾아야 한다. 작업순서 줄의 열쇠는 `주문id-번호` 다
 * (`ORD-1788768673611-3`). 주문 id 안에도 `-` 가 있으니 **마지막 `-` 뒤**가 번호다.
 *
 * ---
 * **번호만 믿지 않는다.** 줄은 Firestore 에 저장돼 있는데 그 사이 주문 품목이 지워지거나
 * 순서가 바뀌면 번호가 다른 품목을 가리킨다 — 그러면 **엉뚱한 줄에 체크가 찍힌다.**
 * 그래서 번호 자리의 품목이 이 줄의 품목이 맞는지 보고, 아니면 품목 id 로 다시 찾는다.
 *
 * 못 찾으면 `-1`. 부르는 쪽은 체크칸을 안 그린다.
 *
 * 부수효과 없음(입력 → 값).
 */
export function itemIndexOf(
  wi: { key?: string; itemId?: string },
  order: Order | undefined,
): number {
  const items = order?.items ?? [];
  if (items.length === 0) return -1;

  const key = String(wi.key ?? '');
  const 꼬리 = key.slice(key.lastIndexOf('-') + 1);
  const n = /^\d+$/.test(꼬리) ? Number(꼬리) : -1;
  //  번호 자리에 이 줄의 품목이 그대로 있으면 그게 맞다
  if (n >= 0 && n < items.length && (!wi.itemId || items[n]?.itemId === wi.itemId)) return n;
  //  어긋났으면 품목 id 로 다시 찾는다 — 없으면 -1
  return wi.itemId ? items.findIndex(i => i.itemId === wi.itemId) : -1;
}

/** 이 작업순서 줄이 체크돼 있나 */
export const isLineChecked = (
  wi: { key?: string; itemId?: string },
  order: Order | undefined,
): boolean => {
  const i = itemIndexOf(wi, order);
  return i >= 0 && !!order?.items?.[i]?.checked;
};
