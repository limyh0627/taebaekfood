import type { Item } from './types';

/**
 * BOM 단일 원천 = `item_bom` 컬렉션. **품목은 제 구성을 안 들고 다닌다.**
 *
 * 예전엔 로딩 때 item_bom을 `Item.submaterials`로 펴서 품목에 붙였다(bomSource).
 * 읽는 40여 곳을 안 건드리려는 어댑터였는데, 그 그림자 필드가 세 가지를 망가뜨렸다:
 *
 *   · `SubmaterialComponent.category`에 자식의 **type**('submaterial')이 들어갔다.
 *     용기·마개·라벨을 카테고리로 거르던 화면 네 곳이 조용히 아무것도 못 걸렀다.
 *   · BOM 수량이 `stock` 칸에 담겼다. 이름이 뜻과 다르니 읽는 사람마다 다르게 짚었다.
 *   · 같은 사실이 두 곳(item_bom · Item.submaterials)에 있어 어느 쪽이 참인지 늘 물어야 했다.
 *
 * 이제 구성은 여기서만 읽는다. 자식 품목이 줄에 붙어 오므로 type·category·name이
 * 언제나 제 값이다.
 */

/** BOM 한 줄 — 부모 1단위에 자식이 얼마나 들어가나. */
export interface BomLine {
  childId: string;
  /**
   * 자식이 벌크(subtype='벌크')면 **용량**(kg·L), 아니면 **개수**.
   * 뜻을 정하는 건 자식 품목이다 — isBulkItem(child) 참고.
   */
  qty: number;
  /** 자식 품목. 지워진 품목을 가리키는 줄이면 undefined다. */
  child?: Item;
}

/**
 * 편집 화면이 저장하려고 들고 있는 구성 초안.
 *
 * 품목 문서에 **안 들어간다** — 저장 핸들러가 이걸 보고 item_bom을 다시 쓰고 버린다.
 * `undefined`면 "구성은 안 건드린다"는 뜻이다(구성 편집이 없는 화면에서 온 저장).
 */
export interface BomDraftLine {
  childId: string;
  qty: number;
}

/** 역방향 한 줄 — 이 품목을 물고 있는 부모. */
export interface BomParentLine {
  parentId: string;
  qty: number;
  parent?: Item;
}

export interface BomIndex {
  /** 이 품목의 구성. 없으면 빈 배열. */
  of(parentId: string): BomLine[];
  /** 이 품목을 구성품으로 쓰는 부모들 — 낱개에 물린 박스를 되짚을 때. */
  parentsOf(childId: string): BomParentLine[];
}

const EMPTY: BomIndex = { of: () => [], parentsOf: () => [] };

const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
  const arr = m.get(k);
  if (arr) arr.push(v); else m.set(k, [v]);
};

export function buildBomIndex(
  items: Item[],
  //  quantity가 빈 옛 줄이 있어 선택으로 받는다 — 없으면 1로 본다.
  itemBoms: { parent_id: string; child_id: string; quantity?: number }[],
): BomIndex {
  const byId = new Map(items.map(i => [i.id, i]));
  const children = new Map<string, BomLine[]>();
  const parents = new Map<string, BomParentLine[]>();
  for (const b of itemBoms) {
    if (!b?.parent_id || !b?.child_id) continue;
    const qty = typeof b.quantity === 'number' ? b.quantity : 1;
    push(children, b.parent_id, { childId: b.child_id, qty, child: byId.get(b.child_id) });
    push(parents, b.child_id, { parentId: b.parent_id, qty, parent: byId.get(b.parent_id) });
  }
  return {
    of: (parentId) => children.get(parentId) ?? [],
    parentsOf: (childId) => parents.get(childId) ?? [],
  };
}

/**
 * 앱이 지금 보고 있는 BOM.
 *
 * 레지스트리로 둔 이유 — `unpackComponent(product)`처럼 **품목 하나만 받는** 판정이
 * 45곳에서 불린다. 거기에 인덱스를 인자로 흘리면 그 45곳의 시그니처가 전부 바뀌고,
 * 재고차감·원가 같은 계산 경로가 배선 실수로 조용히 어긋날 자리가 그만큼 생긴다.
 * 원천이 하나뿐인 앱이라(useAppData가 item_bom을 한 번 읽는다) 여기 한 곳에 세운다.
 *
 * 테스트는 `setBomIndex(buildBomIndex(items, boms))`로 직접 세운다.
 */
let current: BomIndex = EMPTY;

export function setBomIndex(next: BomIndex): void {
  current = next;
}

/** 이 품목의 구성. 로딩 전이면 빈 배열이다(품목 목록이 비어 있는 것과 같은 상태). */
export function bomOf(parentId: string | undefined): BomLine[] {
  return parentId ? current.of(parentId) : [];
}

/** 이 품목을 물고 있는 부모들. */
export function bomParentsOf(childId: string | undefined): BomParentLine[] {
  return childId ? current.parentsOf(childId) : [];
}

/** 테스트·초기화용 — 비운다. */
export function resetBomIndex(): void {
  current = EMPTY;
}

/**
 * **챙길 부자재만** — 그 품목을 포장할 때 실제로 집어야 하는 것들.
 *
 * BOM 에는 내용물(반제품·원료·완제품)도 같이 들어 있는데 그건 통에서 나오는 것이지
 * 챙길 물건이 아니다. 벌크와 팬텀(원료배합 반제품)도 뺀다.
 *
 * 세 화면이 이 판정을 따로 적고 있었다(2026-09-05) —
 * AddOrderModal · ItemList · ItemManager. 갈리면 **같은 품목의 포장 목록이
 * 화면마다 달라진다.**
 *
 * @param isBulk 벌크인지 가리는 함수 — [itemTaxonomy](itemTaxonomy.ts) 의 `isBulkItem`
 */
export function packingSubmaterials(
  parentId: string | undefined,
  isBulk: (i: { subtype?: string; type?: string }) => boolean,
): BomLine['child'][] {
  return bomOf(parentId)
    .map(l => l.child)
    .filter((c): c is NonNullable<BomLine['child']> =>
      !!c && c.type === 'submaterial' && !isBulk(c) && !(c as { phantom?: boolean }).phantom);
}
