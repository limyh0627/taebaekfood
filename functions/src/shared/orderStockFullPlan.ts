import {createFullHistoricalEvidenceContext} from './orderStockFullEvidence';
import type {FullReference} from './orderStockFullCommand';
import {commandHash} from './rawInventoryCore';
import {prepareOrderStockFullLineBasis,validateFullLineIntent} from './orderStockFullLinePlan';
import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {encodeCatalogValue,decodeCatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';
import {prepareOrderStockReservationBasis,readOrderStockPlanningSource,type ReservationPreviewActor,type ReservationPreviewClock} from './orderStockExecutionPlan';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {ensureOrderLineIds,aggregateOrderLineInventory,type OrderRawEffectOrigin} from './orderLineInventory';
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
export interface OrderStockFullPlan {version:1;protocol:typeof FULL_PROTOCOL;intent:FullRow;owner:FullRow;clock:ReservationPreviewClock;preview:FullRow;actorDisplay:string;partnerDisplay:string;readSet:FullEvidence[];effectSet:FullEffect[];orderPatch:FullRow;audit:FullRow;itemIds:string[];productionDeltas:[string,number][];shipmentDeltas:[string,number][];originalAllocationRows?:{itemId:string;rows:FullRow[]}[];linePlans?:FullRow[];readEvidenceVersion?:2;historyQueries?:FullHistoryQuery[];reversalOf?:{lineId:string;attempt:number;sourceReference:OrderRawEffectOrigin['reference'];sourceOwner:OrderRawEffectOrigin['owner'];sourceLineNativeSha256:string}}
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
/** 문서/수량을 받지 않고 서버 내부 원 함수 참조만 연결한다. */
export function createOrderStockFullEvidenceContext(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor,intent:FullRow){
 return createFullHistoricalEvidenceContext({tx,db,companyId:intent.companyId,orderId:intent.orderId,selfAttemptPath:FULL_ATTEMPTS+'/'+fullAttemptId({version:1,companyId:intent.companyId,orderId:intent.orderId,requestId:intent.requestId},actor.uid),codec:fullCodec(db),hash:fullHash,reject:fullReject,usable:fullUsable,materializeTerminal:materializeOrderStockFullTerminal,infrastructure:{protocol:FULL_PROTOCOL,attempts:FULL_ATTEMPTS,object:fullObject,id:fullId,path:fullPath,snapshotNative:fullSnapshotNative,nativeReads:fullNativeReads,validateReadEvidence:validateFullReadEvidence,attemptId:fullAttemptId,isRejected:error=>error instanceof FullRejected}});
}
export async function prepareOrderStockFullPlan(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor|null|undefined,intent:unknown,clock:ReservationPreviewClock):Promise<{status:'planned';plan:OrderStockFullPlan}|{status:'blocked';reason:string}>{
 try{
  let context:ReturnType<typeof createOrderStockFullEvidenceContext>|undefined;
  const historical=()=>context??=createOrderStockFullEvidenceContext(tx,db,actor!,intent as FullRow);
  const nativeTx={get:async(ref:any)=>historical().tx.get(ref)};
  const {text}=fullCodec(db);let lineBasis:ReturnType<typeof prepareOrderStockFullLineBasis>|undefined;let preEmployee:any;
  let basis:Extract<Awaited<ReturnType<typeof prepareOrderStockReservationBasis>>,{status:'basis'}>|ReturnType<typeof prepareOrderStockFullLineBasis>;
  if(fullObject(intent)&&intent.action==='line-forward'){
   const input=validateFullLineIntent(intent);if(!clock||typeof clock.now!=='string'||!Number.isFinite(clock.nowMs)||!Number.isFinite(Date.parse(clock.now))||Date.parse(clock.now)!==clock.nowMs||new Date(clock.nowMs).toISOString()!==clock.now)fullReject('invalid-clock');if(!actor||!fullObject(actor.token)||actor.token.companyId!==input.companyId||!fullId(actor.token.employeeId)||!actor.uid)fullReject('permission-denied');
   const source=await readOrderStockPlanningSource(nativeTx as Pick<Transaction,'get'>,db,actor,input,clock);if(source.status!=='source')return {status:'blocked',reason:context?.nativeFailure??source.reason};
   preEmployee=await nativeTx.get(db.doc('employees/'+actor.token.employeeId));const employee=preEmployee.data();if(!employee||employee.authUid!==actor.uid||(employee.companyId??'taebaek')!==input.companyId||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
   lineBasis=prepareOrderStockFullLineBasis(source,input,employee.name,clock,text);basis=lineBasis;
  }else {const result=await prepareOrderStockReservationBasis(nativeTx as Pick<Transaction,'get'>,db,actor,intent,clock);if(result.status!=='basis')return {status:'blocked',reason:context?.nativeFailure??result.reason};basis=result;}
  const {catalog,orderSnapshot,productionDeltas,shipmentDeltas}=basis,preview:FullRow=basis.preview,company=preview.intent.companyId;
  async function buildFullEffectsFromRows(){
  const order=orderSnapshot.data()!;fullUsable(order,company,preview.intent.orderId);
  if(!lineBasis&&isStockProduction(order)&&['SHIPPED','DELIVERED'].includes(preview.intent.targetStatus))fullReject('stock-production-cannot-ship');
  if(!lineBasis&&requiresCompleteItemsForStatusChange(order.status as OrderStatus,preview.intent.targetStatus as OrderStatus)&&!hasCompleteOrderItems(order.items))fullReject('incomplete-order-items');
  // 계산 입력 native도 path-only codec에 도달하기 전에 같은 DB인지 확인한다.
  for(const collection of catalog.observation.collections)for(const document of collection.documents)text(document.data);
  const history=historical(),original=history.native,effects=new Map<string,FullRow>(),read=history.readNative;
  await read('orders/'+preview.intent.orderId);
  const employeeId=preview.owner.employeeId;if(!fullId(employeeId))fullReject('permission-denied');
  const employee=await read('employees/'+employeeId);
  if(!employee||employee.authUid!==preview.owner.uid||(employee.companyId??'taebaek')!==company||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
  let partnerDisplay=typeof order.partnerName==='string'?order.partnerName:'';
  if(order.partnerId){if(!fullId(order.partnerId))fullReject('invalid-partner');const partner=await read('partners/'+order.partnerId);if(partner){if((partner.companyId??'taebaek')!==company)fullReject('permission-denied');if(typeof partner.name==='string')partnerDisplay=partner.name;}}
  const itemIds=new Set<string>(preview.stockSnapshot.map(([id]:[string,number])=>id));
  const item=async(id:string)=>{const path='items/'+id;if(!original.has(path)){const observed=catalog.observation.collections[0].documents.find(row=>row.id===id);if(!observed)fullReject('touched-item-missing');await read(path);}const row=original.get(path)!;fullUsable(row,company,id);if(await read('inventoryWriterDeletions/'+company+'__'+id))fullReject('blocked-retired-or-history');itemIds.add(id);return row;};
  for(const id of itemIds)await item(id);
  const originOf=(lineId:string,attempt:number):OrderRawEffectOrigin=>({protocol:FULL_PROTOCOL,reference:{version:1,companyId:company,orderId:preview.intent.orderId,requestId:preview.intent.requestId},owner:preview.owner,lineId,attempt});

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
  if(lineBasis)await history.verifyCurrentLineHistory();
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
  const plan:OrderStockFullPlan={version:1,readEvidenceVersion:2,historyQueries:history.historyQueries,protocol:FULL_PROTOCOL,intent:preview.intent,owner:preview.owner,clock,preview,actorDisplay:employee.name,partnerDisplay,readSet:history.readSet,effectSet,orderPatch:fullCodec(db).decode(text(withOrderListProjection(order,orderPatch,'patch'))),audit,itemIds:[...itemIds],productionDeltas:[...productionDeltas],shipmentDeltas:[...shipmentDeltas],...(lineBasis?{originalAllocationRows:lineBasis.previousAllocationRows,linePlans:rows.map((row,index)=>({lineId:row.lineId,index:row.index,attempt:row.attempt,production:row.production,rowDeltas:deltaRows(row.rowDeltas),bomLines:orderPatch.itemInventory[row.lineId!].production.bomLines,lotBaseId:row.lotBaseId,commandIndices:commandIndices[index]}))}:{})};
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
 if(mode==='apply')for(const effect of plan.effectSet){fullPath(effect.path);const before=plan.readSet.find(row=>row.path===effect.path);if(!before||before.kind==='digest'||effect.operation!==(before.exists?'update':'create')||!['items','rawInventories','rawMaterialLedger','rawInventoryReversalGuards','productionRecords'].includes(effect.path.split('/')[0]))fullReject('invalid-effect-collection','conflict');if(effect.path.startsWith('rawInventoryReversalGuards/')&&plan.intent.action!=='line-reverse')fullReject('invalid-effect-collection','conflict');add(effect.path,decode(effect.nativeText),effect.operation);}
 const allocation=new Map<string,number>(plan.preview.allocationQuantities),previous=new Map((plan.originalAllocationRows??[]).map(row=>[row.itemId,row.rows]));
 for(const id of plan.itemIds){const path='items/'+id,before=current.get(path)!,ownedRow=saved.ownRows.find((row:FullRow)=>row.itemId===id),existing=writes.get(path),patch=existing?.data??{};if(mode==='cancel'&&!ownedRow)continue;const reservations=(before.inventoryReservations??[]).filter((row:FullRow)=>(!ownedRow||text(row)!==text(ownedRow.row))&&(mode!=='apply'||!(previous.get(id)??[]).some(prior=>text(prior)===text(row))));
  if(mode==='apply'&&allocation.has(id))reservations.push({reservationAttemptId:saved.lock.nonce,operationId:saved.lock.id,orderId:reference.orderId,qty:allocation.get(id),createdAt:plan.clock.now,state:'allocated'});
  if(ownedRow||existing||mode==='apply'&&(allocation.has(id)||previous.has(id)))writes.set(path,{operation:'update',data:advance(before,{...patch,...(ownedRow||mode==='apply'&&(allocation.has(id)||previous.has(id))?{inventoryReservations:reservations}:{})})});
 }
 // 같은 원료 경로는 최초 revision에서 한 번만 증가시킨다.
 for(const [path,write]of writes)if(path.startsWith('rawInventories/')||path.startsWith('rawMaterialLedger/')||path.startsWith('rawInventoryReversalGuards/'))write.data=advance(current.get(path),write.data);
 add(orderPath,withOrderListProjection(order,advance(order,mode==='apply'?plan.orderPatch:{inventoryOperation:null}),'patch'));
 const auditPath='orderStatusAudits/'+plan.audit.id,audit=current.get(auditPath);
 if(text(audit??null)!==expectedB.get(auditPath))fullReject('audit-conflict','conflict');
 add(auditPath,{...plan.audit,state:mode==='apply'?'completed':'cancelled',completedAt:clock.now,fullProtocol:FULL_PROTOCOL});
 const state=mode==='apply'?'applied':'cancelled',receipt={state,at:clock.now,fullPlanHash:saved.fullPlanHash,effects:[...writes].map(([path,write])=>({path,hash:fullHash(text(write.data))}))},next={...saved,state,receipt,receiptHash:fullHash(text(receipt))};
 fullBudget(db,next,[...[...writes].map(([path,write])=>({path,data:write.data})),{path:attemptPath,data:next}]);
 return {writes,next};
}
