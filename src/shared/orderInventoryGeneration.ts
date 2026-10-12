import {rawPressText} from './rawPressAttempt';
import type { CompanyId,Order } from './types';
/** 새 작업에만 붙인다. 옛 잠금에 UID·세대를 추정해 이 표식을 만들지 않는다. */
export interface OrderInventoryGeneration {
 contractVersion:1;companyId:CompanyId;orderId:string;operationId:string;startedAt:string;actorUid:string;
}
export function validateOrderInventoryGeneration(generation:OrderInventoryGeneration):void {
 if(generation?.contractVersion!==1||!['taebaek','punghoe'].includes(generation.companyId)||![generation.orderId,generation.operationId,generation.actorUid,generation.startedAt].every(value=>typeof value==='string'&&value.trim().length>0&&value===value.trim())||!Number.isFinite(Date.parse(generation.startedAt)))throw Error('주문 재고 작업의 최초 세대를 확인해 주세요.');
}
export function sameOrderInventoryGeneration(a:OrderInventoryGeneration|undefined|null,b:OrderInventoryGeneration|undefined|null):boolean {
 if(!a||!b)return false;
 return a.contractVersion===1&&b.contractVersion===1&&a.companyId===b.companyId&&a.orderId===b.orderId&&a.operationId===b.operationId&&a.startedAt===b.startedAt&&a.actorUid===b.actorUid;
}
export function generationFromOrder(order:Pick<Order,'id'|'companyId'|'inventoryOperation'>):OrderInventoryGeneration|null {
 const operation=order.inventoryOperation;
 if(operation?.contractVersion!==1)return null;
 if(!['taebaek','punghoe'].includes(order.companyId??'')||typeof order.id!=='string'||!order.id.trim())throw Error('새 주문 재고 작업의 회사와 주문번호가 명확하지 않습니다.');
 const generation:OrderInventoryGeneration={contractVersion:1,companyId:order.companyId!,orderId:order.id,operationId:operation.id,startedAt:operation.startedAt,actorUid:operation.actorUid??''};
 validateOrderInventoryGeneration(generation);return generation;
}
export function assertOrderInventoryGeneration(order:Pick<Order,'id'|'companyId'|'inventoryOperation'>,generation:OrderInventoryGeneration,options:{allowFailed?:boolean}={}):void {
 validateOrderInventoryGeneration(generation);
 if(!sameOrderInventoryGeneration(generationFromOrder(order),generation)||!(order.inventoryOperation?.state==='processing'||options.allowFailed&&order.inventoryOperation?.state==='failed'))throw Error('주문 재고 작업의 세대가 바뀌었습니다. 최초 원문을 보존해 주세요.');
}
/** 저장 전에 빠지는 선택적 undefined만 허용한다. NaN·클래스는 JSON null로 바꾸지 않는다. */
function assertFinalPlain(value:unknown,inArray=false):void{
 if(value===undefined&&!inArray)return;if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){value.forEach(row=>assertFinalPlain(row,true));return;}
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){Object.values(value).forEach(row=>assertFinalPlain(row));return;}
 throw Error('최종 재고 요청은 유한한 JSON 원문이어야 합니다.');
}
export function validateOrderInventoryConsumedLots(value:unknown):asserts value is NonNullable<Order['productConsumedLots']>{
 if(!Array.isArray(value))throw Error('최종 소비 로트 원문이 배열이 아닙니다.');assertFinalPlain(value);
 for(const row of value)if(!row||typeof row!=='object'||typeof row.itemId!=='string'||!row.itemId.trim()||typeof row.lotId!=='string'||!row.lotId.trim()||!Number.isFinite(row.qty)||row.qty<=0)throw Error('최종 소비 로트 품목·로트·수량을 확인해 주세요.');
}
export function hasOrderInventoryGenerationCompletion(order:Pick<Order,'id'|'companyId'|'inventoryGenerationCompletion'>,generation:OrderInventoryGeneration):boolean {
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

/** 재전송 원문이 다르면 같은 세대의 완료표라도 성공으로 처리하지 않는다. */
export function finalOrderInventoryRequestText(generation:OrderInventoryGeneration,deltas:ReadonlyMap<string,number>,lotItemIds:readonly string[],patch:Record<string,unknown>,reservationEvidence?:Record<string,unknown>):string{
 validateOrderInventoryGeneration(generation);

 for(const [id,delta]of deltas)if(typeof id!=='string'||!id||!Number.isFinite(delta))throw Error('최종 재고 변화량을 확인해 주세요.');
 assertFinalPlain(patch);assertFinalPlain(reservationEvidence);
 if('inventoryGenerationCompletion' in patch||'companyId' in patch||'id' in patch)throw Error('최종 주문의 회사·완료표를 임의로 바꿀 수 없습니다.');
 return rawPressText({generation,deltas:[...deltas].sort(([a],[b])=>a.localeCompare(b)),lotItemIds:[...lotItemIds].sort(),patch,reservationEvidence});
}

/** 저장된 단계는 늦게 도착한 이전 단계 오류 때문에 뒤로 돌아가지 않는다. */
export function advanceOrderInventoryStage(current:NonNullable<Order['inventoryOperation']>['stage'],next:NonNullable<Order['inventoryOperation']>['stage']):NonNullable<Order['inventoryOperation']>['stage'] {
 const stages=['claim','reservation','raw-inventory','production-record','final-stock'] as const;
 const currentRank=stages.indexOf(current as typeof stages[number]);
 const nextRank=next===undefined?currentRank:stages.indexOf(next as typeof stages[number]);
 if(currentRank<0||nextRank<0)throw Error('재고 작업의 저장 단계를 확인해 주세요.');
 return nextRank>currentRank?next:current;
}
