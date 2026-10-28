import {commandHash,operationDocId,type RawApplyResult} from './rawInventoryCore';
import {normalizeRawMovement} from './rawInventoryDocument';
import {companyOf} from './orderProductionRecordPlan';
import {rawPressText} from './orderPlanPrimitives';
import {validateOrderRawBatchRequest,type OrderRawBatchRequest} from './orderRawBatchIdentity';
type Applied=Extract<RawApplyResult,{status:'applied'}>;
type Snapshot={exists():boolean;data():Record<string,any>|undefined};
export type OrderRawBatchProofRead={movementSnap:Snapshot;oldMovementSnap:Snapshot|null;stateSnap:Snapshot;itemSnap:Snapshot};
export const present=(read:OrderRawBatchProofRead)=>read.movementSnap.exists()||!!read.oldMovementSnap?.exists();
const receipt=(read:OrderRawBatchProofRead)=>normalizeRawMovement((read.movementSnap.exists()?read.movementSnap:read.oldMovementSnap)!.data()!);
/** 옛 화면용 추가 칸은 제외하고 실제 적용·로트·순번 근거를 대조한다. 표시명 변경은 재개를 막지 않는다. */
export function orderRawBatchReceiptMatches(request:OrderRawBatchRequest,index:number,read:OrderRawBatchProofRead,result:Applied):boolean{
 const c=request.commands[index]?.command;if(!c||!present(read)||read.movementSnap.exists()&&read.oldMovementSnap?.exists())return false;
 const m=receipt(read),expected=-Math.round(('kg' in c?c.kg:NaN)*1000)/1000;
 const saved=result.movement;
 return m.id===operationDocId(c.operationId)&&m.companyId===c.companyId&&m.rawItemId===c.rawItemId&&m.operationId===c.operationId&&m.kind===c.kind&&m.effectiveAt===c.effectiveAt
  &&m.source?.type===c.source.type&&m.source.id===c.source.id&&m.commandHash===commandHash(c)&&m.reportedDeltaKg===expected
  &&Number.isFinite(m.appliedDeltaKg)&&(m.appliedDeltaKg===0||m.appliedDeltaKg===expected)
  &&m.recordedAt===request.recordedAt&&Number.isSafeInteger(m.sequence)&&m.sequence>0&&Number.isFinite(m.balanceAfterKg)
  &&saved.id===m.id&&saved.operationId===m.operationId&&saved.companyId===m.companyId&&saved.rawItemId===m.rawItemId&&saved.kind===m.kind
  &&saved.effectiveAt===m.effectiveAt&&rawPressText(saved.source)===rawPressText(m.source)
  &&rawPressText({recordedAt:m.recordedAt,sequence:m.sequence,balanceAfterKg:m.balanceAfterKg,lotChanges:m.lotChanges,backdatedBeforeStocktake:!!m.backdatedBeforeStocktake})
   ===rawPressText({recordedAt:result.movement.recordedAt,sequence:result.movement.sequence,balanceAfterKg:result.movement.balanceAfterKg,lotChanges:result.movement.lotChanges,backdatedBeforeStocktake:!!result.movement.backdatedBeforeStocktake})
  &&result.movement.commandHash===m.commandHash&&result.movement.reportedDeltaKg===m.reportedDeltaKg&&result.movement.appliedDeltaKg===m.appliedDeltaKg;
}
export const orderRawBatchRequestHash=async(request:OrderRawBatchRequest)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawPressText(request)))),byte=>byte.toString(16).padStart(2,'0')).join('');
/** 예약 Map의 tuple은 Firestore 중첩 배열 금지에 걸린다. 원문·해시는 바꾸지 않고 저장 형식만 분리한다. */
export function readOrderRawBatchJobRequest(data:Record<string,any>):OrderRawBatchRequest {
 const hasText=Object.prototype.hasOwnProperty.call(data,'requestText');
 const request=hasText?(typeof data.requestText==='string'?JSON.parse(data.requestText):undefined):data.request;
 validateOrderRawBatchRequest(request);
 if(hasText&&rawPressText(request)!==data.requestText)throw Error('원료 일괄 저장 원문의 문자열 근거가 다릅니다.');
 if(hasText&&Object.prototype.hasOwnProperty.call(data,'request')&&rawPressText(data.request)!==rawPressText(request))throw Error('원료 일괄 저장의 옛·새 원문이 다릅니다.');
 return request;
}
/** 원료 완료와 생산기록 소비가 같은 회사·상태·모든 영수증 판정을 쓴다. */
export function orderRawBatchReadsMatch(request:OrderRawBatchRequest,reads:readonly OrderRawBatchProofRead[]):boolean{
 return reads.length===request.commands.length&&!reads.some((read,index)=>!read.itemSnap.exists()||companyOf(read.itemSnap.data())!==request.generation.companyId
  ||read.stateSnap.exists()&&(read.stateSnap.data()?.companyId!==request.generation.companyId||read.stateSnap.data()?.rawItemId!==request.commands[index].command.rawItemId));
}
export function orderRawBatchProofProblem(data:Record<string,any>,request:OrderRawBatchRequest,reads:readonly OrderRawBatchProofRead[],requestHash:string):string|null{
 const results=data.results as Applied[];
 let savedRequest:OrderRawBatchRequest;try{savedRequest=readOrderRawBatchJobRequest(data);}catch{return '원료 일괄 저장 원문을 확인해 주세요.';}
 if(!orderRawBatchReadsMatch(request,reads))return '원료 품목·상태의 회사와 식별자를 확인해 주세요.';
 if(data.atomicVersion!==1||data.status!=='complete'||data.companyId!==request.generation.companyId||data.actorUid!==request.generation.actorUid
  ||data.id!==request.jobId||data.source?.type!=='production'||data.source.id!==request.generation.orderId||data.createdAt!==request.recordedAt||data.completedAt!==request.recordedAt
  ||data.requestHash!==requestHash||rawPressText(data.expectedOperationIds)!==rawPressText(request.commands.map(row=>row.command.operationId))
  ||rawPressText(savedRequest)!==rawPressText(request)||!Array.isArray(results)||results.length!==request.commands.length
  ||results.some((result,index)=>result?.status!=='applied'||!orderRawBatchReceiptMatches(request,index,reads[index],result)))return '원료 일괄 완료 원문과 모든 영수증을 확인해 주세요.';
 return null;
}
