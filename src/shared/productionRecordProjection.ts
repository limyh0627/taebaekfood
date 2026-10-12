import {companyOf,type Order,type ProductionRecord} from './types';
import {rawPressText} from './rawPressAttempt';
import {validateOrderInventoryGeneration,sameOrderInventoryGeneration} from './orderInventoryGeneration';
import {orderProductionRecordId,validateProductionRecordIndex,type ProductionRecordIndex,type ProductionRecordIndexEntry} from './orderProductionRecordPlan';
export type ProductionRecordProjectionStatus='current'|'superseded'|'uncertain';
export interface ProductionRecordProjectionDetail {record:ProductionRecord;status:ProductionRecordProjectionStatus;reason?:string}
export const hasProductionRecordIndex=(order:Pick<Order,'productionRecordIndex'>):boolean=>Object.prototype.hasOwnProperty.call(order,'productionRecordIndex');
const groupOf=(record:ProductionRecord)=>rawPressText([companyOf(record),record.orderId,record.lineId]);
function validGenerated(record:ProductionRecord):boolean {
 try{validateOrderInventoryGeneration(record.generation!);return typeof record.orderId==='string'&&!!record.orderId&&typeof record.lineId==='string'&&!!record.lineId&&record.generation!.companyId===companyOf(record)&&record.generation!.orderId===record.orderId&&record.id===orderProductionRecordId(record.generation!,record.lineId);}catch{return false;}
}
export const productionRecordOrderId=(record:ProductionRecord):string|undefined=>validGenerated(record)?record.orderId:undefined;
function validEntry(entry:ProductionRecordIndexEntry,record:ProductionRecord):boolean {
 try{validateProductionRecordIndex({[record.lineId!]:entry},companyOf(record),record.orderId!);return true;}catch{return false;}
}
/** 명시 현재 포인터·이전 세대 표식만 소비한다. 날짜 정렬로 최신 기록을 추정하지 않는다. */
export function projectProductionRecords(records:readonly ProductionRecord[],orders:readonly Order[]) {
 const details:ProductionRecordProjectionDetail[]=records.map(record=>({record,status:'current'}));
 const generated=details.filter(row=>row.record.generation!==undefined||row.record.id.startsWith('pr-gen1:'));
 const duplicateIds=new Set(records.filter((record,index)=>records.findIndex(row=>row.id===record.id)!==index).map(row=>row.id));
 const unindexed=new Map<string,ProductionRecordProjectionDetail[]>();
 for(const row of generated){
  const r=row.record;
  if(r.legacySourceCandidates!==undefined&&(!Array.isArray(r.legacySourceCandidates)||r.legacySourceCandidates.some(candidate=>!candidate||typeof candidate.recordId!=='string'||!candidate.recordId||candidate.companyId!==companyOf(r)||typeof candidate.itemId!=='string'||!candidate.itemId||typeof candidate.note!=='string'))){row.status='uncertain';row.reason='과거 주소 후보 원문이 손상되었습니다.';continue;}
  if(!validGenerated(r)||duplicateIds.has(r.id)){row.status='uncertain';row.reason='신규 생산기록 출처 또는 식별자가 손상되었습니다.';continue;}
  const candidates=orders.filter(order=>order.id===r.orderId&&companyOf(order)===companyOf(r));
  if(candidates.length>1){row.status='uncertain';row.reason='같은 회사 주문 원문이 중복됩니다.';continue;}
  const order=candidates[0];
  let index:ProductionRecordIndex|undefined;
  if(order&&hasProductionRecordIndex(order)){
   try{index=order.productionRecordIndex!;validateProductionRecordIndex(index,companyOf(r),r.orderId!);}catch{row.status='uncertain';row.reason='현재 생산기록 인덱스를 확인해야 합니다.';continue;}
  }
  const pointer=index?.[r.lineId!];
  if(r.supersededBy!==undefined){
   if(!validEntry(r.supersededBy,r)||r.supersededBy.recordId===r.id||sameOrderInventoryGeneration(r.supersededBy.generation,r.generation)){row.status='uncertain';row.reason='이전 처리 표식의 원문이 일치하지 않습니다.';continue;}
   if(pointer&&pointer.recordId===r.id){row.status='uncertain';row.reason='현재 포인터와 이전 처리 표식이 충돌합니다.';continue;}
   row.status='superseded';row.reason='명시된 후속 처리 기록이 있습니다.';continue;
  }
  if(pointer){
   if(pointer.recordId===r.id&&sameOrderInventoryGeneration(pointer.generation,r.generation))continue;
   row.status='superseded';row.reason='같은 주문 줄의 현재 기록이 따로 지정되어 있습니다.';continue;
  }
  if(index){row.status='uncertain';row.reason='현재 인덱스에 이 주문 줄이 없습니다.';continue;}
  const group=groupOf(r);if(!unindexed.has(group))unindexed.set(group,[]);unindexed.get(group)!.push(row);
 }
 for(const rows of unindexed.values())if(rows.length>1)for(const row of rows){row.status='uncertain';row.reason='현재 기록을 지정한 근거 없이 여러 세대가 남아 있습니다.';}
 // 과거 자동 writer 주소는 확인 후보다. 동일한 메모가 수동 수정 여부까지 증명하지는 않는다.
 for(const row of details.filter(detail=>!generated.includes(detail))){
  const r=row.record;
  if(duplicateIds.has(r.id)){row.status='uncertain';row.reason='생산기록 식별자가 중복됩니다.';continue;}
  const collision=generated.some(detail=>validGenerated(detail.record)&&(Array.isArray(detail.record.legacySourceCandidates)?detail.record.legacySourceCandidates:[]).some(candidate=>candidate&&candidate.recordId===r.id&&candidate.companyId===companyOf(r)&&candidate.itemId===r.itemId&&candidate.note===r.note));
  if(collision){row.status='uncertain';row.reason='신규 주문 기록과 주소가 겹치는 과거 기록입니다. 수동 변경 여부를 확인해 주세요.';}
 }
 return {details,currentRecords:details.filter(row=>row.status==='current').map(row=>row.record),uncertainRecords:details.filter(row=>row.status==='uncertain').map(row=>row.record)};
}
