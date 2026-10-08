import type { CompanyId } from './rawLot';
import { baseRawName, RM_LIST } from './formula';

export type RawHolderItem = { id: string; name: string; companyId?: CompanyId; subtype?: string;
  phantom?: boolean; archived?: boolean; rawMaterialName?: string };
export const isRawHolder = (item: RawHolderItem | undefined): boolean =>
  !!item && String(item.subtype ?? '') === '벌크' && !item.phantom && !item.archived;
const companyOf = (item: RawHolderItem): CompanyId => item.companyId ?? 'taebaek';

export function rawHolderById<T extends RawHolderItem>(allItems: readonly T[], rawItemId: string | undefined,
  companyId?: CompanyId): T | undefined {
  if (!rawItemId) return undefined;
  const hit = allItems.find(item => item.id === rawItemId);
  if (!hit || !isRawHolder(hit)) return undefined;
  if (companyId && companyOf(hit) !== companyId) return undefined;
  return hit;
}
export function rawHolderByName<T extends RawHolderItem>(allItems: readonly T[], material: string,
  companyId?: CompanyId): T | undefined {
  const want = baseRawName(material ?? '');
  if (!want) return undefined;
  const holders = allItems.filter(item => isRawHolder(item) && baseRawName(item.name ?? '') === want);
  if (!holders.length) return undefined;
  if (companyId) return holders.find(item => companyOf(item) === companyId);
  const taebaek = holders.find(item => companyOf(item) === 'taebaek');
  if (taebaek) return taebaek;
  return holders.length === 1 ? holders[0] : undefined;
}
export function resolveRawHolder<T extends RawHolderItem>(allItems: readonly T[],
  { rawItemId, material, companyId }: { rawItemId?: string; material?: string; companyId?: CompanyId }): T | undefined {
  return rawHolderById(allItems, rawItemId, companyId)
    ?? (material ? rawHolderByName(allItems, material, companyId) : undefined);
}
export const rawLedgerKeys = (holder: RawHolderItem): { companyId: CompanyId; rawItemId: string } => ({
  companyId: companyOf(holder), rawItemId: holder.id,
});

export function rawLotTarget<T extends RawHolderItem>(allItems: T[], product: T | undefined,
  itemName: string, companyId?: CompanyId): { baseName: string; rawItem: T } | null {
  const baseName = product?.rawMaterialName || baseRawName(itemName);
  if (!RM_LIST.includes(baseName)) return null;
  const rawItem = rawHolderByName(allItems, baseName, companyId)
    ?? (product && companyId == null && isRawHolder(product) ? product : undefined);
  return rawItem ? { baseName, rawItem } : null;
}
