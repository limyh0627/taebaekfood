import { OrderStatus, type Item, type ItemBom, type Order, type PartnerItem } from '../../shared/types';
import { statusLabel } from '../../shared/orderStatusStyle';

export const CATALOG_DELETE_BLOCKING_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.PROCESSING,
  OrderStatus.DISPATCHED,
  OrderStatus.SHIPPED,
  OrderStatus.ON_HOLD,
] as const;

export interface CatalogItemDeleteBlocker {
  id: string;
  partnerName: string;
  status: OrderStatus;
}

export interface CatalogItemDeletePlan {
  bomIds: string[];
  partnerItemIds: string[];
  parentNames: string[];
  ownBomCount: number;
  subMessage: string;
}

/** 과거 주문은 당시 스냅샷으로 남기고, 다시 움직일 수 있는 주문만 품목 삭제를 막는다. */
export function catalogItemDeleteBlockers(
  itemId: string,
  orders: readonly Order[],
): CatalogItemDeleteBlocker[] {
  return orders
    .filter(order => CATALOG_DELETE_BLOCKING_STATUSES.includes(order.status as typeof CATALOG_DELETE_BLOCKING_STATUSES[number]))
    .filter(order => order.items?.some(line => line.itemId === itemId))
    .map(order => ({ id: order.id, partnerName: order.partnerName || '거래처 미지정', status: order.status }));
}

export function catalogItemDeleteBlockMessage(
  itemName: string,
  blockers: readonly CatalogItemDeleteBlocker[],
): string {
  const shown = blockers.slice(0, 8)
    .map(order => `• ${order.id} · ${order.partnerName} · ${statusLabel(order.status)}`)
    .join('\n');
  const rest = blockers.length > 8 ? `\n외 ${blockers.length - 8}건` : '';
  return `“${itemName}” 품목은 진행 중 주문 ${blockers.length}건에 포함돼 있어 삭제할 수 없습니다.\n\n${shown}${rest}`;
}

/** 품목 삭제 전에 함께 지울 현재 기준정보와 작업자가 볼 경고문을 한 번에 만든다. */
export function planCatalogItemDelete(
  itemId: string,
  items: readonly Item[],
  itemBoms: readonly ItemBom[],
  partnerItems: readonly PartnerItem[],
): CatalogItemDeletePlan {
  const relatedBoms = itemBoms.filter(row => row.parent_id === itemId || row.child_id === itemId);
  const itemNameById = new Map(items.map(item => [item.id, item.name]));
  const parentNames = [...new Set(itemBoms
    .filter(row => row.child_id === itemId && row.parent_id !== itemId)
    .map(row => itemNameById.get(row.parent_id) ?? row.parent_id))];
  const ownBomCount = itemBoms.filter(row => row.parent_id === itemId).length;
  const shownParents = parentNames.slice(0, 5).join(', ')
    + (parentNames.length > 5 ? ` 외 ${parentNames.length - 5}개` : '');
  const notices = [
    ...(parentNames.length > 0
      ? [`이 품목은 ${shownParents}의 BOM에 포함돼 있습니다. 삭제하면 해당 BOM에서 자동 제거됩니다.`]
      : []),
    ...(ownBomCount > 0 ? [`이 품목 자체의 BOM ${ownBomCount}줄도 함께 삭제됩니다.`] : []),
    '삭제 후 복구할 수 없습니다.',
  ];

  return {
    bomIds: [...new Set(relatedBoms.map(row => row.id))],
    partnerItemIds: [...new Set(partnerItems.filter(row => row.itemId === itemId).map(row => row.id))],
    parentNames,
    ownBomCount,
    subMessage: notices.join('\n'),
  };
}
