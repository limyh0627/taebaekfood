import {doc,runTransaction,type Firestore} from 'firebase/firestore';
import {COL} from '../collections';
import {auth,authReady,db} from '../firebase';
import {withClaimCompany} from '../companyWriteBoundary';
import {companyOf,type Order} from '../types';
import {advanceOrderInventoryStage,assertOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,sameOrderInventoryGeneration} from '../orderInventoryGeneration';
import {orderRawBatchAttemptKey,orderRawBatchJobId,orderRawBatchOrderEvidence,readOrderRawBatchAttempt,validateOrderRawBatchRequest,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
import {deriveNextProductionRecordIndex,makeOrderProductionRecordReceipt,validateOrderProductionRecordPlan,type OrderProductionRecordPlan} from '../orderProductionRecordPlan';
import {rawPressText} from '../rawPressAttempt';
import {readRawCommandInTransaction} from './rawInventoryService';
import {orderRawBatchProofProblem,orderRawBatchRequestHash} from './orderRawBatchService';

export type OrderProductionRecordOutcome={status:'recorded'|'duplicate'|'acknowledged'|'blocked';recordIds:string[];historyChanged?:boolean;reason?:string};
export function productionRecordPlanFromRawRequest(request:OrderRawBatchRequest):OrderProductionRecordPlan{
 validateOrderRawBatchRequest(request);
 const plan=request.plan.productionRecords as OrderProductionRecordPlan;
 if(!plan)throw Error('이전 작업의 최초 생산기록 계획이 없습니다. 원문을 새로 추정하지 않았습니다.');
 validateOrderProductionRecordPlan(plan);
 if(!sameOrderInventoryGeneration(plan.generation,request.generation))throw Error('생산기록 계획의 최초 주문 세대가 다릅니다.');
 return plan;
}
/** 생산기록 전체와 완료 근거를 함께 쓴다. 부분 문서를 기존 성공으로 추정해 채우지 않는다. */
export async function executeOrderProductionRecordsWithDb(database:Firestore,request:OrderRawBatchRequest,assertActor:()=>Promise<void>):Promise<OrderProductionRecordOutcome>{
 const plan=productionRecordPlanFromRawRequest(request);await assertActor();
 const requestHash=await orderRawBatchRequestHash(request),expectedReceipt=makeOrderProductionRecordReceipt(plan,requestHash);await assertActor();
 const nextIndex=deriveNextProductionRecordIndex(plan,requestHash);
 const priorRows=plan.records.flatMap(record=>{const entry=plan.previousIndex[record.lineId];return entry?[{record,entry}]:[];});
 const recordIds=expectedReceipt.recordIds,productIds=[...new Set(plan.records.map(record=>record.itemId))];
 const outcome=await runTransaction(database,async tx=>{
  await assertActor();
  const jobRef=doc(database,COL.rawInventoryJobs,request.jobId),orderRef=doc(database,COL.orders,request.generation.orderId);
  const [jobSnap,orderSnap]=await Promise.all([tx.get(jobRef),tx.get(orderRef)]);
  if(!jobSnap.exists()||!orderSnap.exists())return {status:'blocked',recordIds,reason:'원료 완료와 주문 원문을 확인할 수 없습니다.'} as OrderProductionRecordOutcome;
  const order={...orderSnap.data(),id:orderSnap.id} as Order;
  const completed=order.inventoryOperation==null&&hasOrderInventoryGenerationCompletion(order,request.generation);
  const [rawReads,recordSnaps,productSnaps,priorSnaps,priorJobs]=await Promise.all([
   Promise.all(request.commands.map(row=>readRawCommandInTransaction(tx,database,row.command))),
   Promise.all(recordIds.map(id=>tx.get(doc(database,COL.productionRecords,id)))),
   completed?Promise.resolve([]):Promise.all(productIds.map(id=>tx.get(doc(database,COL.items,id)))),
   completed?Promise.resolve([]):Promise.all(priorRows.map(row=>tx.get(doc(database,COL.productionRecords,row.entry.recordId)))),
   completed?Promise.resolve([]):Promise.all(priorRows.map(row=>tx.get(doc(database,COL.rawInventoryJobs,orderRawBatchJobId(row.entry.generation))))),
  ]);await assertActor();
  const blocked=(reason:string):OrderProductionRecordOutcome=>({status:'blocked',recordIds,reason});
  const problem=orderRawBatchProofProblem(jobSnap.data(),request,rawReads,requestHash);if(problem)return blocked(problem);
  if(!completed){
   try{assertOrderInventoryGeneration(order,request.generation,{allowFailed:true});}catch{return blocked('생산기록 저장 전에 주문 작업의 세대가 바뀌었습니다.');}
   if(order.inventoryOperation?.productionRecordContractVersion!==1)return blocked('이전 작업에는 최초 생산기록 계약이 없습니다. 원문을 보존했습니다.');
  }
  if(productSnaps.some(snap=>!snap.exists()||companyOf(snap.data())!==request.generation.companyId))return blocked('생산기록 품목의 회사를 확인해 주세요.');
  const exact=recordSnaps.every((snap,index)=>snap.exists()&&rawPressText(snap.data())===rawPressText(plan.records[index]));
  const savedReceipt=jobSnap.data().productionRecordReceipt;
  if(savedReceipt!==undefined){
   if(rawPressText(savedReceipt)!==rawPressText(expectedReceipt))return blocked('생산기록 완료 근거가 최초 계획과 다릅니다.');
   if(completed)return {status:'acknowledged',recordIds,historyChanged:!exact} as OrderProductionRecordOutcome;
   if(!Object.prototype.hasOwnProperty.call(order,'productionRecordIndex')||order.productionRecordIndex===undefined||rawPressText(order.productionRecordIndex)!==rawPressText(nextIndex))return blocked('생산기록 완료 연결이 최초 확정 원문과 다릅니다.');
   if(priorRows.some((row,index)=>priorSnaps[index].exists()&&rawPressText(priorSnaps[index].data().supersededBy)!==rawPressText(nextIndex[row.record.lineId])))return blocked('이전 생산기록의 대체 완료 연결이 다릅니다.');
   if(!exact)return blocked('확정 후 생산기록이 수정되거나 삭제됐습니다. 자동으로 다시 만들지 않았습니다.');
   return {status:'duplicate',recordIds} as OrderProductionRecordOutcome;
  }
  if(completed)return blocked('최종 완료표에 대응하는 생산기록 완료 근거가 없습니다.');
  if(recordSnaps.some(snap=>snap.exists()))return blocked('생산기록 일부가 먼저 존재합니다. 최초 완료 근거 없이 자동 보완하지 않았습니다.');
  try{assertOrderInventoryGeneration(order,request.generation);}catch{return blocked('실패 작업은 최초 계정과 요청으로 승인하여 재개해 주세요.');}
  if(orderRawBatchOrderEvidence(order)!==request.business.orderText)return blocked('최초 승인 뒤 주문 품목이나 생산 근거가 바뀌었습니다.');
  if(rawPressText(order.productionRecordIndex??{})!==rawPressText(plan.previousIndex))return blocked('최초 승인 뒤 생산기록 연결이 바뀌었습니다.');
  for(let index=0;index<priorRows.length;index++){
   const {record,entry}=priorRows[index],prior=priorSnaps[index],priorJob=priorJobs[index];
   const priorData=priorJob.exists()?priorJob.data():undefined,receipt=priorData?.productionRecordReceipt;
   if(!priorData||priorData.atomicVersion!==1||priorData.status!=='complete'||priorData.companyId!==plan.generation.companyId||priorData.id!==orderRawBatchJobId(entry.generation)||priorData.requestHash!==entry.requestHash||!sameOrderInventoryGeneration(priorData.request?.generation,entry.generation)||!receipt||receipt.requestHash!==entry.requestHash||!sameOrderInventoryGeneration(receipt.generation,entry.generation)||!Array.isArray(receipt.recordIds)||!receipt.recordIds.includes(entry.recordId))return blocked('이전 생산기록의 원래 완료 근거를 확인할 수 없습니다.');
   try{
    const priorPlan=productionRecordPlanFromRawRequest(priorData.request);
    if(await orderRawBatchRequestHash(priorData.request)!==entry.requestHash||rawPressText(makeOrderProductionRecordReceipt(priorPlan,entry.requestHash))!==rawPressText(receipt)||!priorPlan.records.some(row=>row.id===entry.recordId&&row.lineId===record.lineId))return blocked('이전 생산기록의 최초 원문과 완료 근거가 다릅니다.');
   }catch{return blocked('이전 생산기록의 최초 원문을 확인할 수 없습니다.');}
   if(prior.exists()){
    const data=prior.data();
    if(data.id!==entry.recordId||data.companyId!==plan.generation.companyId||data.orderId!==plan.generation.orderId||data.lineId!==record.lineId||!sameOrderInventoryGeneration(data.generation,entry.generation)||data.supersededBy!==undefined)return blocked('이전 생산기록의 회사·줄·세대 연결을 확인해 주세요.');
   }
  }
  let stage:NonNullable<Order['inventoryOperation']>['stage'];try{stage=advanceOrderInventoryStage(order.inventoryOperation!.stage,'production-record');}catch{return blocked('생산기록 저장 단계를 확인해 주세요.');}
  const serialized=JSON.stringify({...jobSnap.data(),productionRecordReceipt:expectedReceipt});
  if(new TextEncoder().encode(serialized).byteLength>900_000||recordIds.length+priorRows.length+2>500)return blocked('생산기록과 완료 근거의 저장 한도를 초과했습니다.');
  await assertActor();
  plan.records.forEach(record=>tx.set(doc(database,COL.productionRecords,record.id),record));
  priorRows.forEach((row,index)=>{if(priorSnaps[index].exists())tx.update(doc(database,COL.productionRecords,row.entry.recordId),{supersededBy:nextIndex[row.record.lineId]});});
  tx.update(jobRef,{productionRecordReceipt:expectedReceipt});
  tx.update(orderRef,{'inventoryOperation.stage':stage,productionRecordIndex:nextIndex});
  return {status:'recorded',recordIds} as OrderProductionRecordOutcome;
 });await assertActor();return outcome;
}
/** raw 최초 원문을 다시 만들지 않는다. 응답 유실도 같은 키와 저장 원문으로만 확인한다. */
export async function executeOrderProductionRecords(request:OrderRawBatchRequest):Promise<OrderProductionRecordOutcome>{
 await authReady;productionRecordPlanFromRawRequest(request);
 const g=request.generation,retained=readOrderRawBatchAttempt(g.companyId,g.actorUid,g.orderId);
 if(!retained||rawPressText(retained.request)!==rawPressText(request))throw Error('최초 원료·생산기록 요청이 없습니다. 원문을 보존해 주세요.');
 const key=orderRawBatchAttemptKey(g.companyId,g.actorUid,g.orderId);
 const assertActor=async()=>{
  if(localStorage.getItem(key)!==retained.encoded)throw Error('최초 생산기록 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');
  const user=auth.currentUser;if(!user||user.uid!==g.actorUid)throw Error('최초 생산기록 요청의 로그인 사용자가 바뀌었습니다.');
  const token=await user.getIdTokenResult();
  if(auth.currentUser?.uid!==g.actorUid||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('같은 회사 직원 로그인을 확인해 주세요.');
  withClaimCompany(COL.orders,{companyId:g.companyId},{companyId:token.claims.companyId});
  if(localStorage.getItem(key)!==retained.encoded)throw Error('최초 생산기록 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');
 };
 await assertActor();return executeOrderProductionRecordsWithDb(db,request,assertActor);
}
