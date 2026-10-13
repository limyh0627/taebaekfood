import * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {assertReleaseActive,releaseGateRef} from './releaseGate';
import {advanceInventoryWriterProtocol} from './shared/inventoryWriterProtocol';
import {selectOrderRawBatchOrderEvidence,assertArchiveOldGenerationAbsent as assertArchiveGeneration} from './shared/orderRawBatchOrderEvidence';

export const retirementText=(value:any):string=>JSON.stringify(Array.isArray(value)?value.map(row=>JSON.parse(retirementText(row))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(retirementText(value[key]))])):value);
export const retirementHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const retirementIdentity=(g:{companyId:string;orderId:string;operationId:string;startedAt:string;actorUid:string})=>retirementHash(retirementText({companyId:g.companyId,orderId:g.orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid:g.actorUid}));
export interface RetirementInput {requestText:string;requestHash:string;releaseId:string}
export interface RetirementResult {status:'retired'|'duplicate';action:'archived-only'|'allow-new-claim';allowNewClaim:boolean;inventoryApplied:'unknown';requestHash:string;requestText:string;authorizationId:string;retirementId:string;generation:{contractVersion:1;companyId:string;orderId:string;operationId:string;startedAt:string;actorUid:string}}
const deny=(message:string):never=>{throw new HttpsError('failed-precondition',message);};
const docId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=512&&id.trim()===id&&!id.includes('/');
/** 계산 결과를 다시 만들지 않고 최초 저장 계획에 실제 나타난 쓰기 대상만 모은다. */
export function retirementInventoryManifest(request:any):{itemIds:string[];rawItemIds:string[]}{
 const items=new Set<string>(),raws=new Set<string>(),plan=request.plan;
 if(!plan||typeof plan!=='object'||Array.isArray(plan)||!Array.isArray(request.commands))deny('최초 재고 계획의 대상 명세를 확인해 주세요.');
 const item=(id:unknown)=>{if(!docId(id))deny('최초 재고 계획의 품목 ID가 잘못되었습니다.');items.add(id as string);};
 const deltaRows=(rows:any)=>{if(rows===undefined)return;if(!Array.isArray(rows))deny('최초 재고 변화 명세가 잘못되었습니다.');for(const row of rows)item(Array.isArray(row)?row[0]:row?.itemId);};
 for(const key of ['productionDeltas','reservationDeltas','shipmentDeltas'])deltaRows(plan[key]);
 if(plan.finalLotItemIds!==undefined){if(!Array.isArray(plan.finalLotItemIds))deny('최초 로트 대상이 잘못되었습니다.');plan.finalLotItemIds.forEach(item);}
 const productLots=(lots:any)=>{if(lots?.mutationItemIds!==undefined){if(!Array.isArray(lots.mutationItemIds))deny('최초 로트 대상이 잘못되었습니다.');lots.mutationItemIds.forEach(item);}};
 productLots(plan.productLots);
 if(plan.lines!==undefined){if(!Array.isArray(plan.lines))deny('최초 줄 계획이 잘못되었습니다.');for(const row of plan.lines){deltaRows(row.rowDeltas);productLots(row.productLots);}}
 const reservation=plan.finalPlan?.reservation;
 if(reservation)for(const key of ['quantities','stockSnapshot','previousReservations','allocationQuantities'])deltaRows(reservation[key]);
 if(plan.productionRecords?.records!==undefined){if(!Array.isArray(plan.productionRecords.records))deny('최초 생산 대상이 잘못되었습니다.');for(const row of plan.productionRecords.records)item(row.itemId);}
 for(const row of request.commands){const command=row?.command;if(!command||command.companyId!==request.generation.companyId||!docId(command.rawItemId)||!['consume','ledger-consume'].includes(command.kind)||command.source?.id!==request.generation.orderId||!Number.isFinite(command.kg)||command.kg<=0)deny('최초 원료 명령 회사·대상이 다릅니다.');item(command.rawItemId);raws.add(command.rawItemId);}
 if(items.size+raws.size+3>500)deny('최초 재고 대상 명세가 저장 한도를 초과했습니다.');
 return {itemIds:[...items].sort(),rawItemIds:[...raws].sort()};
}
const protocolRevision=(row:any)=>advanceInventoryWriterProtocol(row,{}).inventoryWriteRevision-1;
const assertOwner=(row:any,companyId:string)=>{if(row&&(row.companyId??'taebaek')!==companyId)deny('최초 재고 대상의 회사가 다릅니다.');};
function assertArchiveOldGenerationAbsent(order:any,g:any){
 try{assertArchiveGeneration(order,g);}catch(error){deny(error instanceof Error?error.message:'현재 주문 작업 세대를 확인해 주세요.');}
}
/** 수동 해제의 승인을 보관한다. 효과 조회0을 none 증거로 바꾸지 않는다. */
export async function retireOrderRequest(db:admin.firestore.Firestore,companyId:string,actorUid:string,input:RetirementInput):Promise<RetirementResult>{
 if(!input||typeof input.requestText!=='string'||Buffer.byteLength(input.requestText)>700000||typeof input.requestHash!=='string'||retirementHash(input.requestText)!==input.requestHash||typeof input.releaseId!=='string')throw new HttpsError('invalid-argument','최초 주문 요청의 원문과 해시를 확인해 주세요.');
 let request:any;try{request=JSON.parse(input.requestText);}catch{return deny('최초 주문 요청을 읽을 수 없습니다.');}
 const g=request?.generation;
 if(!g||request.version!==1||g.contractVersion!==1||g.companyId!==companyId||g.actorUid!==actorUid||![g.orderId,g.operationId,g.startedAt,g.actorUid].every(x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=512)||g.orderId.includes('/')||!Number.isFinite(Date.parse(g.startedAt))||retirementText(request)!==input.requestText)deny('퇴역하려는 최초 세대·사용자·원문이 다릅니다.');
 const identity=retirementIdentity({companyId,orderId:g.orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid});
 const authorizationRef=db.collection('orderRequestRetirementAuthorizations').doc(identity),terminalRef=db.collection('orderRequestRetirements').doc(identity),orderRef=db.collection('orders').doc(g.orderId);
 return db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));
  const [order,authorization,terminal]=await tx.getAll(orderRef,authorizationRef,terminalRef);
  const a=authorization.data();
  if(!a||a.version!==1||a.status!=='authorized'||a.reason!=='manual-user-authorized'||a.inventoryApplied!=='unknown'||a.companyId!==companyId||a.actorUid!==actorUid||a.orderId!==g.orderId||a.operationId!==g.operationId||a.startedAt!==g.startedAt||typeof a.backupHash!=='string'||!/^[a-f0-9]{64}$/.test(a.backupHash)||typeof a.expectedOrderText!=='string'||typeof a.expectedOrderHash!=='string'||retirementHash(a.expectedOrderText)!==a.expectedOrderHash)return deny('이 최초 요청의 정확한 수동 해제 승인 기록이 없습니다. 원문을 보존했습니다.');
  const action=a.mode==='archive-only-current-evidence'?'archived-only' as const:'allow-new-claim' as const;
  if(a.mode!==undefined&&!['archive-only-current-evidence','unclaimed-after-unlock'].includes(a.mode))deny('최초 요청의 퇴역 승인 방식이 다릅니다.');
  const base={action,allowNewClaim:action==='allow-new-claim',inventoryApplied:'unknown' as const,requestHash:input.requestHash,requestText:input.requestText,authorizationId:identity,retirementId:identity,generation:g};
  if(action==='archived-only'){
   if(!Number.isSafeInteger(a.revision)||a.revision<1||!order.exists||order.data()?.companyId!==companyId)deny('현재 주문 회사와 활성 퇴역 승인 revision을 확인해 주세요.');
   assertArchiveOldGenerationAbsent(order.data(),g);
  }
  if(terminal.exists){const saved=terminal.data()!;if(saved.status!=='retired'||saved.inventoryApplied!=='unknown'||saved.authorizationId!==identity||saved.requestText!==input.requestText||saved.requestHash!==input.requestHash||saved.companyId!==companyId||saved.actorUid!==actorUid||saved.orderId!==g.orderId||saved.backupHash!==a.backupHash||saved.action!==action||saved.allowNewClaim!==base.allowNewClaim||retirementText(saved.generation)!==retirementText(g))deny('같은 최초 세대에 다른 퇴역 원문이 있습니다.');
   // 새 작업이 소비한 뒤 재등장한 옛 사본은 보관 ACK만 한다. 같은 클릭을 새 효과로 이어가지 않는다.
   if(action==='allow-new-claim'&&(saved.firstClaim||order.data()?.retirementClaimPending!==true||order.data()?.inventoryOperation!=null)){
    if(!order.exists||order.data()?.companyId!==companyId)deny('현재 주문의 회사를 확인해 주세요.');assertArchiveOldGenerationAbsent(order.data(),g);
    return {...base,action:'archived-only',allowNewClaim:false,status:'duplicate'};
   }
   return {...base,status:'duplicate'};
  }
  assertReleaseActive(gate,input.releaseId);
  const live=order.data();
  if(action==='archived-only'){
   if(!order.exists||live?.companyId!==companyId)deny('현재 주문의 회사를 확인해 주세요.');
   assertArchiveOldGenerationAbsent(live,g);
   // 현재 작업은 완료로 추정하지 않는다. 옛 unknown 원문 보관만 하고 현 세대·재고에는 쓰지 않는다.
   tx.create(terminalRef,{...base,status:'retired',companyId,actorUid,orderId:g.orderId,backupHash:a.backupHash,retiredAt:new Date().toISOString(),reason:'manual-user-authorized',mode:a.mode,authorizationRevision:a.revision,currentOrderText:a.currentOrderText,currentOrderHash:a.currentOrderHash,currentOrderVersion:a.currentOrderVersion,currentEvidence:a.currentEvidence,currentQueries:a.currentQueries});
   return {...base,status:'retired'};
  }
  if(!live||live.companyId!==companyId||live.inventoryOperation!=null||retirementText(live)!==a.expectedOrderText||!a.expectedOrderVersion||order.updateTime?.seconds!==a.expectedOrderVersion.seconds||order.updateTime?.nanoseconds!==a.expectedOrderVersion.nanoseconds)deny('수동 해제 뒤 주문이나 작업 세대가 바뀌었습니다. 원문을 보존했습니다.');
  const ids=retirementInventoryManifest(request),manifest:any[]=[];
  for(const itemId of ids.itemIds){
   const itemRef=db.collection('items').doc(itemId),item=await tx.get(itemRef),tomb=await tx.get(db.collection('inventoryWriterDeletions').doc(companyId+'__'+itemId));
   assertOwner(item.data(),companyId);const t=tomb.data();
   if(t&&(t.companyId!==companyId||t.itemId!==itemId||t.inventoryWriterProtocolVersion!==1||!Number.isSafeInteger(t.deletionRevision)||t.deletionRevision<1||t.beforeRevision!==t.lastDeletedItemRevision||!Number.isSafeInteger(t.lastDeletedItemRevision)||t.lastDeletedItemRevision<0))deny('품목 삭제 계보가 다릅니다.');
   manifest.push({collection:'items',id:itemId,existed:item.exists,revision:item.exists?protocolRevision(item.data())+1:null,deletionRevision:t?.deletionRevision??0,deletionFloor:t?.lastDeletedItemRevision??0});
  }
  for(const rawItemId of ids.rawItemIds){const state=await tx.get(db.collection('rawInventories').doc(companyId+'__'+rawItemId));assertOwner(state.data(),companyId);if(state.exists&&state.data()?.rawItemId!==rawItemId)deny('원료 상태 대상이 다릅니다.');manifest.push({collection:'rawInventories',id:companyId+'__'+rawItemId,rawItemId,existed:state.exists,revision:state.exists?protocolRevision(state.data())+1:null});}
  // 물리량은 그대로 두고 최초 snapshot의 봉쇄 revision만 한 번 올린다.
  for(const row of manifest)if(row.existed)tx.update(db.collection(row.collection).doc(row.id),{inventoryWriterProtocolVersion:1,inventoryWriteRevision:row.revision});
  tx.update(orderRef,advanceInventoryWriterProtocol(live,{retirementId:identity,retirementClaimPending:true}));
  tx.create(terminalRef,{...base,status:'retired',companyId,actorUid,orderId:g.orderId,backupHash:a.backupHash,manifest,retiredAt:new Date().toISOString(),reason:'manual-user-authorized'});
  return {...base,status:'retired'};
 });
}
export const retireOrderRequestCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const companyId=request.auth.token.companyId;
 if(!['taebaek','punghoe'].includes(companyId)||typeof request.auth.token.employeeId!=='string'||!request.auth.token.employeeId.trim())throw new HttpsError('permission-denied','현재 회사 직원만 최초 요청을 확인할 수 있습니다.');
 return retireOrderRequest(admin.firestore(),companyId,request.auth.uid,request.data as RetirementInput);
});

/** 완료된 첫 claim을 새 세대에 다시 설치하지 않는다. */
function exactClaimCompletion(order:any,g:any):boolean{
 const marker=order.inventoryGenerationCompletion;
 try{
  const request=JSON.parse(marker.requestText);
  return order.inventoryOperation==null&&retirementText(marker.generation)===retirementText(g)&&retirementText(request.generation)===retirementText(g)
   &&retirementText(request)===marker.requestText&&Array.isArray(request.deltas)&&request.deltas.every((row:any)=>Array.isArray(row)&&row.length===2&&docId(row[0])&&Number.isFinite(row[1]))
   &&Array.isArray(request.lotItemIds)&&request.lotItemIds.every(docId)&&request.patch&&typeof request.patch==='object'&&!Array.isArray(request.patch)
   &&Array.isArray(marker.consumedLots)&&marker.consumedLots.every((row:any)=>docId(row.itemId)&&docId(row.lotId)&&Number.isFinite(row.qty)&&row.qty>0)
   &&retirementText(marker.consumedLots)===marker.consumedLotsText&&typeof marker.completedAt==='string'&&Number.isFinite(Date.parse(marker.completedAt));
 }catch{return false;}
}
export async function claimRetiredOrderInventoryOperation(db:admin.firestore.Firestore,companyId:string,actorUid:string,input:RetirementInput){
 if(!input||typeof input.requestText!=='string'||Buffer.byteLength(input.requestText)>700000||retirementHash(input.requestText)!==input.requestHash)deny('첫 재고 claim 원문과 해시를 확인해 주세요.');
 let request:any;try{request=JSON.parse(input.requestText);}catch{return deny('첫 재고 claim 원문을 읽을 수 없습니다.');}
 const op=request?.operation;
 if(request.version!==1||request.companyId!==companyId||request.actorUid!==actorUid||!docId(request.orderId)||!/^[a-f0-9]{64}$/.test(request.retirementId??'')||typeof request.orderText!=='string'||typeof request.expectedStatus!=='string'
  ||!op||op.contractVersion!==1||op.productionRecordContractVersion!==1||op.actorUid!==actorUid||!docId(op.id)||typeof op.startedAt!=='string'||!Number.isFinite(Date.parse(op.startedAt))||op.state!=='processing'||!['line','status'].includes(op.kind)||op.kind==='line'&&!docId(op.lineId)||typeof op.actor!=='string'||!op.actor.trim()||typeof op.targetStatus!=='string'||!op.targetStatus||op.stage!==undefined&&op.stage!=='claim'
  ||Object.keys(op).some(key=>!['id','startedAt','actor','actorUid','contractVersion','productionRecordContractVersion','kind','lineId','targetStatus','state','stage'].includes(key))||retirementText(request)!==input.requestText)deny('첫 재고 claim의 회사·사용자·업무 원문이 다릅니다.');
 const g={contractVersion:1,companyId,orderId:request.orderId,operationId:op.id,startedAt:op.startedAt,actorUid};
 const orderRef=db.collection('orders').doc(request.orderId),terminalRef=db.collection('orderRequestRetirements').doc(request.retirementId);
 return db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));
  const [order,terminal]=await tx.getAll(orderRef,terminalRef),saved=terminal.data()??{},live=order.data()??{};
  if(!order.exists||!terminal.exists||live.companyId!==companyId||live.retirementId!==request.retirementId||!saved||saved.status!=='retired'||saved.inventoryApplied!=='unknown'||saved.action!=='allow-new-claim'||saved.allowNewClaim!==true||saved.companyId!==companyId||saved.actorUid!==actorUid||saved.orderId!==request.orderId||saved.retirementId!==request.retirementId||saved.generation?.operationId===op.id)deny('퇴역 승인과 첫 재고 claim의 회사·사용자·세대가 다릅니다.');
  const ack=(status:'claimed'|'duplicate',row:any)=>({status,retirementId:request.retirementId,requestText:input.requestText,requestHash:input.requestHash,generation:g,order:{...row,id:request.orderId}});
  if(saved.firstClaim){
   if(saved.firstClaim.requestText!==input.requestText||saved.firstClaim.requestHash!==input.requestHash||saved.consumedBy!==op.id||retirementText(saved.firstClaim.generation)!==retirementText(g))deny('퇴역 뒤 이미 다른 최초 claim이 저장되었습니다.');
   const current=live.inventoryOperation;
   const currentGeneration=current?.contractVersion===1?{contractVersion:1,companyId,orderId:request.orderId,operationId:current.id,startedAt:current.startedAt,actorUid:current.actorUid}:null;
   if(live.retirementClaimPending===false&&(currentGeneration&&retirementText(currentGeneration)===retirementText(g)&&['processing','failed'].includes(current.state)||exactClaimCompletion(live,g)))return ack('duplicate',live);
   deny('첫 claim 이후 세대가 바뀌었습니다. 옛 claim을 다시 설치하지 않았습니다.');
  }
  assertReleaseActive(gate,input.releaseId);
  if(live.retirementClaimPending!==true||live.inventoryOperation!=null||live.inventoryGenerationCompletion||live.status!==request.expectedStatus||selectOrderRawBatchOrderEvidence({...live,id:request.orderId},retirementText)!==request.orderText)deny('첫 claim 전에 주문 업무·잠금·완료 세대가 바뀌었습니다.');
  if(!Array.isArray(saved.manifest))deny('퇴역 최초 재고 대상 명세가 없습니다.');
  for(const row of saved.manifest){
   if(!['items','rawInventories'].includes(row.collection)||!docId(row.id))deny('퇴역 재고 대상 명세가 다릅니다.');
   const current=await tx.get(db.collection(row.collection).doc(row.id)),value=current.data();assertOwner(value,companyId);
   if(row.collection==='rawInventories'){
    if(current.exists&&(value?.rawItemId!==row.rawItemId||value?.inventoryWriterProtocolVersion!==1||protocolRevision(value)<(row.revision??1))||!current.exists&&row.existed)deny('원료 상태의 퇴역 뒤 계보가 다릅니다.');
    continue;
   }
   const tomb=await tx.get(db.collection('inventoryWriterDeletions').doc(companyId+'__'+row.id)),t=tomb.data();
   if(t&&(t.companyId!==companyId||t.itemId!==row.id||t.inventoryWriterProtocolVersion!==1||!Number.isSafeInteger(t.deletionRevision)||t.deletionRevision<(row.deletionRevision??0)||!Number.isSafeInteger(t.lastDeletedItemRevision)||t.lastDeletedItemRevision<(row.deletionFloor??0)||t.beforeRevision!==t.lastDeletedItemRevision||t.deletionRevision===row.deletionRevision&&t.lastDeletedItemRevision!==row.deletionFloor))deny('품목 삭제 계보가 다릅니다.');
   if(current.exists){
    if(value?.inventoryWriterProtocolVersion!==1||protocolRevision(value)<(row.revision??1)||(t?.deletionRevision??0)>(row.deletionRevision??0)&&protocolRevision(value)<=t!.lastDeletedItemRevision)deny('품목 재생성의 퇴역 뒤 계보가 다릅니다.');
   }else if(row.existed&&(!t||t.deletionRevision<=(row.deletionRevision??0)||t.lastDeletedItemRevision<row.revision))deny('품목 소실의 정확한 삭제 계보가 없습니다.');
  }
  const patch=advanceInventoryWriterProtocol(live,{inventoryOperation:{...op,stage:'claim'},retirementClaimPending:false});
  tx.update(orderRef,patch);
  tx.update(terminalRef,{firstClaim:{requestText:input.requestText,requestHash:input.requestHash,generation:g,claimedAt:new Date().toISOString()},consumedBy:op.id});
  return ack('claimed',{...live,...patch});
 });
}
export const claimRetiredOrderInventoryOperationCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const companyId=request.auth.token.companyId;
 if(!['taebaek','punghoe'].includes(companyId)||typeof request.auth.token.employeeId!=='string'||!request.auth.token.employeeId.trim())throw new HttpsError('permission-denied','현재 회사 직원만 첫 재고 작업을 시작할 수 있습니다.');
 return claimRetiredOrderInventoryOperation(admin.firestore(),companyId,request.auth.uid,request.data as RetirementInput);
});

