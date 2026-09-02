import type { Item } from './types';
import { boxSiblings } from './orderUnits';

/**
 * **박스 품목의 규격은 낱개 규격을 따라 적는 것이다.**
 *
 *   낱개 `들기름/…/350ml`  규격 `350ml`
 *   박스 `들기름/…/350ml`  규격 `350ml * 20`      ← 낱개 규격 + BOM 개입수
 *
 * 그런데 **낱개 규격을 고쳐도 박스가 안 따라갔다.** 규격을 다시 만드는 코드가 품목
 * 편집창의 '개입수' 칸 안에만 있어서, 그 칸을 손으로 건드릴 때만 돌았다.
 * 낱개 용량을 300ml → 350ml 로 고쳐도 박스는 `300ml * 20` 그대로 남았다.
 * 편집창은 위 칸에 낱개에서 가져온 350ml 을, 아래엔 저장된 300ml 을 나란히 띄우면서도
 * 저장 때 맞추지 않았다.
 *
 * 그래서 **낱개를 저장할 때 그 낱개를 문 박스들을 같이 고친다.** 전파는 여기 한 곳에 있다.
 *
 * ---
 * 개입수 자체의 근거는 여전히 BOM 이다(`unpackComponent`). 규격 글자는 사람이 읽는 것이고,
 * 코드가 개입수를 셀 때는 BOM 을 본다. 그래도 글자가 어긋나 있으면 화면에서 다른 박스와
 * 달라 보이고, 무엇이 맞는지 사람이 못 믿게 된다.
 */

/** 규격에서 개입수 꼬리(` * 20`)를 뗀다 — 낱개 쪽 용량만 남긴다 */
export function specBase(spec?: string): string {
  return String(spec ?? '').replace(/\s*[*x×].*$/i, '').trim();
}

/** 낱개 규격 + 개입수 → 박스 규격. 낱개 규격이 없으면 만들 수 없다(빈 문자열). */
export function boxSpecOf(looseSpec: string | undefined, count: number): string {
  const base = specBase(looseSpec);
  if (!base) return '';
  return count > 1 ? `${base} * ${count}` : base;
}

/**
 * **이 낱개를 문 박스들 중 규격이 어긋난 것.**
 *
 * @param loose 방금 저장한 낱개 품목(고친 규격이 담긴 것)
 * @param all   전 품목 — 박스를 되찾는 데 쓴다
 * @returns 고쳐야 할 것만. 이미 맞는 박스는 안 담는다.
 */
export function boxSpecUpdates(
  loose: Pick<Item, 'id' | 'spec'>,
  all: Item[],
): { id: string; name?: string; from?: string; spec: string }[] {
  const out: { id: string; name?: string; from?: string; spec: string }[] = [];
  for (const { item, count } of boxSiblings(loose, all)) {
    const want = boxSpecOf(loose.spec, count);
    //  만들 수 없으면(낱개 규격이 비었다) 손대지 않는다 — 있는 글자를 지우면 더 나쁘다
    if (!want) continue;
    if (String(item.spec ?? '').trim() === want) continue;
    out.push({ id: item.id, name: item.name, from: item.spec, spec: want });
  }
  return out;
}
