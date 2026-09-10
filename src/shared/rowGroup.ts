/**
 * **묶은 것끼리 붙여 세우는 셈** — 배송순서와 작업순서가 같이 쓴다.
 *
 * 2026-09-09 사장님이 배송에 먼저 넣고("같이 배송 가는 애들끼리 그룹으로"),
 * 이어서 작업순서에도 달라고 했다. 두 화면은 줄의 생김새가 다르다 —
 * 배송은 주문 단위(`orderId`), 작업은 품목 단위(`key`) 다.
 *
 * **그런데 묶어 세우는 규칙은 똑같다.** 이 앱에서 제일 자주 난 사고가
 * "같은 셈이 두 벌로 갈리는 것"이라, 규칙은 여기 하나만 둔다.
 *
 * ---
 * 흩어져 있으면 "같이 간다"가 안 읽힌다. 그렇다고 묶음을 맨 앞으로 끌어올리면
 * 애써 잡은 순서가 통째로 뒤집힌다 — **첫 사람 자리에 나머지를 데려온다.**
 *
 * 부수효과 없음(입력 → 값).
 */

/** 줄에 붙는 묶음 표식 — 화면이 이걸로 이음선을 그린다 */
export interface GroupMark {
  groupId?: string;
  groupName?: string;
  /** 묶음 안에서 첫 줄·끝 줄인가 */
  groupFirst?: boolean;
  groupLast?: boolean;
}

export interface GroupOf {
  id: string;
  name?: string;
}

/**
 * @param rows 지금 늘어선 차례 그대로
 * @param idOf 줄에서 신원을 꺼내는 법 — 배송은 orderId, 작업은 key
 * @param groupOf 그 신원이 어느 묶음인가. 안 묶였으면 undefined
 */
export function clusterByGroup<T>(
  rows: readonly T[],
  idOf: (_row: T) => string,
  groupOf: (_id: string) => GroupOf | undefined,
): (T & GroupMark)[] {
  const out: (T & GroupMark)[] = [];
  const 이미 = new Set<string>();

  for (const r of rows) {
    const id = idOf(r);
    if (이미.has(id)) continue;
    const g = groupOf(id);
    //  안 묶인 줄에는 표식을 안 붙인다 — 화면이 `groupId` 있음/없음으로 이음선을 가른다
    if (!g) { out.push({ ...r } as T & GroupMark); 이미.add(id); continue; }
    //  이 묶음 사람들을 **지금 늘어선 차례 그대로** 데려온다
    const 식구 = rows.filter(x => !이미.has(idOf(x)) && groupOf(idOf(x))?.id === g.id);
    식구.forEach((x, i) => {
      out.push({ ...x, groupId: g.id, groupName: g.name, groupFirst: i === 0, groupLast: i === 식구.length - 1 });
      이미.add(idOf(x));
    });
  }
  return out;
}

/**
 * 고른 것들을 한 묶음으로. **한 사람은 한 묶음만** — 새로 묶으면 앞 묶음에서 빠지고,
 * 한 명만 남은 묶음은 묶음이 아니라 사라진다.
 */
export function addGroup<G extends { id: string; name?: string; memberIds: string[] }>(
  groups: readonly G[],
  memberIds: readonly string[],
  make: (_g: { id: string; name?: string; memberIds: string[] }) => G,
  name?: string,
  id = `g-${Date.now()}`,
): G[] {
  const 넣을것 = memberIds.filter(Boolean);
  if (넣을것.length === 0) return [...groups];
  const 남은것 = groups
    .map(g => ({ ...g, memberIds: g.memberIds.filter(x => !넣을것.includes(x)) }))
    .filter(g => g.memberIds.length > 1);
  return [...남은것, make({ id, ...(name ? { name } : {}), memberIds: [...넣을것] })];
}

/** 이 줄을 묶음에서 뺀다. 한 명만 남으면 그 묶음도 없앤다. */
export function removeFromGroups<G extends { memberIds: string[] }>(
  groups: readonly G[],
  memberId: string,
): G[] {
  return groups
    .map(g => ({ ...g, memberIds: g.memberIds.filter(x => x !== memberId) }))
    .filter(g => g.memberIds.length > 1);
}
