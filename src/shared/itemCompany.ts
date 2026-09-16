import { companyOf, type CompanyId, type Item, type ItemBom } from './types';

/** 품목 목록은 재고를 들고 있는 회사 기준으로 가른다. 옛 품목은 companyOf 규칙상 태백이다. */
export const itemsOfCompany = (items: readonly Item[], companyId: CompanyId): Item[] =>
  items.filter(item => companyOf(item) === companyId);

export interface CrossCompanyBom {
  bomId: string;
  parentId: string;
  childId: string;
  parentCompanyId: CompanyId;
  childCompanyId: CompanyId;
}

/** 서로 다른 회사 품목을 잇는 BOM은 생산 때 남의 창고 재고를 차감하므로 저장하면 안 된다. */
export function crossCompanyBoms(
  boms: readonly Pick<ItemBom, 'id' | 'parent_id' | 'child_id'>[],
  items: readonly Item[],
): CrossCompanyBom[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return boms.flatMap(bom => {
    const parent = byId.get(bom.parent_id);
    const child = byId.get(bom.child_id);
    if (!parent || !child) return [];
    const parentCompanyId = companyOf(parent);
    const childCompanyId = companyOf(child);
    return parentCompanyId === childCompanyId ? [] : [{
      bomId: bom.id,
      parentId: parent.id,
      childId: child.id,
      parentCompanyId,
      childCompanyId,
    }];
  });
}
