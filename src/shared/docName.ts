import type { Item } from './types';

/**
 * **서류용 품목명 — 이 앱에서 품목 이름은 둘이다.**
 *
 *   실제 이름 `name`   「참기름/골드/대왕/1800ml」  거래처·병 모양까지 붙는다
 *   서류용 이름 `품목`  「시골향참기름1」            뭉뚱그린 이름
 *
 * 서류용 이름을 쓰는 자리:
 *   - **원료식 열쇠** (`item_formula.parent_key`) — 원료를 얼마나 빼야 하는지가 여기 달렸다
 *   - **원료수불부 · 생산작업기록부** — 관청에 내는 서류
 *   - **전표 인쇄** (2026-09-06 사장님) — 서류끼리 이름이 갈리면 대조가 안 된다
 *
 * `품목 || name` 이 **여덟 군데에 손으로 적혀 있었다**(2026-09-06) — AddItemModal 2곳,
 * BomIntegrityPanel 2곳, ProductionManager, AdminApp 2곳, oemEngine. 전표 인쇄를 붙이며
 * 아홉 번째를 적을 뻔했다. 이 규칙이 갈리면 **원료가 조용히 안 빠진다** — 열쇠가 안 맞아
 * 원료식을 못 찾으면 그냥 빈 목록이라 화면에 아무 표시가 안 난다.
 *
 * 서류용 이름이 없으면 실제 이름을 쓴다 — 부자재·박스처럼 서류에 안 나가는 것들이다.
 */
export const docName = (item: { 품목?: string; name?: string } | undefined): string =>
  (item?.품목 ?? '').trim() || (item?.name ?? '');

/**
 * 실제 이름(+규격)으로 품목을 찾아 **서류용 이름**을 낸다 — 전표 인쇄처럼 품목 객체가
 * 아니라 줄에 적힌 글자만 들고 있을 때 쓴다. 못 찾으면 적힌 글자를 그대로 돌려준다.
 */
export function docNameOf(
  name: string,
  spec: string | undefined,
  allItems: readonly Item[],
): string {
  const 후보 = allItems.filter(p => !p.archived && p.name === name);
  //  같은 이름이 규격만 다르게 여럿 있다 — 규격까지 맞는 것을 먼저 본다.
  const hit = 후보.find(p => (p.spec ?? '') === (spec ?? '')) ?? 후보[0];
  return hit ? docName(hit) : name;
}

/** 서류용 이름으로 품목을 거꾸로 찾는다 — 저장된 전표 줄이 서류용 이름으로 적혀 있을 때. */
export const findByDocName = (allItems: readonly Item[], name: string): Item | undefined =>
  allItems.find(p => docName(p) === name);

/** 인쇄용 줄 — 전표 줄이든 저장된 전표 줄이든 이 모양만 본다. */
interface PrintableLine { name?: string; spec?: string }

/**
 * 인쇄 직전에 이름을 서류용으로 바꾼다. **바꾸기만 한다.**
 *
 * 서류용 이름은 20가지뿐인데 완제품은 178개라, 한 장에 똑같아 보이는 줄이 둘 나올 수 있다
 * (「시골향들기름/병/350ml」과 「시골향들기름/병/특/350ml」이 둘 다 “시골향들기름2 350ml”).
 * **겹쳐도 그대로 둔다**(2026-09-06 사장님) — 줄을 합치면 수량·금액을 손대게 되고,
 * 그러면 전표 합계가 화면과 어긋날 수 있다. 이름만 바꾸면 숫자는 하나도 안 건드린다.
 */
export function withDocNames<T extends PrintableLine>(
  lines: readonly T[],
  allItems: readonly Item[],
): T[] {
  return lines.map(l => ({ ...l, name: docNameOf(l.name ?? '', l.spec, allItems) }));
}
