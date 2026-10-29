import { unpackComponent, unitsPerBoxOf, goodsShipQty, type OrderStockUnitInputs } from './orderStockUnits';
import { boxCountOf } from './orderEditUnits';

export interface ResolvedOrderItem<T extends { id: string }> {
  product?: T;
  qty: number;
  perBox: number;
  unknownItem: boolean;
}

export function resolveOrderItem<T extends { id: string }>(
  item: { itemId?: string; quantity: number; isBoxUnit?: boolean; boxQuantity?: number; unitsPerBox?: number },
  allItems: readonly T[], inputs: OrderStockUnitInputs,
): ResolvedOrderItem<T> {
  let product = item.itemId ? allItems.find(p => p.id === item.itemId) : undefined;
  const unknownItem = !product;

  const uc = unpackComponent(product, inputs);
  let qty = item.quantity;
  let perBox = 1;
  if (uc) {
    const loose = allItems.find(p => p.id === uc.itemId);
    if (loose) {
      //  몇 박스인가는 **orderUnits.boxCountOf 한 곳**이 답한다 — 재고 차감(stockUnits)과 같은 답이라야
      //  전표에 찍힌 낱개 수와 재고에서 빠진 양이 안 갈린다.
      const boxCount = boxCountOf(item);
      product = loose;
      qty = boxCount * uc.count;
      perBox = uc.count;
    }
  } else if (item.isBoxUnit && item.boxQuantity) {
    // 향미유처럼 재고는 낱개지만 주문은 박스로 받는 품목. 복사 주문의 옛 줄은
    // quantity에도 박스 수가 들어가 있으므로 환산표를 읽어 전표에서 낱개로 바로잡는다.
    const pack = item.unitsPerBox ?? unitsPerBoxOf(product, inputs);
    if (pack > 1) {
      qty = item.boxQuantity * pack;
      perBox = pack;
    }
  }
  return { product, qty, perBox, unknownItem };
}
export type OrderBoxConversionAssessment =
  | {kind:'not-box'}
  | {kind:'known';source:'order-snapshot'|'bom'|'pack';factor:number}
  | {kind:'unresolved';reason:'missing-item'|'invalid-order-snapshot'|'missing-loose-item'|'invalid-bom-factor'|'missing-pack-factor'|'invalid-pack-factor'|'missing-box-count'|'invalid-box-count'};
export type CheckedResolvedOrderItem<T extends {id:string}> =
  | {kind:'resolved';value:ResolvedOrderItem<T>;conversion:Exclude<OrderBoxConversionAssessment,{kind:'unresolved'}>}
  | Extract<OrderBoxConversionAssessment,{kind:'unresolved'}>;
type BoxConversionLine={itemId?:string;quantity:number;isBoxUnit?:boolean;boxQuantity?:number;unitsPerBox?:number};
/** 원료 투입 BOM이나 이름은 낱개 입수의 근거가 아니다. */
export function assessOrderBoxConversion<T extends {id:string}>(item:BoxConversionLine,allItems:readonly T[],inputs:OrderStockUnitInputs):OrderBoxConversionAssessment {
  const product=item.itemId?allItems.find(row=>row.id===item.itemId):undefined;
  const component=unpackComponent(product,inputs);
  if(component){
    if(!Number.isFinite(component.count)||component.count<=0)return{kind:'unresolved',reason:'invalid-bom-factor'};
    if(!allItems.some(row=>row.id===component.itemId))return{kind:'unresolved',reason:'missing-loose-item'};
    return{kind:'known',source:'bom',factor:component.count};
  }
  if(!item.isBoxUnit)return{kind:'not-box'};
  if(!product)return{kind:'unresolved',reason:'missing-item'};
  if(item.unitsPerBox!==undefined)return typeof item.unitsPerBox==='number'&&Number.isFinite(item.unitsPerBox)&&item.unitsPerBox>0?{kind:'known',source:'order-snapshot',factor:item.unitsPerBox}:{kind:'unresolved',reason:'invalid-order-snapshot'};
  const factor=unitsPerBoxOf(product,inputs);
  return Number.isFinite(factor)&&factor>0?{kind:'known',source:'pack',factor}:{kind:'unresolved',reason:factor===0?'missing-pack-factor':'invalid-pack-factor'};
}
/** 기존 resolver가 실제로 읽은 기준을 재사용해 검증 때문에 레지스트리를 다시 바꾸지 않는다. */
export function resolveOrderItemChecked<T extends {id:string}>(item:BoxConversionLine,allItems:readonly T[],inputs:OrderStockUnitInputs):CheckedResolvedOrderItem<T> {
  const boms=new Map<string,ReturnType<OrderStockUnitInputs['bom']['of']>>(),packs=new Map<string,number>();
  const observed:OrderStockUnitInputs={bom:{of:id=>{const rows=inputs.bom.of(id);if(!boms.has(id))boms.set(id,rows);return rows;}},pack:{of:id=>{const factor=inputs.pack.of(id);if(!packs.has(id))packs.set(id,factor);return factor;}}};
  const value=resolveOrderItem(item,allItems,observed);
  const captured:OrderStockUnitInputs={bom:{of:id=>{if(!boms.has(id))boms.set(id,inputs.bom.of(id));return boms.get(id)!;}},pack:{of:id=>{if(!packs.has(id))packs.set(id,inputs.pack.of(id));return packs.get(id)!;}}};
  const conversion=assessOrderBoxConversion(item,allItems,captured);
  if(conversion.kind==='unresolved')return conversion;
  if(conversion.kind==='known'&&conversion.source!=='bom'){
    if(item.boxQuantity===undefined)return{kind:'unresolved',reason:'missing-box-count'};
    if(!Number.isFinite(item.boxQuantity))return{kind:'unresolved',reason:'invalid-box-count'};
    return{kind:'resolved',value:{...value,qty:goodsShipQty({...item,...(item.boxQuantity===0?{quantity:0}:{}),unitsPerBox:conversion.factor},value.product!,captured),perBox:conversion.factor},conversion};
  }
  return{kind:'resolved',value,conversion};
}
