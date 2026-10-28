import {operationDocId,type RawInventoryCommand} from './rawInventoryCore';
import type {LegacyLedgerFields} from './rawInventoryDocument';
import type {OrderInventoryGeneration} from './orderStockReservationPlan';
import {assertPlainOrderRawBatch,validateOrderInventoryGeneration} from './orderPlanPrimitives';
export interface OrderRawBatchCommand {command:RawInventoryCommand;options?:{newLotId?:string;carryOverLotId?:string;legacy?:LegacyLedgerFields}}
export interface OrderRawBatchRequest {
 version:1;generation:OrderInventoryGeneration;jobId:string;legacyJobIds:string[];recordedAt:string;
 business:Record<string,unknown>;plan:Record<string,unknown>;commands:OrderRawBatchCommand[];
}
export const orderRawBatchJobId=(generation:OrderInventoryGeneration)=>'order-raw-batch:v1:'+operationDocId(generation.operationId);
export function validateOrderRawBatchRequest(request:OrderRawBatchRequest):void {
 assertPlainOrderRawBatch(request);
 const g=request.generation;
 validateOrderInventoryGeneration(g);
 if(!request.business||Array.isArray(request.business)||typeof request.business!=='object'||!request.plan||Array.isArray(request.plan)||typeof request.plan!=='object')throw Error('원료 일괄 업무와 최초 계획을 확인해 주세요.');
 if(typeof request.business.orderText!=='string'||!request.business.orderText)throw Error('주문 원문 근거를 확인해 주세요.');
 if(request.version!==1||request.jobId!==orderRawBatchJobId(g)||request.recordedAt!==g.startedAt||!Array.isArray(request.legacyJobIds)||new Set(request.legacyJobIds).size!==request.legacyJobIds.length
  ||request.legacyJobIds.some(id=>typeof id!=='string'||!id||id.includes('/'))||!Array.isArray(request.commands)||request.commands.length*3+2>500
  ||new Set(request.commands.map(row=>row.command.operationId)).size!==request.commands.length)throw Error('원료 일괄 요청 세대와 명령을 확인해 주세요.');
 for(const {command:c} of request.commands)if(!['consume','ledger-consume'].includes(c.kind)||c.companyId!==g.companyId||!c.rawItemId||!c.operationId||!Number.isFinite(Date.parse(c.effectiveAt))
  ||!('kg' in c)||!Number.isFinite(c.kg)||c.kg<=0||c.source?.id!==g.orderId||(c.kind==='consume'?c.source.type!=='production':c.source.type!=='oem'))throw Error('원료 일괄 명령 출처와 수량을 확인해 주세요.');
}
