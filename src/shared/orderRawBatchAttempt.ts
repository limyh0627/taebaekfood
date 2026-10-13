import {operationDocId,type RawInventoryCommand} from './rawInventoryCore';
import {rawPressText} from './rawPressAttempt';
import type {LegacyLedgerFields} from './services/rawInventoryService';
import {validateOrderInventoryGeneration,type OrderInventoryGeneration} from './orderInventoryGeneration';
import type {Order} from './types';
import {selectOrderRawBatchOrderEvidence} from '../../functions/src/shared/orderRawBatchOrderEvidence';
/** 재클릭 시각·잠금 상태는 제외하고 원래 품목과 생산·출고 근거는 보존한다. */
export function orderRawBatchOrderEvidence(order:Order):string{
 return selectOrderRawBatchOrderEvidence(order,rawPressText);
}
export interface OrderRawBatchCommand {command:RawInventoryCommand;options?:{newLotId?:string;carryOverLotId?:string;legacy?:LegacyLedgerFields}}
export interface OrderRawBatchRequest {
 version:1;generation:OrderInventoryGeneration;jobId:string;legacyJobIds:string[];recordedAt:string;
 business:Record<string,unknown>;plan:Record<string,unknown>;commands:OrderRawBatchCommand[];
}
export const orderRawBatchJobId=(generation:OrderInventoryGeneration)=>'order-raw-batch:v1:'+operationDocId(generation.operationId);
export function assertPlainOrderRawBatch(value:unknown):void {
 const walk=(v:unknown)=>{if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'&&Number.isFinite(v))return;if(Array.isArray(v)){v.forEach(walk);return;}if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){Object.values(v).forEach(walk);return;}throw Error('원료 일괄 요청은 유한한 JSON 원문만 저장할 수 있습니다.');};
 walk(value);if(new TextEncoder().encode(JSON.stringify(value)).byteLength>700_000)throw Error('원료 일괄 요청 원문이 저장 한도를 초과했습니다.');
}
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
export const orderRawBatchAttemptKey=(companyId:string,actorUid:string,orderId:string)=>`order-raw-batch:${encodeURIComponent(actorUid)}:${companyId}:${encodeURIComponent(orderId)}`;
export function readOrderRawBatchAttempt(companyId:string,actorUid:string,orderId:string):{request:OrderRawBatchRequest;encoded:string}|null {
 const encoded=localStorage.getItem(orderRawBatchAttemptKey(companyId,actorUid,orderId));if(encoded===null)return null;
 try{const request=JSON.parse(encoded);validateOrderRawBatchRequest(request);const g=request.generation;if(g.companyId!==companyId||g.actorUid!==actorUid||g.orderId!==orderId)throw Error();return {request,encoded};}
 catch{throw Error('저장된 주문 원료 요청이 손상되었습니다. 최초 원문을 보존했습니다.');}
}
/** 현재 재고나 오늘 날짜로 재계산하지 않고 같은 세대·업무 선택의 첫 계획을 재개한다. */
export function saveOrderRawBatchAttempt(request:OrderRawBatchRequest):{request:OrderRawBatchRequest;encoded:string} {
 validateOrderRawBatchRequest(request);const g=request.generation,existing=readOrderRawBatchAttempt(g.companyId,g.actorUid,g.orderId);
 if(existing){if(rawPressText(existing.request.generation)!==rawPressText(g)||rawPressText(existing.request.business)!==rawPressText(request.business))throw Error('최초 주문 원료 요청의 결과부터 확인해 주세요.');return existing;}
 const key=orderRawBatchAttemptKey(g.companyId,g.actorUid,g.orderId);if(localStorage.getItem(key)!==null)throw Error('다른 원료 요청을 먼저 확인해 주세요.');const encoded=JSON.stringify(request);localStorage.setItem(key,encoded);return {request,encoded};
}
export function clearOrderRawBatchAttempt(request:OrderRawBatchRequest,encoded:string):void {
 const g=request.generation,key=orderRawBatchAttemptKey(g.companyId,g.actorUid,g.orderId);if(localStorage.getItem(key)!==encoded)throw Error('최초 원료 요청이 달라 정리하지 않았습니다.');localStorage.removeItem(key);
}

/** 수동 unknown 퇴역은 폐기가 아니다. 정확 서버 영수증과 원문을 따로 보관한 다음 활성 키만 비운다. */
export function archiveRetiredOrderRawBatchAttempt(request:OrderRawBatchRequest,encoded:string,receipt:{status:string;inventoryApplied:string;requestHash:string;requestText:string;retirementId:string;generation:OrderInventoryGeneration}):void {
 const g=request.generation,key=orderRawBatchAttemptKey(g.companyId,g.actorUid,g.orderId);
 if(!['retired','duplicate'].includes(receipt.status)||receipt.inventoryApplied!=='unknown'||!receipt.retirementId||!/^[a-f0-9]{64}$/.test(receipt.requestHash)||receipt.requestText!==rawPressText(request)||rawPressText(receipt.generation)!==rawPressText(g))throw Error('최초 요청 퇴역 영수증이 원문과 다릅니다.');
 if(localStorage.getItem(key)!==encoded)throw Error('퇴역할 최초 요청이 바뀌었습니다. 원문을 보존했습니다.');
 const archiveKey='order-raw-batch-retired:'+receipt.retirementId,archive=JSON.stringify({version:1,encoded,requestText:receipt.requestText,requestHash:receipt.requestHash,retirementId:receipt.retirementId,generation:g,inventoryApplied:'unknown'}),old=localStorage.getItem(archiveKey);
 if(old!==null&&old!==archive)throw Error('퇴역 보관 원문이 다릅니다.');
 if(old===null)localStorage.setItem(archiveKey,archive);
 if(localStorage.getItem(archiveKey)!==archive||localStorage.getItem(key)!==encoded)throw Error('최초 요청 보관을 확인하지 못했습니다. 활성 원문을 보존했습니다.');
 localStorage.removeItem(key);
 if(localStorage.getItem(key)!==null)throw Error('최초 요청 퇴역을 확인하지 못했습니다.');
}
