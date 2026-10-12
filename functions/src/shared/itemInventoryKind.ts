export interface InventoryKindItem { type?: string; unit?: string; subtype?: string; rawMaterialName?: string; density?: number }
const bulkUnits = new Set(['kg', 'KG', 'L', 'l', '리터', 'ℓ']);
/** 생산에서 개수 재고로 보는 기존 판정은 상품 로트 지원 때문에 넓히지 않는다. */
export const holdsUnitStockPure = (item: InventoryKindItem | undefined): boolean =>
  !!item && String(item.subtype ?? '') !== '벌크'
  && !bulkUnits.has(String(item.unit ?? '').trim())
  && (item.type === 'product' || item.type === 'wip');
/** 상품의 자기 SKU 수량을 추적한다. 명시 원료 별칭·벌크·부자재는 다른 재고 경계를 유지한다. */
export const tracksQuantityLots = (item: InventoryKindItem | undefined): boolean =>
  holdsUnitStockPure(item) || !!item && item.type === 'goods'
  && String(item.subtype ?? '') !== '벌크' && !String(item.rawMaterialName ?? '').trim();
/** kg/L 상품은 포장 규격 대신 재고 단위·등록 밀도를 쓴다. 입고 수량 자체는 바꾸지 않는다. */
export function quantityLotUnitKg(item:InventoryKindItem|undefined,existingKg:number):number{
 if(item?.type!=='goods'||!tracksQuantityLots(item))return existingKg;
 const unit=String(item.unit??'').trim().toLowerCase();
 if(unit==='kg')return 1;
 if(['l','리터','ℓ'].includes(unit))return typeof item.density==='number'&&Number.isFinite(item.density)&&item.density>0?item.density:0;
 return existingKg;
}
