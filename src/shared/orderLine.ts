import type { OrderItem } from './types';

/**
 * **주문 품목 줄의 이름표** — 같은 품목이 한 주문에 두 줄이면 `-1`, `-2` 로 가른다.
 *
 * 2026-09-09 사장님: "같은 품목 주문이 한 주문에 두개면 주문쪽에서 -1, -2 로 넘버링하게
 * 만들고 지금 금일작업순서도 그걸로 받아서 쓰게 해".
 *
 * 작업순서 줄은 담을 때 찍어 둔 **사본**이라 주문 줄을 되찾을 이름이 필요하다.
 * **자리(몇 번째)는 못 쓴다** — 앞 품목을 지우면 뒤가 당겨져 엉뚱한 품목을 가리킨다.
 * 품목 id 는 안 밀리지만, 같은 품목이 두 줄이면 둘을 못 가른다. 그래서 **번째를 붙인다.**
 *
 * ---
 * **번호는 이 주문 안에서만 뜻이 있다.** 그리고 **같은 품목끼리만** 센다 —
 * 주문 전체의 몇 번째가 아니라 "이 품목의 몇 번째"다. 그래야 다른 품목을 지워도 안 밀린다.
 *
 *     [참기름, 들기름, 참기름]  →  참기름-1 · 들기름-1 · 참기름-2
 *     들기름을 지워도            →  참기름-1 ·           참기름-2   (그대로다)
 *
 * 부수효과 없음(입력 → 값).
 */

/** 이름표를 잇는 글자. 품목 id 에 안 나오는 것이라야 되찾을 때 안 헷갈린다. */
const SEP = '#';

type Line = Pick<OrderItem, 'itemId'>;

/** 그 자리 줄이 **그 품목의 몇 번째**인가 (1부터). 품목 id 가 없으면 0. */
export function lineOrdinal(items: readonly Line[] | undefined, idx: number): number {
  const id = items?.[idx]?.itemId;
  if (!id) return 0;
  let n = 0;
  for (let i = 0; i <= idx && i < items!.length; i++) if (items![i]?.itemId === id) n++;
  return n;
}

/** 그 품목이 이 주문에 몇 줄인가 */
export function lineCount(items: readonly Line[] | undefined, itemId: string | undefined): number {
  if (!itemId) return 0;
  return (items ?? []).filter(i => i.itemId === itemId).length;
}

/**
 * 그 자리 줄의 이름표 — `p-107` 또는 `p-107#2`.
 * **한 줄뿐이면 번째를 안 붙인다** — 대부분이 그렇고, 안 붙는 쪽이 읽기 쉽다.
 */
export function lineKeyAt(items: readonly Line[] | undefined, idx: number): string {
  const id = items?.[idx]?.itemId;
  if (!id) return '';
  return lineCount(items, id) > 1 ? `${id}${SEP}${lineOrdinal(items, idx)}` : id;
}

/**
 * 이름표로 줄을 되찾는다. 없으면 `-1`.
 *
 * **번째가 붙은 이름표가 안 걸리면 그 품목의 아무 줄로 물러서지 않는다** —
 * 두 줄 중 하나를 지웠을 때 남은 줄에 체크가 옮겨 붙으면 안 된다. 못 찾으면 못 찾은 것이다.
 */
export function findLineIndex(items: readonly Line[] | undefined, lineKey: string | undefined): number {
  if (!lineKey) return -1;
  const list = items ?? [];
  const at = lineKey.indexOf(SEP);
  if (at < 0) {
    //  번째가 없는 이름표 = "한 줄뿐이던 품목". 지금 여러 줄이면 첫 줄로 본다(같은 품목이라 해롭지 않다).
    return list.findIndex(i => i.itemId === lineKey);
  }
  const id = lineKey.slice(0, at);
  const n = Number(lineKey.slice(at + SEP.length));
  if (!id || !Number.isFinite(n) || n < 1) return -1;
  let 센다 = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.itemId !== id) continue;
    if (++센다 === n) return i;
  }
  return -1;
}

/**
 * 화면에 붙일 꼬리표 — `-2`. 한 줄뿐이면 빈 글.
 * 주문카드와 작업순서가 **같은 글자**를 보여야 사장님이 둘을 짝지어 볼 수 있다.
 */
export function lineSuffix(items: readonly Line[] | undefined, idx: number): string {
  const id = items?.[idx]?.itemId;
  if (!id || lineCount(items, id) < 2) return '';
  return `-${lineOrdinal(items, idx)}`;
}
