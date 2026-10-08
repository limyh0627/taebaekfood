import { rawLotTarget, type RawHolderItem } from './rawHolder';
import type { CompanyId } from './rawLot';
type Item = RawHolderItem & { type?: string; unit?: string; lots?: unknown[] };
/** 접수 화면과 서버는 같은 실물 처리 경로를 선택한다. */
export function returnStockKind(companyId: CompanyId, item: Item, allItems: Item[]): 'unit' | 'raw' | 'general' | 'unsupported' {
  if ((item.companyId ?? 'taebaek') !== companyId || (item.lots !== undefined && !Array.isArray(item.lots))) return 'unsupported';
  if (['product', 'wip'].includes(item.type ?? '') && item.subtype !== '벌크'
    && !['kg', 'KG', 'L', 'l', '리터', 'ℓ'].includes(String(item.unit ?? '').trim())) return 'unit';
  if (rawLotTarget(allItems, item, item.name, companyId)) return 'raw';
  return ['goods', 'submaterial'].includes(item.type ?? '') && item.subtype !== '벌크'
    && !item.rawMaterialName && !(item.lots?.length) ? 'general' : 'unsupported';
}
