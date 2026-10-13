import type { PurchaseUnitSnapshot, ItemPurchaseUnit, CompanyId } from './types';
import { readPurchaseUnitSnapshot, recalculatePurchaseUnitSnapshot, purchaseUnitKg3, MANUAL_PURCHASE_UNIT_ID, parseManualPurchaseUnitKg, makeManualPurchaseUnitSnapshot, isManualPurchaseUnitSnapshot } from './purchaseUnit';
export {MANUAL_PURCHASE_UNIT_ID,parseManualPurchaseUnitKg,makeManualPurchaseUnitSnapshot,isManualPurchaseUnitSnapshot} from './purchaseUnit';

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
  if(row.purchaseUnitId===MANUAL_PURCHASE_UNIT_ID){
    if(row.unitKg===0&&/^(kg|g)$/i.test(row.purchaseUnit?.trim()??''))return {...purchaseUnitRowFields(row),purchaseQty:Number.isFinite(Number(qty))?Number(qty):0,inventoryQty:0};
    return manualPurchaseUnitRowFields(row.purchaseUnit??'',qty);
  }
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ...purchaseUnitRowFields(row), purchaseQty: quantity, inventoryQty: 0 };
  return recalculatePurchaseUnitSnapshot({ ...purchaseUnitRowFields(row), purchaseQty: 1, inventoryQty: purchaseUnitKg3(row.unitKg!) } as PurchaseUnitSnapshot, quantity);
}

/** 잘못 입력한 단위도 그대로 보여주고 저장만 막는다. 20kg를 20포의 원가 kg로 따로 받지 않는다. */
export function manualPurchaseUnitRowFields(purchaseUnit:string,qty:string):Partial<PurchaseUnitSnapshot>{
 const unitKg=parseManualPurchaseUnitKg(purchaseUnit),quantity=Number(qty);
 if(unitKg!==null&&Number.isFinite(quantity)&&quantity>0){
  try{return {...makeManualPurchaseUnitSnapshot(purchaseUnit,quantity),purchaseUnit};}
  catch{/* 0.001kg 반올림으로0이 되거나 곱이 넘치는 입력은 폼을 깨뜨리지 않고 저장 검사로 보낸다. */}
 }
 return {purchaseUnitId:MANUAL_PURCHASE_UNIT_ID,purchaseUnit,purchaseQty:Number.isFinite(quantity)?quantity:0,unitKg:unitKg??0,inventoryQty:0};
}
/** 새 행에만 사용한다. 렌더나 기존 전표 읽기에서 옛 줄을 자동 환산하지 않는다. */
export const defaultManualPurchaseUnitRowFields=(qty:string)=>manualPurchaseUnitRowFields('kg',qty);

/** 숫자와 단위를 나눠 보여주되 저장된 포대·원스냅샷은 읽기만으로 kg/g로 바꾸지 않는다. */
export function purchaseUnitInputParts(row:Partial<PurchaseUnitSnapshot>,fallbackUnit='kg'):{amount:string;unit:string;legacy:boolean}{
 const label=row.purchaseUnit??fallbackUnit,matched=/^(.*?)\s*(kg|g)$/i.exec(label.trim());
 const registered=!!row.purchaseUnitId&&row.purchaseUnitId!==MANUAL_PURCHASE_UNIT_ID;
 if(!registered&&matched)return {amount:matched[1]|| (row.unitKg===0?'':'1'),unit:matched[2].toLowerCase(),legacy:false};
 return {amount:String(row.unitKg??1),unit:label,legacy:true};
}
/** 빈 숫자의 kg/g 문자열이 기존 1kg 기본 파서로 살아나지 않게 invalid 스냅샷으로 남긴다. */
export function changeManualPurchaseUnitInput(amount:string,unit:'kg'|'g',qty:string):Partial<PurchaseUnitSnapshot>{
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount))return {purchaseUnitId:MANUAL_PURCHASE_UNIT_ID,purchaseUnit:amount+unit,purchaseQty:Number.isFinite(Number(qty))?Number(qty):0,unitKg:0,inventoryQty:0};
 return manualPurchaseUnitRowFields(amount+unit,qty);
}

export function invalidPurchaseUnitRow(row: Partial<PurchaseUnitSnapshot> & { qty: number }): boolean {
  try { if(row.purchaseUnitId===MANUAL_PURCHASE_UNIT_ID&&!isManualPurchaseUnitSnapshot(row))return true;readPurchaseUnitSnapshot(row); return false; } catch { return true; }
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
