import { Item, ItemBom, SubmaterialComponent } from './types';

/**
 * BOM 단일 원천 = `item_bom` 컬렉션.
 *
 * 지금은 품목 구성이 두 군데로 쪼개져 있다: `item.submaterials`(박스 구성 등)와
 * `item_bom`(제품→부자재 일부). 이 모듈은 **item_bom을 유일 원천**으로 삼아,
 * 기존 코드가 기대하는 `submaterials` 배열 모양으로 파생해준다.
 *
 * 이렇게 하면 submaterials를 읽는 33곳을 안 건드리고도 원천을 item_bom으로 옮길 수 있다.
 * (주입은 데이터 이관이 끝난 뒤에 한다 — item_bom이 완전해야 submaterials가 비지 않는다.)
 *
 * 파생 규칙: item_bom {parent_id, child_id, quantity} + 자식 품목 정보 →
 *   SubmaterialComponent { id, name, category, stock:quantity, unit, spec, cost, boxSize }
 * category는 **자식 품목의 category**를 그대로 쓴다. unpackComponent가 'product' 필터로
 * 낱개를 골라내는데, 자식이 완제품이면 category='product'라 그대로 걸린다(카톤·부자재는 제외).
 */
export function buildSubmaterialsFromBom(
  items: Pick<Item, 'id' | 'name' | 'category' | 'spec' | 'unit' | 'cost' | 'boxSize'>[],
  itemBoms: ItemBom[],
): Map<string, SubmaterialComponent[]> {
  const byId = new Map(items.map(i => [i.id, i]));
  const out = new Map<string, SubmaterialComponent[]>();
  for (const b of itemBoms) {
    if (!b?.parent_id || !b?.child_id) continue;
    const child = byId.get(b.child_id);
    const sub: SubmaterialComponent = {
      id: b.child_id,
      name: child?.name ?? b.child_id,
      category: child?.category ?? 'submaterial',
      stock: b.quantity ?? 1,            // stock = BOM 개입수(bomQty가 읽는 자리)
      unit: (child as any)?.unit ?? '개',
      ...(child?.spec != null ? { spec: child.spec } : {}),
      ...(child?.cost != null ? { cost: child.cost } : {}),
      ...((child as any)?.boxSize != null ? { boxSize: (child as any).boxSize } : {}),
    };
    if (!out.has(b.parent_id)) out.set(b.parent_id, []);
    out.get(b.parent_id)!.push(sub);
  }
  return out;
}

/**
 * items 각 품목의 `submaterials`를 item_bom 파생값으로 교체한 새 배열을 반환한다.
 * 로딩 직후 한 번 감싸면, 이후 submaterials를 읽는 코드는 자동으로 item_bom을 본다.
 * ⚠️ item_bom 이관이 끝난 뒤에만 주입할 것(안 그러면 박스 구성이 빈다).
 */
export function withDerivedSubmaterials<T extends Item>(items: T[], itemBoms: ItemBom[]): T[] {
  const map = buildSubmaterialsFromBom(items, itemBoms);
  return items.map(i => ({ ...i, submaterials: map.get(i.id) ?? [] }));
}
