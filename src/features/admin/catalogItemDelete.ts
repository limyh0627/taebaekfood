import type { Item, ItemBom, PartnerItem } from '../../shared/types';

export interface CatalogItemDeletePlan {
  bomIds: string[];
  partnerItemIds: string[];
  parentNames: string[];
  ownBomCount: number;
  subMessage: string;
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
