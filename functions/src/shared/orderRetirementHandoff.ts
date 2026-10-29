import * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {assertReleaseActive,releaseGateRef} from '../releaseGate';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {selectOrderRawBatchOrderEvidence} from './orderRawBatchOrderEvidence';

export const retirementText=(value:any):string=>JSON.stringify(Array.isArray(value)?value.map(row=>JSON.parse(retirementText(row))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(retirementText(value[key]))])):value);
export const retirementHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const retirementIdentity=(g:{companyId:string;orderId:string;operationId:string;startedAt:string;actorUid:string})=>retirementHash(retirementText({companyId:g.companyId,orderId:g.orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid:g.actorUid}));
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

/** 기존 첫 claim의 조회 순서와 삭제 계보 검사를 공통으로 쓴다. */
export async function validateRetirementManifest(tx:admin.firestore.Transaction,db:admin.firestore.Firestore,companyId:string,manifest:unknown):Promise<void>{
  if(!Array.isArray(manifest))return deny('퇴역 최초 재고 대상 명세가 없습니다.');
  for(const row of manifest){
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
}

export interface RetirementStaticSource {companyId:string;actorUid:string;orderId:string;retirementId:string;saved:any;authorization:any;terminalExists:boolean;authorizationExists:boolean}
/** 정적 원문 관계만 확인한다. 실제 같은 거래의 snapshot 연결은 reader가 맡는다. */
export function assertRetirementStaticProof(source:RetirementStaticSource,mode:'fresh'|'historical'):void {
 const {companyId,actorUid,orderId,retirementId,saved,authorization:a,terminalExists,authorizationExists}=source;
 if(!terminalExists||!saved||saved.status!=='retired'||saved.inventoryApplied!=='unknown'||saved.action!=='allow-new-claim'||saved.allowNewClaim!==true||saved.companyId!==companyId||saved.actorUid!==actorUid||saved.orderId!==orderId||saved.retirementId!==retirementId||saved.authorizationId!==retirementId||mode==='fresh'&&(Object.prototype.hasOwnProperty.call(saved,'firstClaim')||Object.prototype.hasOwnProperty.call(saved,'firstConsumer')))return deny('퇴역 근거 또는 최초 소비 상태를 확인해 주세요.');
 const g=saved.generation;
 if(!g||g.contractVersion!==1||g.companyId!==companyId||g.actorUid!==actorUid||g.orderId!==orderId||(typeof g.operationId!=='string'||!g.operationId||g.operationId.trim()!==g.operationId||g.operationId.length>512)||typeof g.startedAt!=='string'||!Number.isFinite(Date.parse(g.startedAt))||retirementIdentity(g)!==retirementId)deny('퇴역 최초 세대가 다릅니다.');
 if(typeof saved.requestText!=='string'||typeof saved.requestHash!=='string'||retirementHash(saved.requestText)!==saved.requestHash)deny('퇴역 최초 원문과 해시가 다릅니다.');
 let request:any;try{request=JSON.parse(saved.requestText);}catch{return deny('퇴역 최초 원문을 읽을 수 없습니다.');}
 if(retirementText(request)!==saved.requestText||request.version!==1||retirementText(request.generation)!==retirementText(g))deny('퇴역 최초 원문과 세대가 다릅니다.');
 if(!authorizationExists||!a||a.version!==1||a.status!=='authorized'||a.reason!=='manual-user-authorized'||a.inventoryApplied!=='unknown'||a.companyId!==companyId||a.actorUid!==actorUid||a.orderId!==orderId||a.operationId!==g.operationId||a.startedAt!==g.startedAt||!['unclaimed-after-unlock',undefined].includes(a.mode)||typeof a.backupHash!=='string'||!/^[a-f0-9]{64}$/.test(a.backupHash)||a.backupHash!==saved.backupHash||typeof a.expectedOrderText!=='string'||typeof a.expectedOrderHash!=='string'||retirementHash(a.expectedOrderText)!==a.expectedOrderHash||!a.expectedOrderVersion||!Number.isSafeInteger(a.expectedOrderVersion.seconds)||!Number.isInteger(a.expectedOrderVersion.nanoseconds)||a.expectedOrderVersion.nanoseconds<0||a.expectedOrderVersion.nanoseconds>=1000000000)return deny('퇴역 수동 승인과 백업 근거가 다릅니다.');
 if(!Array.isArray(saved.manifest)||saved.manifest.some((row:any)=>!row||typeof row!=='object'||Array.isArray(row)))return deny('퇴역 최초 재고 대상 명세가 없습니다.');
 const targets=retirementInventoryManifest(request),expected=[...targets.itemIds.map(id=>({collection:'items',id})),...targets.rawItemIds.map(rawItemId=>({collection:'rawInventories',id:companyId+'__'+rawItemId,rawItemId}))];
 if(saved.manifest.length!==expected.length||saved.manifest.some((row:any,index:number)=>row.collection!==expected[index].collection||row.id!==expected[index].id||('rawItemId' in expected[index]&&row.rawItemId!==expected[index].rawItemId)||typeof row.existed!=='boolean'||(row.existed?(!Number.isSafeInteger(row.revision)||row.revision<1):row.revision!==null)||(row.collection==='items'&&(!Number.isSafeInteger(row.deletionRevision)||row.deletionRevision<0||!Number.isSafeInteger(row.deletionFloor)||row.deletionFloor<0))))return deny('퇴역 최초 재고 대상 명세가 다릅니다.');
}

export interface RetirementHandoffInput {companyId:string;actorUid:string;orderId:string;retirementId:string;releaseId:string;expectedOrderEvidence:string}
export interface RetirementHandoffProof {
 version:1;companyId:string;actorUid:string;orderId:string;retirementId:string;terminalRequestHash:string;backupHash:string;
 originalGenerationIdentity:{companyId:string;orderId:string;operationId:string;startedAt:string;actorUid:string};
 orderSnapshot:admin.firestore.DocumentSnapshot;terminalSnapshot:admin.firestore.DocumentSnapshot;
}
/** 같은 거래 안에서만 소비할 근거다. 이 함수는 업무 문서를 쓰지 않는다. */
export async function readRetirementHandoff(tx:admin.firestore.Transaction,db:admin.firestore.Firestore,input:RetirementHandoffInput):Promise<RetirementHandoffProof>{
 const {companyId,actorUid,orderId,retirementId,releaseId,expectedOrderEvidence}=input;
 if(!['taebaek','punghoe'].includes(companyId)||(typeof actorUid!=='string'||!actorUid||actorUid.trim()!==actorUid||actorUid.length>512)||!docId(orderId)||typeof retirementId!=='string'||!/^[a-f0-9]{64}$/.test(retirementId)||typeof releaseId!=='string'||!releaseId||typeof expectedOrderEvidence!=='string')deny('퇴역 인계의 회사·사용자·주문 참조를 확인해 주세요.');
 const gate=await tx.get(releaseGateRef(db));
 const [order,terminal,authorization]=await tx.getAll(db.collection('orders').doc(orderId),db.collection('orderRequestRetirements').doc(retirementId),db.collection('orderRequestRetirementAuthorizations').doc(retirementId));
 assertReleaseActive(gate,releaseId);
 const live=order.data(),saved:any=terminal.data(),a:any=authorization.data();
 if(!order.exists||!live||live.companyId!==companyId||live.retirementId!==retirementId||live.retirementClaimPending!==true||live.inventoryOperation!=null||live.inventoryGenerationCompletion||selectOrderRawBatchOrderEvidence({...live,id:orderId},retirementText)!==expectedOrderEvidence)deny('퇴역 뒤 현재 주문의 업무·잠금·완료 세대가 다릅니다.');
 assertRetirementStaticProof({companyId,actorUid,orderId,retirementId,saved,authorization:a,terminalExists:terminal.exists,authorizationExists:authorization.exists},'fresh');
 const g=saved.generation;
 await validateRetirementManifest(tx,db,companyId,saved.manifest);
 return {version:1,companyId,actorUid,orderId,retirementId,terminalRequestHash:saved.requestHash,backupHash:a.backupHash,originalGenerationIdentity:{companyId,orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid},orderSnapshot:order,terminalSnapshot:terminal};
}



/** 완료된 첫 claim을 새 세대에 다시 설치하지 않는다. */
export function exactClaimCompletion(order:any,g:any):boolean{
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
