import {rawPressText} from './orderPlanPrimitives';
import type {OrderInventoryGeneration} from './orderStockReservationPlan';
import type {ProductConsumedLotTrace} from './orderProductLotPlan';
export interface OrderInventoryCompletionOrder {id:string;companyId?:'taebaek'|'punghoe';inventoryGenerationCompletion?:{generation:OrderInventoryGeneration;completedAt:string;requestText:string;consumedLotsText:string;consumedLots:ProductConsumedLotTrace[]}}
export function sameOrderInventoryGeneration(a:OrderInventoryGeneration|undefined|null,b:OrderInventoryGeneration|undefined|null):boolean {
 if(!a||!b)return false;
 return a.contractVersion===1&&b.contractVersion===1&&a.companyId===b.companyId&&a.orderId===b.orderId&&a.operationId===b.operationId&&a.startedAt===b.startedAt&&a.actorUid===b.actorUid;
}

export function assertFinalPlain(value:unknown,inArray=false):void{
 if(value===undefined&&!inArray)return;if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){value.forEach(row=>assertFinalPlain(row,true));return;}
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){Object.values(value).forEach(row=>assertFinalPlain(row));return;}
 throw Error('최종 재고 요청은 유한한 JSON 원문이어야 합니다.');
}

export function validateOrderInventoryConsumedLots(value:unknown):asserts value is ProductConsumedLotTrace[]{
 if(!Array.isArray(value))throw Error('최종 소비 로트 원문이 배열이 아닙니다.');assertFinalPlain(value);
 for(const row of value)if(!row||typeof row!=='object'||typeof row.itemId!=='string'||!row.itemId.trim()||typeof row.lotId!=='string'||!row.lotId.trim()||!Number.isFinite(row.qty)||row.qty<=0)throw Error('최종 소비 로트 품목·로트·수량을 확인해 주세요.');
}

export function hasOrderInventoryGenerationCompletion(order:Pick<OrderInventoryCompletionOrder,'id'|'companyId'|'inventoryGenerationCompletion'>,generation:OrderInventoryGeneration):boolean {
 const completed=order.inventoryGenerationCompletion;
 try{
  validateOrderInventoryConsumedLots(completed?.consumedLots);
  if(typeof completed?.requestText!=='string')return false;
  const request=JSON.parse(completed.requestText);assertFinalPlain(request);
  if(rawPressText(request)!==completed.requestText||!sameOrderInventoryGeneration(request.generation,generation)
    ||!Array.isArray(request.deltas)||request.deltas.some((row:unknown)=>!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0]||!Number.isFinite(row[1]))
    ||!Array.isArray(request.lotItemIds)||request.lotItemIds.some((id:unknown)=>typeof id!=='string'||!id)
    ||!request.patch||typeof request.patch!=='object'||Array.isArray(request.patch))return false;
 }catch{return false;}
 return order.id===generation.orderId&&order.companyId===generation.companyId&&!!completed&&typeof completed.requestText==='string'&&completed.requestText.length>0&&typeof completed.consumedLotsText==='string'&&completed.consumedLotsText===rawPressText(completed.consumedLots)&&sameOrderInventoryGeneration(completed.generation,generation)&&typeof completed.completedAt==='string'&&completed.completedAt===completed.completedAt.trim()&&Number.isFinite(Date.parse(completed.completedAt));
}
