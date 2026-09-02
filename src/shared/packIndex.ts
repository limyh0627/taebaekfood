/**
 * **포장 환산표 — "이 낱개 품목은 한 박스에 몇 개 드나".**
 *
 * 박스를 **별개 품목으로 두는 것**(볶음참깨/1kg 10개입)과는 다른 이야기다.
 * 그쪽은 박스째 쌓아 두고 박스로 세니 재고가 따로 있어야 하고, 겉박스·테이프까지
 * BOM에 달고 있다. 개입수는 그 BOM이 말한다(`unpackComponent`).
 *
 * 향미유·고춧가루는 그게 아니다. **박스로 쌓아 두지 않고 낱개로만 센다.**
 * "3박스"는 거래처와 말하는 방식일 뿐이라 재고 사실이 아니다.
 * 그런 품목의 개입수를 담을 자리가 없어서, 지금까지 코드에 `향미유면 12`로 박혀 있었다.
 * 박스 품목 140개 중 102개가 12개입이 아닌데도 그랬다.
 *
 * 그래서 표로 뺀다. 품목 id 와 개입수 두 칸이면 된다.
 *
 *   item_pack   { item_id, units_per_box }
 *
 * ---
 * **왜 품목 문서에 필드를 안 넣나** — 필드로 두면 전 품목(525개)이 그 칸을 갖게 되고,
 * 실제로 쓰는 건 아홉이다. 그리고 `boxSize`가 이미 그렇게 들어와서 지금 뜻이 흐려져 있다
 * (재고 단위인지 포장 단위인지 이름이 말을 안 한다). 표로 두면 **줄이 있는 품목만**
 * 박스로 주문할 수 있다는 게 그 자체로 규칙이 된다.
 *
 * 레지스트리로 두는 이유는 `bomIndex`와 같다 — `unitsPerBoxOf(product)`가 여러 곳에서
 * 품목 하나만 받아 불리는데, 거기에 표를 인자로 흘리면 그 시그니처가 전부 바뀐다.
 */
export interface PackRow {
  item_id: string;
  units_per_box?: number;
}

export interface PackIndex {
  /** 개입수. 없으면 0 = 박스로 안 판다. */
  of: (_itemId: string) => number;
  size: number;
}

const EMPTY: PackIndex = { of: () => 0, size: 0 };

export function buildPackIndex(rows: PackRow[] = []): PackIndex {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r?.item_id) continue;
    const n = Number(r.units_per_box);
    //  1은 안 담는다 — "한 박스에 한 개"는 박스가 아니다
    if (!Number.isFinite(n) || n <= 1) continue;
    m.set(r.item_id, n);
  }
  return { of: (id: string) => m.get(id) ?? 0, size: m.size };
}

let current: PackIndex = EMPTY;

export function setPackIndex(next: PackIndex): void {
  current = next;
}

/** 이 품목의 개입수. 표에 없으면 0(로딩 전도 0 — 품목 목록이 비어 있는 것과 같은 상태). */
export function packUnitsOf(itemId: string | undefined): number {
  return itemId ? current.of(itemId) : 0;
}

/** 테스트·초기화용 */
export function resetPackIndex(): void {
  current = EMPTY;
}
