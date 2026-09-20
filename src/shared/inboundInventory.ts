import { CATEGORY_MIGRATION_MAP, type Item } from './types';
import { TYPE_KEYS, type TypeKey } from './itemTaxonomy';

const 입고재고타입 = new Set<TypeKey>(TYPE_KEYS);

/** 매입전표 줄 중 현재 기준으로 입고대기 확인을 물을 실물 재고 품목인가. */
export function isInboundInventoryItem(item: Pick<Item, 'type' | 'subtype'> | undefined): boolean {
  if (!item || item.subtype === '배송') return false;
  const oldOrNewType = String(item.type ?? '').trim();
  const normalized = CATEGORY_MIGRATION_MAP[oldOrNewType] ?? oldOrNewType;
  return 입고재고타입.has(normalized as TypeKey);
}

export function hasInboundInventoryLines(
  lines: readonly { itemId?: string }[],
  items: readonly Item[],
): boolean {
  const byId = new Map(items.map(item => [item.id, item]));
  return lines.some(line => isInboundInventoryItem(line.itemId ? byId.get(line.itemId) : undefined));
}
