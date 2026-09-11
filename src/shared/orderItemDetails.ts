import type { Item, OrderItem } from './types';
import { bomOf } from './bomIndex';
import { isBulkItem } from './itemTaxonomy';

/** 이름·규격이 같은 별개 SKU를 대신 찾지 않는다. 주문의 ID와 현재 BOM만 표시 근거다. */
export function orderItemDetails(orderItem: OrderItem, items: readonly Item[]) {
  const direct = items.find(item => item.id === orderItem.itemId && !item.archived);
  const isManufacturing = (item: Item) => ['product', 'goods', 'wip'].includes(item.type) && !isBulkItem(item);
  const rows = bomOf(orderItem.itemId).filter(row => row.child && !row.child.archived);
  const manufacturingRows = rows.filter(row => isManufacturing(row.child!));
  const manufacturing = manufacturingRows.map(row => row.child!.name);
  if (!manufacturing.length && direct && isManufacturing(direct)) manufacturing.push(direct.name);
  const components = [...rows, ...manufacturingRows.flatMap(row => bomOf(row.childId))]
    .flatMap(row => row.child && !row.child.archived ? [row.child] : []);
  const byCategory = (categories: string[]) => [...new Set(components
    .filter(item => item.type === 'submaterial' && categories.includes(item.category || ''))
    .map(item => item.name))];
  return {
    manufacturing,
    bottles: byCategory(['용기', '병']),
    caps: byCategory(['마개', '뚜껑', 'Cap']),
    labels: byCategory(['라벨', '띠지']),
    packaging: byCategory(['박스', '테이프', 'Tape']),
  };
}
