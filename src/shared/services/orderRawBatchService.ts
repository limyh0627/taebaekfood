import {present,orderRawBatchReadsMatch,orderRawBatchProofProblem,orderRawBatchRequestHash} from '../../../functions/src/shared/orderRawBatchProof';
export {orderRawBatchReceiptMatches,readOrderRawBatchJobRequest,orderRawBatchReadsMatch,orderRawBatchProofProblem,orderRawBatchRequestHash} from '../../../functions/src/shared/orderRawBatchProof';
import {runInventoryWriterTransaction,captureInventoryWriterContext} from '../inventoryWriterProtocol';
import {protectInventoryWriterPatch} from '../inventoryWriterProtocol';
import {doc,runTransaction,type Firestore} from 'firebase/firestore';
import {COL} from '../collections';
import {inventoryDocId,type RawApplyResult,type RawInventoryState} from '../rawInventoryCore';
import {advanceOrderInventoryStage,assertOrderInventoryGeneration,hasOrderInventoryGenerationCompletion} from '../orderInventoryGeneration';
import {orderRawBatchAttemptKey,orderRawBatchOrderEvidence,saveOrderRawBatchAttempt,validateOrderRawBatchRequest,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
import {auth,authReady,db} from '../firebase';
import {withClaimCompany} from '../companyWriteBoundary';
import {rawPressText} from '../rawPressAttempt';
import {type Order} from '../types';
import {ownLineIndexEntry,makeOrderProductionRecordReceipt,validateOrderProductionRecordPlan,type OrderProductionRecordPlan} from '../orderProductionRecordPlan';
import {prepareRawCommand,readRawCommandInTransaction,writePreparedRawCommand} from './rawInventoryService';

type Applied=Extract<RawApplyResult,{status:'applied'}>;
export type OrderRawBatchOutcome={status:'committed'|'duplicate'|'rejected'|'blocked';request:OrderRawBatchRequest;results:Applied[];reason?:string};
type Read=Awaited<ReturnType<typeof readRawCommandInTransaction>>;
export type OrderRawBatchRead=Read;
/** 각 대기 경계에서 실제 로그인 UID와 회사를 다시 검증한다. */
export async function executeOrderRawBatchWithDb(database:Firestore,request:OrderRawBatchRequest,assertActor:()=>Promise<void>):Promise<OrderRawBatchOutcome>{
 request=JSON.parse(JSON.stringify(request));
 validateOrderRawBatchRequest(request);await assertActor();
 const requestHash=await orderRawBatchRequestHash(request);await assertActor();
 const outcome=await runInventoryWriterTransaction(database,await captureInventoryWriterContext(database,{requestIdentity:rawPressText(request),companyId:request.generation.companyId,isStillCurrent:async()=>{await assertActor();return true;}}),async tx=>{
  await assertActor();
  const jobRef=doc(database,COL.rawInventoryJobs,request.jobId),orderRef=doc(database,COL.orders,request.generation.orderId);
  const [job,order,...legacy]=await Promise.all([tx.get(jobRef),tx.get(orderRef),...request.legacyJobIds.map(id=>tx.get(doc(database,COL.rawInventoryJobs,id)))]);
  const reads=await Promise.all(request.commands.map(row=>readRawCommandInTransaction(tx,database,row.command)));
  await assertActor();
  const blocked=(reason:string,status:'blocked'|'rejected'='blocked'):OrderRawBatchOutcome=>({status,request,results:[],reason});
  if(!order.exists())return blocked('주문 원문을 찾을 수 없습니다.');
  const live={...order.data(),id:order.id} as Order;
  const finalCompleted=live.inventoryOperation==null&&hasOrderInventoryGenerationCompletion(live,request.generation);
  if(!finalCompleted)try{assertOrderInventoryGeneration(live,request.generation,{allowFailed:true});}catch{return blocked('주문 재고 작업의 최초 세대가 달라졌습니다.');}
  if(!orderRawBatchReadsMatch(request,reads))return blocked('원료 품목·상태의 회사와 식별자를 확인해 주세요.');
  if(job.exists()){
   const data=job.data(),results=data.results as Applied[];
   const problem=orderRawBatchProofProblem(data,request,reads,requestHash);if(problem)return blocked(problem);
   return {status:'duplicate',request,results} as OrderRawBatchOutcome;
  }
  if(finalCompleted)return blocked('최종 완료표에 대응하는 원료 일괄 완료 근거가 없습니다.');
  if(legacy.some(snap=>snap.exists())||reads.some(present))return blocked('기존 부분 처리 근거를 자동으로 보완하지 않았습니다.');
  try{assertOrderInventoryGeneration({...order.data(),id:order.id} as Order,request.generation);}catch{return blocked('실패 잠금은 같은 최초 작업을 승인하여 재개해 주세요.');}
  if(orderRawBatchOrderEvidence({...order.data(),id:order.id} as Order)!==request.business.orderText)return blocked('최초 승인 뒤 주문 품목이나 생산 근거가 바뀌었습니다.');
  const recordPlan=request.plan.productionRecords as OrderProductionRecordPlan|undefined;
  if(recordPlan&&live.inventoryOperation?.productionRecordContractVersion!==1)return blocked('생산기록 최초 계약이 없는 작업에는 새 원료 계획을 적용하지 않았습니다.');
  if(live.inventoryOperation?.productionRecordContractVersion===1&&!recordPlan)return blocked('최초 생산기록 계획이 없어 원료를 쓰지 않았습니다.');
  if(recordPlan){try{validateOrderProductionRecordPlan(recordPlan);if(rawPressText(recordPlan.generation)!==rawPressText(request.generation))throw Error();}catch{return blocked('최초 생산기록 계획의 원문과 세대를 확인해 주세요.');}
   if(rawPressText(live.productionRecordIndex??{})!==rawPressText(recordPlan.previousIndex))return blocked('최초 승인 뒤 생산기록 연결이 바뀌었습니다.');
   const priorCount=recordPlan.records.filter(row=>ownLineIndexEntry(recordPlan.previousIndex,row.lineId)!==undefined).length;
   if(recordPlan.records.length+priorCount+2>500)return blocked('생산기록과 이전 기록 연결의 쓰기 한도를 초과했습니다.','rejected');
  }
  let nextStage:NonNullable<Order['inventoryOperation']>['stage'];try{nextStage=advanceOrderInventoryStage(live.inventoryOperation!.stage,'raw-inventory');}catch{return blocked('원료 일괄 작업 단계를 확인해 주세요.');}
  const virtual=new Map<string,{state:RawInventoryState;itemData:Record<string,any>}>(),results:Applied[]=[];
  for(let index=0;index<request.commands.length;index++){
   const row=request.commands[index],key=inventoryDocId(row.command.companyId,row.command.rawItemId);
   const result=prepareRawCommand(row.command,reads[index],{...row.options,now:request.recordedAt},virtual.get(key));
   if(result.status!=='applied')return blocked(result.status==='rejected'?result.message:'신규 일괄 요청에 기존 영수증이 있습니다.','rejected');
   const itemData={...(virtual.get(key)?.itemData??reads[index].itemSnap.data()!)};
   if(row.command.kind!=='ledger-consume')itemData.stock=result.state.stockKg;
   virtual.set(key,{state:result.state,itemData});results.push(result);
  }
  const saved={id:request.jobId,atomicVersion:1,status:'complete',companyId:request.generation.companyId,actorUid:request.generation.actorUid,
   source:{type:'production',id:request.generation.orderId},createdAt:request.recordedAt,completedAt:request.recordedAt,requestText:rawPressText(request),requestHash,expectedOperationIds:request.commands.map(row=>row.command.operationId),results};
  // 요청과 계산 결과를 함께 담은 최종 문서의 크기를 쓰기 전에 검사한다.
  let serialized:string;try{serialized=JSON.stringify(saved,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('원료 계산 결과가 유한하지 않습니다.');return value;});}catch{return blocked('원료 일괄 계산 결과를 확인해 주세요.','rejected');}
  const reserved=recordPlan?JSON.stringify({...saved,productionRecordReceipt:makeOrderProductionRecordReceipt(recordPlan,requestHash)}):serialized;
  if(new TextEncoder().encode(reserved).byteLength>900_000||request.commands.length*3+2>500)return blocked('원료 일괄 저장 크기 또는 쓰기 한도를 초과했습니다.','rejected');
  await assertActor();
  results.forEach((result,index)=>writePreparedRawCommand(tx,request.commands[index].command,reads[index],result,{...request.commands[index].options,now:request.recordedAt}));
  tx.set(jobRef,protectInventoryWriterPatch(job.exists()?job.data():undefined,JSON.parse(serialized)));
  tx.update(orderRef,protectInventoryWriterPatch(order.data(),{'inventoryOperation.stage':nextStage},['inventoryOperation.stage']));
  return {status:'committed',request,results} as OrderRawBatchOutcome;
 });
 await assertActor();return outcome;
}
/** 최초 승인을 TX 전에 저장한다. 원료 완료만으로 최초 원문을 지우지 않는다. */
export async function executeOrderRawBatch(candidate:OrderRawBatchRequest):Promise<OrderRawBatchOutcome>{
 await authReady;
 let encoded:string|undefined;
 const key=orderRawBatchAttemptKey(candidate.generation.companyId,candidate.generation.actorUid,candidate.generation.orderId);
 const assertActor=async()=>{
  if(encoded!==undefined&&localStorage.getItem(key)!==encoded)throw Error('최초 원료 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');
  const user=auth.currentUser;
  if(!user||user.uid!==candidate.generation.actorUid)throw Error('원료 일괄 요청의 로그인 사용자가 바뀌었습니다. 최초 원문을 보존했습니다.');
  const token=await user.getIdTokenResult();
  if(auth.currentUser?.uid!==user.uid||typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('같은 회사 직원 로그인을 확인해 주세요.');
  withClaimCompany(COL.orders,{companyId:candidate.generation.companyId},{companyId:token.claims.companyId});
  if(encoded!==undefined&&localStorage.getItem(key)!==encoded)throw Error('최초 원료 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');
 };
 await assertActor();const retained=saveOrderRawBatchAttempt(candidate);encoded=retained.encoded;await assertActor();
 return executeOrderRawBatchWithDb(db,retained.request,assertActor);
}
