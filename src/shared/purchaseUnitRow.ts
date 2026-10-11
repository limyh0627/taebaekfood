import type { PurchaseUnitSnapshot, ItemPurchaseUnit, CompanyId } from './types';
import { readPurchaseUnitSnapshot, recalculatePurchaseUnitSnapshot, purchaseUnitKg3 } from './purchaseUnit';

export const CLEARED_PURCHASE_UNIT = { purchaseUnitId: undefined, purchaseUnit: undefined, purchaseQty: undefined, unitKg: undefined, inventoryQty: undefined };

/** 편집 중 빈 수량은 저장 오류로 표시한다. 렌더 도중 예외를 던져 작성 내용을 잃지 않는다. */
export function purchaseUnitRowFields(row: Partial<PurchaseUnitSnapshot>): Partial<PurchaseUnitSnapshot> {
  const result: Partial<PurchaseUnitSnapshot> = {};
  for (const key of ['purchaseUnitId','purchaseUnit','purchaseQty','unitKg','inventoryQty'] as const) {
    if (row[key] !== undefined) (result as Record<string, unknown>)[key] = row[key];
  }
  return result;
}

export function changePurchaseUnitRowQuantity(row: Partial<PurchaseUnitSnapshot>, qty: string): Partial<PurchaseUnitSnapshot> {
  if (!row.purchaseUnitId) return {};
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ...purchaseUnitRowFields(row), purchaseQty: quantity, inventoryQty: 0 };
  return recalculatePurchaseUnitSnapshot({ ...purchaseUnitRowFields(row), purchaseQty: 1, inventoryQty: purchaseUnitKg3(row.unitKg!) } as PurchaseUnitSnapshot, quantity);
}

export function invalidPurchaseUnitRow(row: Partial<PurchaseUnitSnapshot> & { qty: number }): boolean {
  try { readPurchaseUnitSnapshot(row); return false; } catch { return true; }
}



/** 명시 등록된 기본단위만 새 품목 선택 시 한 번 적용한다. 중복 기본은 임의로 고르지 않는다. */
export function defaultPurchaseUnit(units: readonly ItemPurchaseUnit[], scope: {companyId: CompanyId;itemId:string;partnerId?:string}): {unit:ItemPurchaseUnit|null;ambiguous:boolean} {
 const valid=units.filter(unit=>unit.companyId===scope.companyId && unit.itemId===scope.itemId && unit.active && unit.isDefault);
 const specific=scope.partnerId ? valid.filter(unit=>unit.partnerId===scope.partnerId) : [];
 const preferred=specific.length ? specific : valid.filter(unit=>!unit.partnerId);
 return {unit:preferred.length===1 ? preferred[0] : null,ambiguous:preferred.length>1};
}
export function defaultPurchaseUnitRowFields(units: readonly ItemPurchaseUnit[], scope: {companyId:CompanyId;itemId:string;partnerId?:string}, qty:string): Partial<PurchaseUnitSnapshot> {
 const unit=defaultPurchaseUnit(units,scope).unit;
 if(!unit)return {};
 const quantity=Number(qty);
 // 아직 수량을 입력하지 않았다면 단위 선택만 보존하고 저장은 수량 입력 후 허용한다.
 return {purchaseUnitId:unit.id,purchaseUnit:unit.purchaseUnit,unitKg:unit.unitKg,purchaseQty:Number.isFinite(quantity)?quantity:0,inventoryQty:quantity>0 && Number.isFinite(quantity) ? purchaseUnitKg3(quantity*unit.unitKg) : 0};
}
