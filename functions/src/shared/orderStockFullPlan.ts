import type {FullReference} from './orderStockFullCommand';
import {rawReverseReportedDelta,rawReverseLotDeltas,rawAppliedDelta,commandHash} from './rawInventoryCore';
import {orderRawBatchJobId,type OrderRawBatchRequest} from './orderRawBatchIdentity';
import {readOrderRawBatchJobRequest,orderRawBatchProofProblem,orderRawBatchRequestHash} from './orderRawBatchProof';
import {sameOrderInventoryGeneration} from './orderInventoryCompletionEvidence';
import {prepareOrderStockFullLineBasis,validateFullLineIntent} from './orderStockFullLinePlan';
import {validateProductionRecordIndex} from './orderProductionRecordPlan';
import {normalizeRawMovement} from './rawInventoryDocument';
import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {encodeCatalogValue,decodeCatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';
import {prepareOrderStockReservationBasis,readOrderStockPlanningSource,type ReservationPreviewActor,type ReservationPreviewClock} from './orderStockExecutionPlan';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {ensureOrderLineIds,aggregateOrderLineInventory,type OrderItemInventoryState,type OrderRawEffectOrigin} from './orderLineInventory';
import {buildOrderRawCommands,selectOrderRawUsageNames,orderRawTracesFromMovement,rawLedgerDocIds} from './orderRawCommandPlan';
import {prepareRawCommand} from './rawInventoryPrepare';
import {buildPreparedRawWritePlan} from './rawPreparedWritePlan';
import {inventoryDocId,operationDocId,legacyOperationDocId} from './rawInventoryCore';
import {buildOrderProductionRecordPlan,deriveNextProductionRecordIndex} from './orderProductionRecordPlan';
import {createOrderProductLotPlanner,pruneDepletedLotsAtCutoff,productLotKstCutoff} from './orderProductLotPlan';
import {buildProductLot,withCarryOverProductLot} from './productLot';
import {shipQtyOfLine} from './orderStockUnits';
import {isStockProduction,stock3} from './orderProductionDomain';
import {withOrderListProjection} from './orderListProjectionWrite';
import {orderStockTouchedIds} from './orderStockReservationPlan';
import {dateOfLocal} from './orderPlanPrimitives';
import {kstDateOf} from './calculation';
import {hasCompleteOrderItems,requiresCompleteItemsForStatusChange,OrderStatus} from './orderCompletion';

export type FullRow=Record<string,any>;
export const FULL_PROTOCOL='private-stock-full-v1';
export const FULL_ATTEMPTS='orderStockFullAttemptsV1';
export const fullHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const fullId=(v:unknown):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&!['.','..'].includes(v)&&!/^__.*__$/.test(v)&&!v.includes('/')&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)&&Buffer.byteLength(v,'utf8')<=1500;
export class FullRejected extends Error {constructor(readonly reason:string,readonly status:'blocked'|'conflict'='blocked'){super(reason);}}
export function fullReject(reason:string,status:'blocked'|'conflict'='blocked'):never {throw new FullRejected(reason,status);}
export const fullObject=(v:unknown):v is FullRow=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
/** SDK12는 referenceValue의 DB를 data()에서 버리므로 decode 이전 protobuf도 검증한다. */
export function fullSnapshotNative(db:Firestore,snapshot:any,fields?:readonly string[]):void {
 const project=(db as any).projectId,database=db.databaseId;
 const walk=(value:any):void=>{if(!value||typeof value!=='object')return;if(typeof value.referenceValue==='string'){if(typeof project!=='string'||typeof database!=='string'||!value.referenceValue.startsWith(`projects/${project}/databases/${database}/documents/`))fullReject('cross-database-native-reference');}for(const child of Object.values(value))if(child&&typeof child==='object')walk(child);};
 if(snapshot._fieldsProto!==undefined){walk(fields?Object.fromEntries(fields.map(key=>[key,snapshot._fieldsProto[key]])):snapshot._fieldsProto);return;}
 const references=(value:any):boolean=>value instanceof DocumentReference||!!value&&typeof value==='object'&&!(value instanceof Timestamp)&&!(value instanceof GeoPoint)&&!Buffer.isBuffer(value)&&!(value instanceof Date)&&Object.values(value).some(references);
 if(snapshot.exists){const data=snapshot.data();if(references(fields?Object.fromEntries(fields.map(key=>[key,data?.[key]])):data))fullReject('native-database-unverifiable');}
}
/** 같은 경로의 다른 DB 문서를 구분하려고 인코딩 전에 소속을 검증한다. */
export function fullCodec(db:Firestore){
 const adapter:CatalogValueAdapter={special(value){
  if(value instanceof Timestamp)return ['timestamp',value.seconds,value.nanoseconds];
  if(value instanceof DocumentReference){if(typeof (db as any).projectId!=='string'||typeof (value.firestore as any).projectId!=='string'||(value.firestore as any).projectId!==(db as any).projectId||value.firestore.databaseId!==db.databaseId)fullReject('cross-database-native-reference');return ['reference',value.path];}
  if(value instanceof GeoPoint)return ['geo',value.latitude,value.longitude];
  if(Buffer.isBuffer(value))return ['bytes',[...value]];return undefined;
 },timestamp:(s,n)=>new Timestamp(s,n),reference:path=>db.doc(path),geo:(lat,long)=>new GeoPoint(lat,long),bytes:v=>Buffer.from(v)};
 const text=(v:unknown)=>JSON.stringify(encodeCatalogValue(v,adapter));
 const decode=(v:string):any=>{const result=decodeCatalogValue(JSON.parse(v),adapter);if(text(result)!==v)fullReject('noncanonical-native-plan','conflict');return result;};
 return {text,decode};
}
export function fullUsable(row:FullRow|undefined,company:string,id:string){
 if(!row||row.companyId!==company||row.id!==undefined&&row.id!==id)fullReject('missing-or-cross-company');
 if('archived'in row&&(row.archived!==false))fullReject('blocked-retired-or-history');
 try{advanceInventoryWriterProtocol(row,{});}catch{fullReject('invalid-writer-protocol');}
 if(row.inventoryReservations!==undefined&&!Array.isArray(row.inventoryReservations))fullReject('invalid-reservations');
}
export interface FullNativeEvidence {kind?:'native';path:string;exists:boolean;version:{seconds:number;nanoseconds:number}|null;nativeText:string}
export interface FullDigestEvidence {kind:'digest';path:string;exists:boolean;version:{seconds:number;nanoseconds:number}|null;nativeSha256:string;encodedBytes:number}
export type FullEvidence=FullNativeEvidence|FullDigestEvidence;
export interface FullHistoryQuery {companyId:string;rawItemId:string;sequence:number;limit:3;orderedEvidence:FullNativeEvidence[]}
export const fullNativeReads=(plan:OrderStockFullPlan):FullNativeEvidence[]=>plan.readSet.filter((row):row is FullNativeEvidence=>row.kind!=='digest');
export function validateFullReadEvidence(plan:OrderStockFullPlan,selfPath:string){
 if(plan.readEvidenceVersion!==undefined&&plan.readEvidenceVersion!==2)fullReject('invalid-read-evidence-version','conflict');const paths=new Set<string>();
 for(const row of plan.readSet){if(!fullObject(row)||typeof row.path!=='string')fullReject('invalid-read-evidence','conflict');fullPath(row.path);if(paths.has(row.path)||row.path===selfPath||typeof row.exists!=='boolean'||row.exists!==(row.version!==null)||row.version!==null&&(!Number.isSafeInteger(row.version.seconds)||!Number.isInteger(row.version.nanoseconds)||row.version.nanoseconds<0||row.version.nanoseconds>=1e9))fullReject('invalid-read-evidence','conflict');paths.add(row.path);
  if(row.kind==='digest'){if(plan.readEvidenceVersion!==2||!['orderStockFullAttemptsV1','rawInventoryJobs'].includes(row.path.split('/')[0])||row.path===selfPath||Object.keys(row).sort().join(',')!=='encodedBytes,exists,kind,nativeSha256,path,version'||!Number.isSafeInteger(row.encodedBytes)||row.encodedBytes<0||!/^[a-f0-9]{64}$/.test(row.nativeSha256)||!row.exists&&(row.nativeSha256!==fullHash(JSON.stringify(encodeCatalogValue(null)))||row.encodedBytes!==Buffer.byteLength(JSON.stringify(encodeCatalogValue(null)),'utf8'))||plan.effectSet.some(effect=>effect.path===row.path))fullReject('invalid-history-digest','conflict');}
  else if(row.kind!==undefined&&row.kind!=='native'||typeof row.nativeText!=='string'||!row.exists&&row.nativeText!==JSON.stringify(encodeCatalogValue(null))||Object.keys(row).some(key=>!['kind','path','exists','version','nativeText'].includes(key))||plan.readEvidenceVersion===2&&['orderStockFullAttemptsV1','rawInventoryJobs'].includes(row.path.split('/')[0]))fullReject('invalid-native-evidence','conflict');
 }
 const queryKeys=new Set<string>();if(plan.historyQueries!==undefined&&(plan.readEvidenceVersion!==2||!Array.isArray(plan.historyQueries)))fullReject('invalid-history-query-evidence','conflict');
 for(const query of plan.historyQueries??[]){const key=JSON.stringify([query.companyId,query.rawItemId,query.sequence]);if(queryKeys.has(key)||query.companyId!==plan.intent.companyId||!fullId(query.rawItemId)||!Number.isSafeInteger(query.sequence)||query.sequence<1||query.limit!==3||!Array.isArray(query.orderedEvidence)||query.orderedEvidence.length<1||query.orderedEvidence.length>2||new Set(query.orderedEvidence.map(row=>row.path)).size!==query.orderedEvidence.length||query.orderedEvidence.some(row=>!plan.readSet.some(evidence=>evidence.kind!=='digest'&&evidence.path===row.path&&evidence.nativeText===row.nativeText&&JSON.stringify(evidence.version)===JSON.stringify(row.version))))fullReject('invalid-history-query-evidence','conflict');queryKeys.add(key);}

}

export interface FullEffect {path:string;operation:'create'|'update';nativeText:string}
export interface OrderStockFullPlan {version:1;protocol:typeof FULL_PROTOCOL;intent:FullRow;owner:FullRow;clock:ReservationPreviewClock;preview:FullRow;actorDisplay:string;partnerDisplay:string;readSet:FullEvidence[];effectSet:FullEffect[];orderPatch:FullRow;audit:FullRow;itemIds:string[];productionDeltas:[string,number][];shipmentDeltas:[string,number][];originalAllocationRows?:{itemId:string;rows:FullRow[]}[];linePlans?:FullRow[];readEvidenceVersion?:2;historyQueries?:FullHistoryQuery[]}
export function fullPath(path:string){const parts=path.split('/');if(parts.length!==2||!fullId(parts[1])||!['orders','employees','partners','items','inventoryWriterDeletions','rawInventories','rawMaterialLedger','rawInventoryReversalGuards','rawInventoryJobs','productionRecords','orderStatusAudits',FULL_ATTEMPTS].includes(parts[0]))fullReject('invalid-derived-document-path');}
/** 에뮬레이터의 허용 범위보다 공식 Firestore 필드·깊이 제약을 우선한다. */
export function validateFullDocument(value:unknown,depth=0):void {
 if(depth>20)fullReject('unsupported-firestore-field-depth');
 if(value===undefined)fullReject('unsupported-firestore-undefined');
 if(value===null||typeof value!=='object'||value instanceof Timestamp||value instanceof DocumentReference||value instanceof GeoPoint||Buffer.isBuffer(value)||value instanceof Date)return;
 if(Array.isArray(value)){for(const row of value){if(Array.isArray(row))fullReject('unsupported-firestore-nested-array');validateFullDocument(row,depth+1);}return;}
 for(const [key,row]of Object.entries(value)){if(!key||/^__.*__$/.test(key)||Buffer.byteLength(key,'utf8')>1500)fullReject('unsupported-firestore-field-name');validateFullDocument(row,depth+1);}
}
export function fullBudget(db:Firestore,attempt:FullRow,writes:{path:string;data:FullRow}[]){
 const {text}=fullCodec(db);const paths=new Set<string>();let total=0;
 for(const write of writes){fullPath(write.path);if(paths.has(write.path))fullReject('duplicate-effect-path');paths.add(write.path);validateFullDocument(write.data);const size=Buffer.byteLength(text(write.data),'utf8');if(size>786432)fullReject('document-budget-exceeded');total+=size;}
 validateFullDocument(attempt);if(paths.size>202||Buffer.byteLength(text(attempt),'utf8')>786432||total>4194304)fullReject('write-budget-exceeded');
}
export async function prepareOrderStockFullPlan(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor|null|undefined,intent:unknown,clock:ReservationPreviewClock):Promise<{status:'planned';plan:OrderStockFullPlan}|{status:'blocked';reason:string}>{
 try{
  let nativeFailure:string|undefined;
  const nativeTx={get:async(ref:any)=>{const result:any=await tx.get(ref);try{for(const snapshot of result.docs??[result])fullSnapshotNative(db,snapshot);}catch(error){if(error instanceof FullRejected)nativeFailure=error.reason;throw error;}return result;}};
  const {text}=fullCodec(db);let lineBasis:ReturnType<typeof prepareOrderStockFullLineBasis>|undefined;let preEmployee:any;
  let basis:Extract<Awaited<ReturnType<typeof prepareOrderStockReservationBasis>>,{status:'basis'}>|ReturnType<typeof prepareOrderStockFullLineBasis>;
  if(fullObject(intent)&&intent.action==='line-forward'){
   const input=validateFullLineIntent(intent);if(!clock||typeof clock.now!=='string'||!Number.isFinite(clock.nowMs)||!Number.isFinite(Date.parse(clock.now))||Date.parse(clock.now)!==clock.nowMs||new Date(clock.nowMs).toISOString()!==clock.now)fullReject('invalid-clock');if(!actor||!fullObject(actor.token)||actor.token.companyId!==input.companyId||!fullId(actor.token.employeeId)||!actor.uid)fullReject('permission-denied');
   const source=await readOrderStockPlanningSource(nativeTx as Pick<Transaction,'get'>,db,actor,input,clock);if(source.status!=='source')return {status:'blocked',reason:nativeFailure??source.reason};
   preEmployee=await nativeTx.get(db.doc('employees/'+actor.token.employeeId));const employee=preEmployee.data();if(!employee||employee.authUid!==actor.uid||(employee.companyId??'taebaek')!==input.companyId||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
   lineBasis=prepareOrderStockFullLineBasis(source,input,employee.name,clock,text);basis=lineBasis;
  }else {const result=await prepareOrderStockReservationBasis(nativeTx as Pick<Transaction,'get'>,db,actor,intent,clock);if(result.status!=='basis')return {status:'blocked',reason:nativeFailure??result.reason};basis=result;}
  const {catalog,orderSnapshot,productionDeltas,shipmentDeltas}=basis,preview:FullRow=basis.preview,company=preview.intent.companyId;
  async function buildFullEffectsFromRows(){
  const order=orderSnapshot.data()!;fullUsable(order,company,preview.intent.orderId);
  if(!lineBasis&&isStockProduction(order)&&['SHIPPED','DELIVERED'].includes(preview.intent.targetStatus))fullReject('stock-production-cannot-ship');
  if(!lineBasis&&requiresCompleteItemsForStatusChange(order.status as OrderStatus,preview.intent.targetStatus as OrderStatus)&&!hasCompleteOrderItems(order.items))fullReject('incomplete-order-items');
  // 계산 입력 native도 path-only codec에 도달하기 전에 같은 DB인지 확인한다.
  for(const collection of catalog.observation.collections)for(const document of collection.documents)text(document.data);
  const evidence=new Map<string,FullEvidence>(),original=new Map<string,FullRow|undefined>(),effects=new Map<string,FullRow>();
  function remember(path:string,data:FullRow|undefined,version:Timestamp|undefined){fullPath(path);text(data??null);original.set(path,data);evidence.set(path,{kind:'native',path,exists:data!==undefined,version:version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null,nativeText:text(data??null)});}
  remember('orders/'+preview.intent.orderId,order,orderSnapshot.updateTime);
  const read=async(path:string)=>{fullPath(path);if(!evidence.has(path)){const snap=preEmployee&&path==='employees/'+preview.owner.employeeId?preEmployee:await nativeTx.get(db.doc(path));remember(path,snap.data(),snap.updateTime);}return original.get(path);};
  // 큰 과거 원문은 검증 메모리에만 두고 새 계획에는 digest만 남긴다.
  const historical=new Map<string,FullRow|undefined>(),historyWork=new Map<string,number>(),historyQueries=new Map<string,FullHistoryQuery>();
  const trackHistorical=(path:string,row:FullRow|undefined,encodedBytes?:number)=>{if(!historyWork.has(path)){const known=evidence.get(path);historyWork.set(path,encodedBytes??Buffer.byteLength(known&&known.kind!=='digest'?known.nativeText:text(row??null),'utf8'));}if(historyWork.size>500||[...historyWork.values()].reduce((sum,value)=>sum+value,0)>16777216)fullReject('history-work-budget-exceeded');};
  const readPast=async(path:string)=>{const row=await read(path);trackHistorical(path,row);return row;};
  const readHistoricalEvidence=async(path:string)=>{fullPath(path);if(!['orderStockFullAttemptsV1','rawInventoryJobs'].includes(path.split('/')[0])||path===FULL_ATTEMPTS+'/'+fullAttemptId({version:1,companyId:company,orderId:preview.intent.orderId,requestId:preview.intent.requestId},preview.owner.uid)||original.has(path))fullReject('invalid-history-digest');if(!historical.has(path)){const snap=await nativeTx.get(db.doc(path)),row=snap.data(),native=text(row??null);historical.set(path,row);trackHistorical(path,row,Buffer.byteLength(native,'utf8'));evidence.set(path,{kind:'digest',path,exists:row!==undefined,version:snap.updateTime?{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds}:null,nativeSha256:fullHash(native),encodedBytes:Buffer.byteLength(native,'utf8')});}return historical.get(path);};
  const predecessor=async(rawItemId:string,sequence:number)=>{if(!Number.isSafeInteger(sequence)||sequence<1)fullReject('prior-balance-unproven');const key=text([company,rawItemId,sequence]);let query=historyQueries.get(key);if(!query){const result:any=await nativeTx.get(db.collection('rawMaterialLedger').where('companyId','==',company).where('rawItemId','==',rawItemId).where('sequence','==',sequence).limit(3));if(result.docs.length===0||result.docs.length>=3)fullReject('prior-balance-unproven');const orderedEvidence:FullNativeEvidence[]=[];for(const snap of result.docs){const row=snap.data(),path=snap.ref.path;if(!row||row.companyId!==company||row.rawItemId!==rawItemId||row.sequence!==sequence||typeof row.operationId!=='string'||![operationDocId(row.operationId),legacyOperationDocId(row.operationId)].includes(snap.id)||!Number.isFinite(row.balanceAfterKg))fullReject('prior-balance-unproven');remember(path,row,snap.updateTime);trackHistorical(path,row);orderedEvidence.push(evidence.get(path) as FullNativeEvidence);}orderedEvidence.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);query={companyId:company,rawItemId,sequence,limit:3,orderedEvidence};historyQueries.set(key,query);}
   const values=query.orderedEvidence.map(row=>normalizeRawMovement(fullCodec(db).decode(row.nativeText)));if(values.length===2&&(values[0].operationId!==values[1].operationId||text(values[0])!==text(values[1])))fullReject('prior-balance-unproven');return values[0].balanceAfterKg;
  };
  const employeeId=preview.owner.employeeId;if(!fullId(employeeId))fullReject('permission-denied');
  const employee=await read('employees/'+employeeId);
  if(!employee||employee.authUid!==preview.owner.uid||(employee.companyId??'taebaek')!==company||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
  let partnerDisplay=typeof order.partnerName==='string'?order.partnerName:'';
  if(order.partnerId){if(!fullId(order.partnerId))fullReject('invalid-partner');const partner=await read('partners/'+order.partnerId);if(partner){if((partner.companyId??'taebaek')!==company)fullReject('permission-denied');if(typeof partner.name==='string')partnerDisplay=partner.name;}}
  const itemIds=new Set<string>(preview.stockSnapshot.map(([id]:[string,number])=>id));
  const item=async(id:string)=>{const path='items/'+id;if(!evidence.has(path)){const observed=catalog.observation.collections[0].documents.find(row=>row.id===id);if(!observed)fullReject('touched-item-missing');remember(path,observed.data,observed.updateTime);}const row=original.get(path)!;fullUsable(row,company,id);if(await read('inventoryWriterDeletions/'+company+'__'+id))fullReject('blocked-retired-or-history');itemIds.add(id);return row;};
  for(const id of itemIds)await item(id);
  const legacyJobs=new Map<string,{request:OrderRawBatchRequest;job:FullRow}>();
  const originOf=(lineId:string,attempt:number):OrderRawEffectOrigin=>({protocol:FULL_PROTOCOL,reference:{version:1,companyId:company,orderId:preview.intent.orderId,requestId:preview.intent.requestId},owner:preview.owner,lineId,attempt});
  const fullSource=async(lineId:string,state:OrderItemInventoryState)=>{
   const origin=state.rawEffectOrigin;
   if(!fullObject(origin)||origin.protocol!==FULL_PROTOCOL||!fullObject(origin.reference)||origin.reference.version!==1||origin.reference.companyId!==company||origin.reference.orderId!==preview.intent.orderId||!fullId(origin.reference.requestId)||!fullObject(origin.owner)||origin.owner.companyId!==company||typeof origin.owner.uid!=='string'||!origin.owner.uid||!fullId(origin.owner.employeeId)||origin.lineId!==lineId||origin.attempt!==state.attempt||!Array.isArray(state.rawEffectReferences))fullReject('invalid-full-raw-origin');
   const attemptId=fullAttemptId(origin.reference,origin.owner.uid),saved=await readHistoricalEvidence(FULL_ATTEMPTS+'/'+attemptId);
   if(!saved||saved.version!==1||saved.protocol!==FULL_PROTOCOL||saved.attemptId!==attemptId||saved.state!=='applied'||text(saved.reference)!==text(origin.reference)||text(saved.owner)!==text(origin.owner)||typeof saved.fullPlanText!=='string'||fullHash(saved.fullPlanText)!==saved.fullPlanHash||!fullObject(saved.receipt)||saved.receipt.state!=='applied'||fullHash(text(saved.receipt))!==saved.receiptHash||saved.receipt.fullPlanHash!==saved.fullPlanHash)fullReject('prior-full-provenance-unproven');
   const prior=fullCodec(db).decode(saved.fullPlanText) as OrderStockFullPlan;
   if(prior.version!==1||prior.protocol!==FULL_PROTOCOL||text(prior.owner)!==text(origin.owner)||prior.intent.companyId!==company||prior.intent.orderId!==preview.intent.orderId||prior.intent.requestId!==origin.reference.requestId||text(prior.intent)!==saved.intentText||fullHash(saved.intentText)!==saved.intentHash||!Array.isArray(prior.readSet)||!Array.isArray(prior.effectSet))fullReject('prior-full-provenance-unproven');
   validateFullReadEvidence(prior,FULL_ATTEMPTS+'/'+attemptId);
   const current=new Map<string,FullRow|undefined>(fullNativeReads(prior).map(row=>[row.path,fullCodec(db).decode(row.nativeText)]));
   for(const row of saved.expectedB??[])current.set(row.path,fullCodec(db).decode(row.nativeText));
   const terminal=materializeOrderStockFullTerminal(db,prior,saved,current,'apply',{now:saved.receipt.at,nowMs:Date.parse(saved.receipt.at)});
   if(text(terminal.next.receipt)!==text(saved.receipt))fullReject('prior-full-receipt-unproven');
   const persisted=prior.orderPatch.itemInventory?.[lineId],withoutReverse=(row:FullRow)=>{const {reversedAt:_reversed,applied:_applied,...rest}=row;return rest;};
   if(!persisted||persisted.applied!==true||text(withoutReverse(persisted))!==text(withoutReverse(state)))fullReject('prior-full-line-unproven');
   const lines=prior.linePlans?.filter(row=>row.lineId===lineId);
   if(!lines||lines.length!==1||lines[0].attempt!==state.attempt||!Array.isArray(lines[0].commandIndices)||lines[0].commandIndices.length!==state.rawEffectReferences!.length)fullReject('prior-full-line-unproven');
   return state.rawEffectReferences!.map((ref,index)=>{
    if(text({protocol:ref.protocol,reference:ref.reference,owner:ref.owner,lineId:ref.lineId,attempt:ref.attempt})!==text(origin)||!Number.isSafeInteger(ref.commandIndex)||ref.commandIndex!==lines[0].commandIndices[index]||ref.movementPath!=='rawMaterialLedger/'+operationDocId(ref.operationId))fullReject('prior-full-command-unproven');
    const effect=prior.effectSet.find(row=>row.path===ref.movementPath);if(!effect)fullReject('prior-full-command-unproven');
    const raw=fullCodec(db).decode(effect.nativeText),before=fullNativeReads(prior).find(row=>row.path===ref.movementPath);if(!before||before.exists)fullReject('prior-full-command-unproven');
    const actual=advanceInventoryWriterProtocol(undefined,raw);
    if(fullHash(text(actual))!==ref.movementHash||actual.operationId!==ref.operationId||actual.rawItemId!==ref.rawItemId||actual.commandHash!==ref.commandHash||text(actual.source)!==text(ref.source))fullReject('prior-full-command-unproven');
    return {operationId:ref.operationId,rawItemId:ref.rawItemId,movementHash:ref.movementHash};
   });
  };
  const legacySource=async(lineId:string,state:OrderItemInventoryState)=>{
   let generation=order.productionRecordIndex?.[lineId]?.generation;const marker=order.inventoryGenerationCompletion;
   if(!generation&&marker?.generation?.startedAt===state.completedAt){const patch=JSON.parse(marker.requestText).patch;if(text(patch.itemInventory?.[lineId]??null)===text(state)&&patch.itemInventory?.[lineId]?.applied===true)generation=marker.generation;}
   if(!generation){
    const production=state.production,empty=(value:any)=>Array.isArray(value)&&value.length===0;
    const zero=Object.prototype.hasOwnProperty.call(production,'rawCalculationEvidence')&&empty(production.rawCalculationEvidence)&&[state.rawConsumedLots,production.rawConsumedLots,production.rawLedgerIds,production.stockDeltas,production.productProducedLots,production.productConsumedLots,state.autoBuilt,state.producedUnits].every(empty);
    const patch=marker?JSON.parse(marker.requestText).patch:undefined;
    if(!order.productionRecordIndex?.[lineId]&&!state.rawEffectOrigin&&zero&&text(patch?.itemInventory?.[lineId]??null)===text(state))return [];
    fullReject('legacy-raw-history-unproven');
   }
   if(generation.companyId!==company||generation.orderId!==preview.intent.orderId||generation.startedAt!==state.completedAt)fullReject('legacy-raw-history-unproven');
   const jobId=orderRawBatchJobId(generation);let cached=legacyJobs.get(jobId);
   if(!cached){
    const job=await readHistoricalEvidence('rawInventoryJobs/'+jobId);if(!job)fullReject('legacy-raw-history-unproven');let request:OrderRawBatchRequest;
    try{request=readOrderRawBatchJobRequest(job);}catch{fullReject('legacy-raw-history-unproven');}
    if(!sameOrderInventoryGeneration(request!.generation,generation)||!Array.isArray(request!.plan.lines))fullReject('legacy-raw-history-unproven');
    const reads=[];
    for(const {command}of request!.commands){
     const movement=await readPast('rawMaterialLedger/'+operationDocId(command.operationId)),legacyId=legacyOperationDocId(command.operationId),old=legacyId===operationDocId(command.operationId)?undefined:await readPast('rawMaterialLedger/'+legacyId),state=await readPast('rawInventories/'+inventoryDocId(company,command.rawItemId)),item=await readPast('items/'+command.rawItemId),snap=(row:any)=>({exists:()=>row!==undefined,data:()=>row});
     reads.push({movementSnap:snap(movement),oldMovementSnap:legacyId===operationDocId(command.operationId)?null:snap(old),stateSnap:snap(state),itemSnap:snap(item)});
    }
    if(orderRawBatchProofProblem(job,request!,reads,await orderRawBatchRequestHash(request!)))fullReject('legacy-raw-proof-conflict');
    const covered=new Set<number>(),lineIds=new Set<string>();
    for(const row of request!.plan.lines as FullRow[]){
     if(typeof row.lineId!=='string'||lineIds.has(row.lineId)||!Number.isSafeInteger(row.attempt)||row.attempt<1||!Array.isArray(row.commandIndices))fullReject('legacy-command-index-unproven');lineIds.add(row.lineId);
     for(const index of row.commandIndices){const command=request!.commands[index]?.command;
      if(!Number.isSafeInteger(index)||index<0||!command||covered.has(index)||command.operationId!==(command.kind==='ledger-consume'?'production-ledger':'production')+':'+preview.intent.orderId+':'+row.lineId+':a'+row.attempt+':'+command.rawItemId)fullReject('legacy-command-index-unproven');covered.add(index);
     }
    }
    if(covered.size!==request!.commands.length)fullReject('legacy-command-index-unproven');cached={request:request!,job};legacyJobs.set(jobId,cached);
   }
   if(order.productionRecordIndex?.[lineId]&&order.productionRecordIndex[lineId].requestHash!==cached.job.requestHash)fullReject('legacy-record-request-conflict');
   const matches=(cached.request.plan.lines as FullRow[]).filter(row=>row.lineId===lineId);
   if(matches.length!==1||matches[0].attempt!==state.attempt||text(matches[0].rowDeltas)!==text(state.production.stockDeltas)||text(matches[0].bomLines)!==text(state.production.bomLines)||text(matches[0].production.rawCalculationEvidence??null)!==text(state.production.rawCalculationEvidence??null)||text(matches[0].production.autoBuilt)!==text(state.autoBuilt)||text(matches[0].production.producedUnits)!==text(state.producedUnits))fullReject('legacy-line-snapshot-unproven');
   const indices=matches[0].commandIndices as number[],traces=indices.flatMap(index=>orderRawTracesFromMovement(cached!.request.commands[index].command,cached!.job.results[index].movement));
   if(text(traces)!==text(state.rawConsumedLots))fullReject('legacy-line-snapshot-unproven');return indices.map(index=>({operationId:cached!.request.commands[index].command.operationId,rawItemId:cached!.request.commands[index].command.rawItemId,command:cached!.request.commands[index].command}));
  };

  const attempt=(order.rawInventoryAttempt??0)+1;if(!Number.isSafeInteger(attempt)||attempt<1)fullReject('invalid-raw-attempt');
  const dayOf=(iso?:string)=>iso?.includes('T')&&Number.isFinite(Date.parse(iso))?kstDateOf(new Date(iso)):dateOfLocal(iso);
  const today=kstDateOf(new Date(clock.nowMs)),businessDate=dayOf(order.deliveredAt)||today;
  const rows=lineBasis?.lineRows??[{lineId:undefined,index:0,item:undefined,attempt,production:preview.plannerAggregate,rowDeltas:productionDeltas,lotBaseId:preview.intent.orderId+'-'+attempt}];
  const commands:ReturnType<typeof buildOrderRawCommands>['commands']=[],commandIndices:number[][]=[];
  for(const row of rows){const built=buildOrderRawCommands({orderId:preview.intent.orderId,physicalUsage:row.production.rawUsage,ledgerOnlyUsage:row.production.rawUsageLedgerOnly,attempt:row.attempt,...(row.lineId?{lineId:row.lineId}:{}),allItems:catalog.allItems,companyId:company,businessDate,customerName:partnerDisplay,actorName:employee.name,names:selectOrderRawUsageNames(row.production.rawUsage,row.production.rawUsageLedgerOnly)}).commands;commandIndices.push(built.map((_,index)=>commands.length+index));commands.push(...built);}
  const rawOperations=new Set<string>(),rawMovementPaths=new Set<string>();
  for(const {command}of commands){
   const paths=new Set(['rawMaterialLedger/'+operationDocId(command.operationId),'rawMaterialLedger/'+legacyOperationDocId(command.operationId)]);
   if(rawOperations.has(command.operationId)||[...paths].some(path=>rawMovementPaths.has(path)))fullReject('duplicate-raw-operation-path');
   rawOperations.add(command.operationId);for(const path of paths){fullPath(path);rawMovementPaths.add(path);}
  }
  const rawVirtual=new Map<string,any>(),rawTraces:FullRow[]=[],tracesByCommand:FullRow[][]=[],rawReferences:FullRow[]=[];
  const productIds=new Set([...productionDeltas.keys(),...shipmentDeltas.keys()]);
  for(const {command,options}of commands){
   if(productIds.has(command.rawItemId))fullReject('unsupported-overlapping-item-effects');
   const rawItem=await item(command.rawItemId),statePath='rawInventories/'+inventoryDocId(company,command.rawItemId),movementPath='rawMaterialLedger/'+operationDocId(command.operationId),oldPath='rawMaterialLedger/'+legacyOperationDocId(command.operationId);
   const state=await read(statePath),movement=await read(movementPath),old=oldPath===movementPath?undefined:await read(oldPath);
   if(movement||old)fullReject('orphan-raw-movement');if(state)fullUsable(state,company,inventoryDocId(company,command.rawItemId));
   const snap=(row:any)=>({exists:()=>row!==undefined,data:()=>row});
   const rawRead={movementSnap:snap(movement),oldMovementSnap:snap(old),stateSnap:snap(state),itemSnap:snap(rawItem)};
   const result=prepareRawCommand(command,rawRead,{...options,now:clock.now},rawVirtual.get(command.rawItemId));
   if(result.status!=='applied')fullReject('raw-command-'+result.status+('code'in result?':'+result.code:''));
   const materializer=buildPreparedRawWritePlan(command,rawRead as any,result,options);
   // 원 writer의 평가 순서를 유지하며 같은 holder의 두 번째 명령도 처음 revision에서 한 번만 증가한다.
   effects.set(statePath,materializer.state());const movementData=materializer.movement();effects.set(movementPath,movementData);rawReferences.push({operationId:command.operationId,rawItemId:command.rawItemId,movementPath,source:command.source,commandHash:commandHash(command),movementHash:fullHash(text(advanceInventoryWriterProtocol(undefined,movementData)))});
   if(materializer.hasGuard())fullReject('unexpected-forward-reversal-guard');
   const patch=materializer.itemPatch();if(patch)effects.set('items/'+command.rawItemId,{...(effects.get('items/'+command.rawItemId)??{}),...patch});
   const nextItem={...(rawVirtual.get(command.rawItemId)?.itemData??rawItem),...patch};rawVirtual.set(command.rawItemId,{state:result.state,itemData:nextItem});
   const traces=orderRawTracesFromMovement(command,result.movement);tracesByCommand.push(traces);rawTraces.push(...traces);
  }
  const normalizedItems=ensureOrderLineIds(order.items as ({itemId:string;quantity:number;lineId?:string})[]),normalizedOrder={...order,id:preview.intent.orderId,companyId:company,partnerName:partnerDisplay,items:lineBasis?lineBasis.lineRows.map(row=>row.item):normalizedItems};
  const generation={contractVersion:1 as const,companyId:company,orderId:preview.intent.orderId,operationId:FULL_PROTOCOL+':'+fullHash(text([company,preview.owner.uid,preview.intent.orderId,preview.intent.requestId])),actorUid:preview.owner.uid,startedAt:clock.now};
  if(lineBasis){
   try{validateProductionRecordIndex(order.productionRecordIndex??{},company,preview.intent.orderId);}catch{fullReject('invalid-production-record-index');}
   const states=lineBasis.currentStates,index=order.productionRecordIndex??{};
   for(const [lineId,entry]of Object.entries(index) as [string,any][]){const state=states[lineId];if(!state)fullReject('invalid-production-record-index');const record=await readPast('productionRecords/'+entry.recordId),relatedItems=new Set([state.itemId,...state.production.bomLines.filter(row=>row.parentItemId===state.itemId).map(row=>row.childItemId),...(state.production.productProducedLots??[]).map(row=>row.itemId)]);if(!record||record.companyId!==company||record.orderId!==preview.intent.orderId||record.lineId!==lineId||!relatedItems.has(record.itemId)||text(record.generation)!==text(entry.generation)||record.createdAt!==entry.generation.startedAt||record.supersededBy||state.completedAt!==entry.generation.startedAt)fullReject('invalid-prior-production-record');fullUsable(record,company,entry.recordId);}
   for(const [lineId,state] of Object.entries(states)){
    const operations=state.rawEffectOrigin?await fullSource(lineId,state):await legacySource(lineId,state);
    for(const trace of operations){const operation=trace.operationId;
     const canonical=operationDocId(operation),legacy=legacyOperationDocId(operation),a=await readPast('rawMaterialLedger/'+canonical),b=legacy===canonical?undefined:await readPast('rawMaterialLedger/'+legacy);
     const select=(first:FullRow|undefined,second:FullRow|undefined)=>{if(first&&second&&text(normalizeRawMovement(first))!==text(normalizeRawMovement(second)))fullReject('conflicting-prior-raw-movements');return first??second;};
     const original=select(a,b),movement=original?normalizeRawMovement(original):undefined;
     const savedTraces=state.rawConsumedLots.filter(row=>row.operationId===operation),ledgerOnly=movement?.kind==='ledger-consume';
     if(!movement||movement.operationId!==operation||movement.companyId!==company||movement.rawItemId!==trace.rawItemId||movement.source?.id!==preview.intent.orderId||movement.source?.type!==(ledgerOnly?'oem':'production')||!['ledger-consume','consume'].includes(movement.kind)||text(savedTraces)!==text(orderRawTracesFromMovement('command'in trace?trace.command as any:movement as any,movement))||savedTraces.some(row=>![canonical,legacy].includes(row.ledgerId!))||'movementHash'in trace&&fullHash(text(original))!==trace.movementHash)fullReject('invalid-prior-raw-movement');
     fullUsable(original,company,movement.id);
     const reverseOperation='reverse:'+operation,reverseCanonical=operationDocId(reverseOperation),reverseLegacy=legacyOperationDocId(reverseOperation),reverseA=await readPast('rawMaterialLedger/'+reverseCanonical),reverseB=reverseLegacy===reverseCanonical?undefined:await readPast('rawMaterialLedger/'+reverseLegacy),reverseRaw=select(reverseA,reverseB),guard=await readPast('rawInventoryReversalGuards/'+canonical);
     if(state.applied){if(guard||reverseRaw)fullReject('prior-line-reversal-conflict');continue;}
     const reverse=reverseRaw?normalizeRawMovement(reverseRaw):undefined;
     if(!guard||guard.id!==canonical||guard.originalOperationId!==operation||guard.reverseOperationId!==reverseOperation||guard.companyId!==company||guard.rawItemId!==trace.rawItemId||typeof guard.createdAt!=='string'||!Number.isFinite(Date.parse(guard.createdAt))||!reverse||reverse.operationId!==reverseOperation||![reverseCanonical,reverseLegacy].includes(reverse.id)||reverse.kind!=='reverse'||reverse.reversalOf!==operation||reverse.companyId!==company||reverse.rawItemId!==trace.rawItemId||reverse.source?.type!=='reversal'||reverse.source.id!==preview.intent.orderId||reverse.recordedAt!==guard.createdAt||!Number.isFinite(reverse.reportedDeltaKg)||!Number.isFinite(reverse.appliedDeltaKg)||!Array.isArray(reverse.lotChanges)||reverse.lotChanges.some(row=>!Number.isFinite(row.deltaKg)||!Number.isFinite(row.beforeKg)||!Number.isFinite(row.afterKg)))fullReject(savedTraces.length===0?'prior-reporting-reversal-incomplete':'prior-line-reversal-unproven');
     fullUsable(guard,company,canonical);fullUsable(reverseRaw,company,reverse.id);
     if(!Array.isArray(original!.lotChanges)||original!.lotChanges.some((row:any)=>!fullObject(row.lotSnapshot)||row.lotSnapshot.id!==row.lotId)||!Array.isArray(reverseRaw!.lotChanges)||reverseRaw!.lotChanges.some((row:any)=>!fullObject(row.lotSnapshot)||row.lotSnapshot.id!==row.lotId||row.lotSnapshot.kgRemaining!==row.beforeKg||(row.lotSnapshot.supplierName??null)!==(row.supplierName??null)||(row.lotSnapshot.lotNo??null)!==(row.lotNo??null)||(row.lotSnapshot.receivedDate??null)!==(row.receivedDate??null)))fullReject('prior-reversal-lot-evidence-unproven');
     if(typeof reverse.effectiveAt!=='string'||!Number.isFinite(Date.parse(reverse.effectiveAt))||reverse.commandHash!==commandHash({operationId:reverseOperation,companyId:company,rawItemId:trace.rawItemId,materialSnapshot:reverse.materialSnapshot,effectiveAt:reverse.effectiveAt,source:{type:'reversal',id:preview.intent.orderId},kind:'reverse',originalOperationId:operation}))fullReject('prior-line-reversal-unproven');
     const expectedLots=rawReverseLotDeltas(movement);if(reverse.reportedDeltaKg!==rawReverseReportedDelta(movement)||reverse.lotChanges.length!==expectedLots.length||new Set(movement.lotChanges.map(row=>row.lotId)).size!==movement.lotChanges.length||reverse.lotChanges.some((row,index)=>row.lotId!==expectedLots[index].lotId||row.deltaKg!==expectedLots[index].deltaKg||rawAppliedDelta(row.beforeKg,row.afterKg)!==row.deltaKg||!row.lotSnapshot||row.lotSnapshot.id!==row.lotId||row.lotSnapshot.kgRemaining!==row.beforeKg))fullReject('invalid-prior-reversal-numerics');
     if(!Number.isSafeInteger(reverse.sequence)||reverse.sequence<=1||reverse.appliedDeltaKg!==rawAppliedDelta(await predecessor(reverse.rawItemId,reverse.sequence-1),reverse.balanceAfterKg))fullReject('invalid-prior-reversal-numerics');
    }
   }
  }
  const records=buildOrderProductionRecordPlan(normalizedOrder as any,catalog.allItems,catalog.inputs,generation,{dateOf:iso=>dayOf(iso??clock.now)});
  const recordHash=fullHash(text(records));
  for(const record of records.records){if(await read('productionRecords/'+record.id))fullReject('orphan-production-record');for(const legacy of record.legacySourceCandidates??[])if(await read('productionRecords/'+legacy.recordId))fullReject('orphan-production-record');effects.set('productionRecords/'+record.id,record);}
  const lotClock={now:clock.now,date:today,id:'full-product-lot'};
  const lots=createOrderProductLotPlanner({allItems:catalog.allItems,unitInputs:catalog.inputs,shipQtyOf:(line,product)=>shipQtyOfLine(line,product,catalog.inputs),lotPolicy:{buildProductLot:params=>buildProductLot(params,lotClock),withCarryOverProductLot:(ls,stock,material,kg,carry)=>withCarryOverProductLot(ls,stock,material,kg,carry,lotClock)}});
  const rowLots=rows.map(row=>lots.productionProductLots(row.rowDeltas,row.lotBaseId)),productionLots={mutations:rowLots.flatMap(row=>row.mutations),traces:rowLots.flatMap(row=>row.traces),consumedLots:rowLots.flatMap(row=>row.consumedLots)},shipped=!lineBasis&&!isStockProduction(order)&&['SHIPPED','DELIVERED'].includes(preview.intent.targetStatus),consumed:FullRow[]=[];
  const mutations=lots.combineProductLotMutations([...productionLots.mutations,...(shipped?lots.deductProductLotsForOrder(normalizedOrder as any):[])]);
  const finalDeltas=new Map(productionDeltas);if(shipped)for(const [id,delta]of shipmentDeltas)finalDeltas.set(id,(finalDeltas.get(id)??0)+delta);
  for(const mutation of mutations){const row=await item(mutation.itemId),result=mutation.apply(row.lots??[],row.stock??0);consumed.push(...result.consumedLots);effects.set('items/'+mutation.itemId,{...effects.get('items/'+mutation.itemId),lots:pruneDepletedLotsAtCutoff(result.lots,productLotKstCutoff(clock.now))});}
  for(const [id,delta]of finalDeltas){const row=await item(id),stock=stock3((row.stock??0)+delta);if(!Number.isFinite(stock)||stock<0)fullReject('invalid-final-stock');if(delta)effects.set('items/'+id,{...effects.get('items/'+id),stock});}
  const deltaRows=(map:Map<string,number>)=>[...map].filter(([,delta])=>delta!==0).map(([itemId,delta])=>({itemId,delta}));
  const bomLines=orderStockTouchedIds(order as any,catalog.inputs.bom).flatMap(parentItemId=>catalog.inputs.bom.of(parentItemId).map(line=>({parentItemId,childItemId:line.childId,quantity:line.qty})));
  const production={capturedAt:clock.now,stockDeltas:deltaRows(productionDeltas),productProducedLots:productionLots.traces,productConsumedLots:productionLots.consumedLots,rawCalculationEvidence:preview.plannerAggregate.rawCalculationEvidence??[],bomLines,rawConsumedLots:rawTraces,rawLedgerIds:rawLedgerDocIds(rawTraces as any)};
  let orderPatch:FullRow={status:preview.intent.targetStatus,items:normalizedItems,producedAt:clock.now,rawLotsDeducted:true,rawInventoryAttempt:attempt,rawConsumedLots:rawTraces,producedUnits:preview.plannerAggregate.producedUnits,productionRecordIndex:deriveNextProductionRecordIndex(records,recordHash),inventorySnapshots:{version:1,production},inventoryOperation:null};
  if(preview.plannerAggregate.autoBuilt.length)orderPatch.autoBuilt=preview.plannerAggregate.autoBuilt;
  if(shipped){orderPatch.shippedOut=true;orderPatch.productConsumedLots=consumed;orderPatch.inventorySnapshots.shipment={capturedAt:clock.now,stockDeltas:deltaRows(shipmentDeltas),bomLines:[],productConsumedLots:consumed};}
  if(lineBasis){
   const states={...lineBasis.currentStates};
   rows.forEach((row,index)=>{const traces=commandIndices[index].flatMap(i=>tracesByCommand[i]),single={...order,items:[row.item]},bomLines=orderStockTouchedIds(single as any,catalog.inputs.bom).flatMap(parentItemId=>catalog.inputs.bom.of(parentItemId).map(line=>({parentItemId,childItemId:line.childId,quantity:line.qty}))),snapshot={capturedAt:clock.now,stockDeltas:deltaRows(row.rowDeltas),productProducedLots:rowLots[index].traces,productConsumedLots:rowLots[index].consumedLots,rawCalculationEvidence:row.production.rawCalculationEvidence,bomLines,rawConsumedLots:traces,rawLedgerIds:rawLedgerDocIds(traces as any)};
    Object.defineProperty(states,row.lineId!,{value:{version:1,rawEffectOrigin:originOf(row.lineId!,row.attempt),rawEffectReferences:commandIndices[index].map(commandIndex=>({...originOf(row.lineId!,row.attempt),commandIndex,...rawReferences[commandIndex]})),lineId:row.lineId!,itemId:row.item!.itemId,applied:true,attempt:row.attempt,completedAt:clock.now,rawConsumedLots:traces,autoBuilt:row.production.autoBuilt,producedUnits:row.production.producedUnits,production:snapshot},writable:true,enumerable:true,configurable:true});
   });
   orderPatch={items:lineBasis.nextItems,status:lineBasis.effectiveStatus,itemInventory:states,...aggregateOrderLineInventory(order,states),productionRecordIndex:deriveNextProductionRecordIndex(records,recordHash),inventoryOperation:null};
  }
  const audit={id:generation.operationId,orderId:preview.intent.orderId,companyId:company,partnerName:partnerDisplay,previousStatus:order.status,nextStatus:lineBasis?.effectiveStatus??preview.intent.targetStatus,approvedBy:employee.name,approvedAt:clock.now,state:'processing',legacyEvidenceWarning:false,stockAdjustments:deltaRows(finalDeltas).map(row=>{const i=catalog.allItems.find(i=>i.id===row.itemId);return {...row,name:i?.name??row.itemId,unit:i?.unit??'개'};})};
  // audit ID도 문서 segment로 쓸 수 있는 원 형태다. fake legacy receipt는 만들지 않는다.
  if(await read('orderStatusAudits/'+audit.id))fullReject('orphan-status-audit');
  if(itemIds.size>200)fullReject('item-budget-exceeded');
  const effectSet:FullEffect[]=[...effects].map(([path,data])=>({path,operation:original.get(path)?'update':'create',nativeText:text(data)}));
  const plan:OrderStockFullPlan={version:1,readEvidenceVersion:2,historyQueries:[...historyQueries.values()],protocol:FULL_PROTOCOL,intent:preview.intent,owner:preview.owner,clock,preview,actorDisplay:employee.name,partnerDisplay,readSet:[...evidence.values()],effectSet,orderPatch:fullCodec(db).decode(text(withOrderListProjection(order,orderPatch,'patch'))),audit,itemIds:[...itemIds],productionDeltas:[...productionDeltas],shipmentDeltas:[...shipmentDeltas],...(lineBasis?{originalAllocationRows:lineBasis.previousAllocationRows,linePlans:rows.map((row,index)=>({lineId:row.lineId,index:row.index,attempt:row.attempt,production:row.production,rowDeltas:deltaRows(row.rowDeltas),bomLines:orderPatch.itemInventory[row.lineId!].production.bomLines,lotBaseId:row.lotBaseId,commandIndices:commandIndices[index]}))}:{})};
  for(const effect of effectSet)validateFullDocument(fullCodec(db).decode(effect.nativeText));validateFullDocument(plan.orderPatch);
  return {status:'planned' as const,plan};
  }
  return await buildFullEffectsFromRows();
 }catch(error){return {status:'blocked',reason:error instanceof FullRejected?error.reason:['invalid-selection','unsupported-selection','invalid-output'].includes((error as any)?.code)?(error as any).code:'read-or-full-plan-failed'};}
}


export const fullAttemptId=(reference:FullReference,uid:string)=>fullHash(JSON.stringify([FULL_PROTOCOL,reference.companyId,uid,reference.orderId,reference.requestId]));
/** 준비의 가상 B와 적용의 현재 B가 같은 최종 쓰기·영수증을 조립한다. 이 함수는 DB를 읽거나 쓰지 않는다. */
export function materializeOrderStockFullTerminal(db:Firestore,plan:OrderStockFullPlan,saved:FullRow,current:ReadonlyMap<string,FullRow|undefined>,mode:'apply'|'cancel',clock:ReservationPreviewClock){
 const {text,decode}=fullCodec(db),reference=saved.reference as FullReference,orderPath='orders/'+reference.orderId,attemptPath=FULL_ATTEMPTS+'/'+saved.attemptId,order=current.get(orderPath);
 if(!order)fullReject('missing-or-cross-company');
 const expectedB=new Map<string,string>(saved.expectedB.map((row:FullRow)=>[row.path,row.nativeText]));
 const advance=(before:FullRow|undefined,patch:FullRow)=>{try{return advanceInventoryWriterProtocol(before,patch);}catch{fullReject('invalid-writer-protocol');}};
 const writes=new Map<string,{operation:'create'|'update';data:FullRow}>();
 const add=(path:string,data:FullRow,operation:'create'|'update'='update')=>{fullPath(path);if(writes.has(path))fullReject('duplicate-effect-path','conflict');writes.set(path,{operation,data});};
 if(mode==='apply')for(const effect of plan.effectSet){fullPath(effect.path);const before=plan.readSet.find(row=>row.path===effect.path);if(!before||before.kind==='digest'||effect.operation!==(before.exists?'update':'create')||!['items','rawInventories','rawMaterialLedger','productionRecords'].includes(effect.path.split('/')[0]))fullReject('invalid-effect-collection','conflict');add(effect.path,decode(effect.nativeText),effect.operation);}
 const allocation=new Map<string,number>(plan.preview.allocationQuantities),previous=new Map((plan.originalAllocationRows??[]).map(row=>[row.itemId,row.rows]));
 for(const id of plan.itemIds){const path='items/'+id,before=current.get(path)!,ownedRow=saved.ownRows.find((row:FullRow)=>row.itemId===id),existing=writes.get(path),patch=existing?.data??{};if(mode==='cancel'&&!ownedRow)continue;const reservations=(before.inventoryReservations??[]).filter((row:FullRow)=>(!ownedRow||text(row)!==text(ownedRow.row))&&(mode!=='apply'||!(previous.get(id)??[]).some(prior=>text(prior)===text(row))));
  if(mode==='apply'&&allocation.has(id))reservations.push({reservationAttemptId:saved.lock.nonce,operationId:saved.lock.id,orderId:reference.orderId,qty:allocation.get(id),createdAt:plan.clock.now,state:'allocated'});
  if(ownedRow||existing||mode==='apply'&&(allocation.has(id)||previous.has(id)))writes.set(path,{operation:'update',data:advance(before,{...patch,...(ownedRow||mode==='apply'&&(allocation.has(id)||previous.has(id))?{inventoryReservations:reservations}:{})})});
 }
 // 같은 원료 경로는 최초 revision에서 한 번만 증가시킨다.
 for(const [path,write]of writes)if(path.startsWith('rawInventories/')||path.startsWith('rawMaterialLedger/'))write.data=advance(current.get(path),write.data);
 add(orderPath,withOrderListProjection(order,advance(order,mode==='apply'?plan.orderPatch:{inventoryOperation:null}),'patch'));
 const auditPath='orderStatusAudits/'+plan.audit.id,audit=current.get(auditPath);
 if(text(audit??null)!==expectedB.get(auditPath))fullReject('audit-conflict','conflict');
 add(auditPath,{...plan.audit,state:mode==='apply'?'completed':'cancelled',completedAt:clock.now,fullProtocol:FULL_PROTOCOL});
 const state=mode==='apply'?'applied':'cancelled',receipt={state,at:clock.now,fullPlanHash:saved.fullPlanHash,effects:[...writes].map(([path,write])=>({path,hash:fullHash(text(write.data))}))},next={...saved,state,receipt,receiptHash:fullHash(text(receipt))};
 fullBudget(db,next,[...[...writes].map(([path,write])=>({path,data:write.data})),{path:attemptPath,data:next}]);
 return {writes,next};
}
