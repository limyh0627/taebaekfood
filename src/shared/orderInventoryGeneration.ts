import {sameOrderInventoryGeneration,assertFinalPlain} from '../../functions/src/shared/orderInventoryCompletionEvidence';
export {sameOrderInventoryGeneration,validateOrderInventoryConsumedLots,hasOrderInventoryGenerationCompletion} from '../../functions/src/shared/orderInventoryCompletionEvidence';
import {validateOrderInventoryGeneration} from '../../functions/src/shared/orderPlanPrimitives';
export {validateOrderInventoryGeneration} from '../../functions/src/shared/orderPlanPrimitives';
import {rawPressText} from './rawPressAttempt';
import type { Order } from './types';
import type {OrderInventoryGeneration} from '../../functions/src/shared/orderStockReservationPlan';
export type {OrderInventoryGeneration} from '../../functions/src/shared/orderStockReservationPlan';

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
