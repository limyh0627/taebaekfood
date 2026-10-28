import type {CompanyId} from './rawLot';
import type {OrderInventoryGeneration} from './orderStockReservationPlan';
import type {ProductionItem,ProductionLine} from './orderProductionDomain';
import type {OrderStockUnitInputs} from './orderStockUnits';
import {resolveOrderItem} from './orderResolvedItem';
import {assertPlainOrderRawBatch,rawPressText,validateOrderInventoryGeneration,isCalendarDay} from './orderPlanPrimitives';
import {operationDocId} from './rawInventoryCore';

export interface OrderProductionRecordIndexEntry {
  recordId:string;
  generation:OrderInventoryGeneration;
  requestHash:string;
}
export interface ProductionRecord {
  supersededBy?:OrderProductionRecordIndexEntry;
  legacySourceCandidates?:{recordId:string;companyId:CompanyId;itemId:string;note:string}[];
  id: string;
  companyId?:CompanyId;
  orderId?:string;
  lineId?:string;
  generation?:OrderInventoryGeneration;
  date: string;               // YYYY-MM-DD
  itemId: string;
  itemName: string;
  finishedQty: number;        // FINISHED 생산 수량
  wipUsed?: number;           // WIP 투입 수량 (옵션)
  wipItemId?: string;      // 투입한 WIP 품목 ID (옵션)
  wipItemName?: string;    // 투입한 WIP 품목명 (옵션)
  cost?: number;              // 건당 원가 (자동 계산 또는 수동 입력)
  note?: string;
  createdBy?: string;
  createdAt: string;
}
export const TAEBAEK: CompanyId = 'taebaek';
export const companyOf = (x: { companyId?: CompanyId } | undefined): CompanyId => x?.companyId ?? TAEBAEK;

export type RecordItem=Pick<ProductionItem,'id'|'name'|'type'> & {companyId?:CompanyId;cost?:number};
export interface RecordOrder {id:string;companyId?:CompanyId;partnerName:string;items:(ProductionLine & {lineId?:string})[];deliveredAt?:string;productionRecordIndex?:Record<string,OrderProductionRecordIndexEntry>}
export interface OrderProductionRecordPolicy {dateOf:(iso?:string)=>string}
export type ProductionRecordIndexEntry=OrderProductionRecordIndexEntry;
export type ProductionRecordIndex=Record<string,ProductionRecordIndexEntry>;
export interface LegacyProductionSourceCandidate {recordId:string;companyId:CompanyId;itemId:string;note:string}
export type OrderGeneratedProductionRecord=ProductionRecord & {companyId:CompanyId;orderId:string;lineId:string;generation:OrderInventoryGeneration;legacySourceCandidates?:LegacyProductionSourceCandidate[]};
export interface OrderProductionRecordPlan {version:1;generation:OrderInventoryGeneration;recordedAt:string;previousIndex:ProductionRecordIndex;records:OrderGeneratedProductionRecord[]}
export interface OrderProductionRecordReceipt {version:1;generation:OrderInventoryGeneration;requestHash:string;recordIds:string[];completedAt:string}
/** 다른 줄의 상속 속성은 저장된 생산기록 포인터가 아니다. */
export function ownLineIndexEntry<T>(index:Record<string,T>|null|undefined,lineId:string):T|undefined {
 return index!=null&&Object.prototype.hasOwnProperty.call(index,lineId)?index[lineId]:undefined;
}
export const orderProductionRecordId=(generation:OrderInventoryGeneration,lineId:string)=>'pr-gen1:'+operationDocId(rawPressText({generation,lineId}));
export function validateOrderProductionRecordPlan(plan:OrderProductionRecordPlan):void {
 assertPlainOrderRawBatch(plan);
 validateOrderInventoryGeneration(plan?.generation);
 validateProductionRecordIndex(plan.previousIndex,plan.generation.companyId,plan.generation.orderId);
 if(plan.version!==1||plan.recordedAt!==plan.generation.startedAt||!Array.isArray(plan.records)||plan.records.length+2>500)throw Error('최초 생산기록 계획을 확인해 주세요.');
 const ids=new Set<string>();
 for(const record of plan.records){
  if(!record||record.companyId!==plan.generation.companyId||record.orderId!==plan.generation.orderId||typeof record.lineId!=='string'||!record.lineId.trim()||record.lineId!==record.lineId.trim()||rawPressText(record.generation)!==rawPressText(plan.generation)||record.id!==orderProductionRecordId(plan.generation,record.lineId)||ids.has(record.id)||typeof record.itemId!=='string'||!record.itemId.trim()||record.itemId!==record.itemId.trim()||typeof record.itemName!=='string'||!Number.isFinite(record.finishedQty)||record.finishedQty<0||record.createdAt!==plan.recordedAt||typeof record.date!=='string'||!isCalendarDay(record.date)||record.cost!==undefined&&!Number.isFinite(record.cost))throw Error('생산기록의 회사·줄·수량·최초 원문을 확인해 주세요.');
  ids.add(record.id);
 }
}
export function makeOrderProductionRecordReceipt(plan:OrderProductionRecordPlan,requestHash:string):OrderProductionRecordReceipt {
 validateOrderProductionRecordPlan(plan);
 if(typeof requestHash!=='string'||!requestHash.trim()||requestHash!==requestHash.trim())throw Error('생산기록 원문 지문을 확인해 주세요.');
 return {version:1,generation:plan.generation,requestHash,recordIds:plan.records.map(row=>row.id),completedAt:plan.recordedAt};
}
/** 현재 가격·BOM으로 재시도를 재구성하지 않는다. 이 반환값을 최초 원료 계획에 보존한다. */
export function buildOrderProductionRecordPlan(order:RecordOrder,allItems:readonly RecordItem[],inputs:OrderStockUnitInputs,generation:OrderInventoryGeneration,policy:OrderProductionRecordPolicy):OrderProductionRecordPlan {
 validateOrderInventoryGeneration(generation);
 if(order.id!==generation.orderId||order.companyId!==generation.companyId)throw Error('생산기록의 명시 회사와 주문이 다릅니다.');
 const lineIds=order.items.map(row=>row.lineId);
 if(lineIds.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim())||new Set(lineIds).size!==lineIds.length)throw Error('최초 주문 줄 번호가 없거나 중복되었습니다.');

 const records:OrderGeneratedProductionRecord[]=[];
 let finishedIndex=0;
 for(const line of order.items){
  const original=allItems.find(item=>item.id===line.itemId);
  if(original&&companyOf(original)!==generation.companyId)throw Error('다른 회사 품목으로 생산기록을 만들 수 없습니다.');
  // 누락 품목/비생산 품목은 기존 자동기록 정책 그대로 건너뛴다.
  if(!original||original.type!=='product')continue;
  finishedIndex++;
  const resolved=resolveOrderItem(line,allItems,inputs),product=resolved.product??original;
  if(companyOf(product)!==generation.companyId)throw Error('다른 회사 구성품으로 생산기록을 만들 수 없습니다.');
  if(!line.lineId)throw Error('최초 주문 줄 번호가 없어 생산기록을 생성하지 않았습니다.');
  records.push({id:orderProductionRecordId(generation,line.lineId),companyId:generation.companyId,orderId:order.id,lineId:line.lineId,generation,legacySourceCandidates:[{recordId:`pr-${order.id}-${line.lineId}`,companyId:generation.companyId,itemId:product.id,note:`주문 자동 연동 (${order.partnerName})`},{recordId:`pr-${order.id}-${finishedIndex}-${product.id}`,companyId:generation.companyId,itemId:product.id,note:`주문 자동 연동 (${order.partnerName})`},{recordId:`pr-${order.id}-${line.itemId}`,companyId:generation.companyId,itemId:line.itemId,note:`주문 자동 연동 (${order.partnerName})`}],date:policy.dateOf(order.deliveredAt??generation.startedAt),itemId:product.id,itemName:product.name,finishedQty:resolved.qty,...(product.cost!==undefined?{cost:product.cost}:{}),note:`주문 자동 연동 (${order.partnerName})`,createdAt:generation.startedAt});
 }
 const plan:OrderProductionRecordPlan={version:1,generation,recordedAt:generation.startedAt,previousIndex:JSON.parse(JSON.stringify(order.productionRecordIndex??{})),records};validateOrderProductionRecordPlan(plan);return plan;
}
/** 현재 포인터의 주소·회사·원세대만 검증한다. 시각으로 최신 기록을 고르지 않는다. */
export function validateProductionRecordIndex(index:ProductionRecordIndex,companyId:CompanyId,orderId:string):void {
 assertPlainOrderRawBatch(index);
 if(!index||Array.isArray(index)||typeof index!=='object')throw Error('생산기록 현재 인덱스를 확인해 주세요.');
 for(const [lineId,entry]of Object.entries(index)){
  validateOrderInventoryGeneration(entry?.generation);
  if(!lineId||lineId!==lineId.trim()||entry.generation.companyId!==companyId||entry.generation.orderId!==orderId||entry.recordId!==orderProductionRecordId(entry.generation,lineId)||typeof entry.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(entry.requestHash))throw Error('생산기록 포인터의 회사·줄·원문 지문이 다릅니다.');
 }
}
export function deriveNextProductionRecordIndex(plan:OrderProductionRecordPlan,requestHash:string):ProductionRecordIndex {
 validateOrderProductionRecordPlan(plan);
 if(!/^[a-f0-9]{64}$/.test(requestHash))throw Error('생산기록 원문 지문을 확인해 주세요.');
 const next:ProductionRecordIndex=JSON.parse(JSON.stringify(plan.previousIndex));
 for(const record of plan.records)Object.defineProperty(next,record.lineId,{value:{recordId:record.id,generation:JSON.parse(JSON.stringify(plan.generation)),requestHash},writable:true,enumerable:true,configurable:true});
 return next;
}
