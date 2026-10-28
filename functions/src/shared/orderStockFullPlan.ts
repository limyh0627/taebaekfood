import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {encodeCatalogValue,decodeCatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';
import {prepareOrderStockReservationBasis,type ReservationPreviewActor,type ReservationPreviewClock} from './orderStockExecutionPlan';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {ensureOrderLineIds} from './orderLineInventory';
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
export interface FullEvidence {path:string;exists:boolean;version:{seconds:number;nanoseconds:number}|null;nativeText:string}
export interface FullEffect {path:string;operation:'create'|'update';nativeText:string}
export interface OrderStockFullPlan {version:1;protocol:typeof FULL_PROTOCOL;intent:FullRow;owner:FullRow;clock:ReservationPreviewClock;preview:FullRow;actorDisplay:string;partnerDisplay:string;readSet:FullEvidence[];effectSet:FullEffect[];orderPatch:FullRow;audit:FullRow;itemIds:string[];productionDeltas:[string,number][];shipmentDeltas:[string,number][]}
export function fullPath(path:string){const parts=path.split('/');if(parts.length!==2||!fullId(parts[1])||!['orders','employees','partners','items','inventoryWriterDeletions','rawInventories','rawMaterialLedger','productionRecords','orderStatusAudits',FULL_ATTEMPTS].includes(parts[0]))fullReject('invalid-derived-document-path');}
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
  const basis=await prepareOrderStockReservationBasis(nativeTx as Pick<Transaction,'get'>,db,actor,intent,clock);if(basis.status!=='basis')return {status:'blocked',reason:nativeFailure??basis.reason};
  const {preview,catalog,orderSnapshot,productionDeltas,shipmentDeltas}=basis,{text}=fullCodec(db),company=preview.intent.companyId;
  const order=orderSnapshot.data()!;fullUsable(order,company,preview.intent.orderId);
  if(isStockProduction(order)&&['SHIPPED','DELIVERED'].includes(preview.intent.targetStatus))fullReject('stock-production-cannot-ship');
  if(requiresCompleteItemsForStatusChange(order.status as OrderStatus,preview.intent.targetStatus as OrderStatus)&&!hasCompleteOrderItems(order.items))fullReject('incomplete-order-items');
  // 계산 입력 native도 path-only codec에 도달하기 전에 같은 DB인지 확인한다.
  for(const collection of catalog.observation.collections)for(const document of collection.documents)text(document.data);
  const evidence=new Map<string,FullEvidence>(),original=new Map<string,FullRow|undefined>(),effects=new Map<string,FullRow>();
  function remember(path:string,data:FullRow|undefined,version:Timestamp|undefined){fullPath(path);text(data??null);original.set(path,data);evidence.set(path,{path,exists:data!==undefined,version:version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null,nativeText:text(data??null)});}
  remember('orders/'+preview.intent.orderId,order,orderSnapshot.updateTime);
  const read=async(path:string)=>{fullPath(path);if(!evidence.has(path)){const snap=await nativeTx.get(db.doc(path));remember(path,snap.data(),snap.updateTime);}return original.get(path);};
  const employeeId=preview.owner.employeeId;if(!fullId(employeeId))fullReject('permission-denied');
  const employee=await read('employees/'+employeeId);
  if(!employee||employee.authUid!==preview.owner.uid||(employee.companyId??'taebaek')!==company||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
  let partnerDisplay=typeof order.partnerName==='string'?order.partnerName:'';
  if(order.partnerId){if(!fullId(order.partnerId))fullReject('invalid-partner');const partner=await read('partners/'+order.partnerId);if(partner){if((partner.companyId??'taebaek')!==company)fullReject('permission-denied');if(typeof partner.name==='string')partnerDisplay=partner.name;}}
  const itemIds=new Set(preview.stockSnapshot.map(([id])=>id));
  const item=async(id:string)=>{const path='items/'+id;if(!evidence.has(path)){const observed=catalog.observation.collections[0].documents.find(row=>row.id===id);if(!observed)fullReject('touched-item-missing');remember(path,observed.data,observed.updateTime);}const row=original.get(path)!;fullUsable(row,company,id);if(await read('inventoryWriterDeletions/'+company+'__'+id))fullReject('blocked-retired-or-history');itemIds.add(id);return row;};
  for(const id of itemIds)await item(id);
  const attempt=(order.rawInventoryAttempt??0)+1;if(!Number.isSafeInteger(attempt)||attempt<1)fullReject('invalid-raw-attempt');
  const dayOf=(iso?:string)=>iso?.includes('T')&&Number.isFinite(Date.parse(iso))?kstDateOf(new Date(iso)):dateOfLocal(iso);
  const today=kstDateOf(new Date(clock.nowMs)),businessDate=dayOf(order.deliveredAt)||today;
  const commands=buildOrderRawCommands({orderId:preview.intent.orderId,physicalUsage:preview.plannerAggregate.rawUsage,ledgerOnlyUsage:preview.plannerAggregate.rawUsageLedgerOnly,attempt,allItems:catalog.allItems,companyId:company,businessDate,customerName:partnerDisplay,actorName:employee.name,names:selectOrderRawUsageNames(preview.plannerAggregate.rawUsage,preview.plannerAggregate.rawUsageLedgerOnly)}).commands;
  const rawOperations=new Set<string>(),rawMovementPaths=new Set<string>();
  for(const {command}of commands){
   const paths=new Set(['rawMaterialLedger/'+operationDocId(command.operationId),'rawMaterialLedger/'+legacyOperationDocId(command.operationId)]);
   if(rawOperations.has(command.operationId)||[...paths].some(path=>rawMovementPaths.has(path)))fullReject('duplicate-raw-operation-path');
   rawOperations.add(command.operationId);for(const path of paths){fullPath(path);rawMovementPaths.add(path);}
  }
  const rawVirtual=new Map<string,any>(),rawTraces:FullRow[]=[];
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
   effects.set(statePath,materializer.state());effects.set(movementPath,materializer.movement());
   if(materializer.hasGuard())fullReject('unexpected-forward-reversal-guard');
   const patch=materializer.itemPatch();if(patch)effects.set('items/'+command.rawItemId,{...(effects.get('items/'+command.rawItemId)??{}),...patch});
   const nextItem={...(rawVirtual.get(command.rawItemId)?.itemData??rawItem),...patch};rawVirtual.set(command.rawItemId,{state:result.state,itemData:nextItem});
   rawTraces.push(...orderRawTracesFromMovement(command,result.movement));
  }
  const normalizedItems=ensureOrderLineIds(order.items as ({itemId:string;quantity:number;lineId?:string})[]),normalizedOrder={...order,id:preview.intent.orderId,companyId:company,partnerName:partnerDisplay,items:normalizedItems};
  const generation={contractVersion:1 as const,companyId:company,orderId:preview.intent.orderId,operationId:FULL_PROTOCOL+':'+fullHash(text([company,preview.owner.uid,preview.intent.orderId,preview.intent.requestId])),actorUid:preview.owner.uid,startedAt:clock.now};
  const records=buildOrderProductionRecordPlan(normalizedOrder as any,catalog.allItems,catalog.inputs,generation,{dateOf:iso=>dayOf(iso??clock.now)});
  const recordHash=fullHash(text(records));
  for(const record of records.records){if(await read('productionRecords/'+record.id))fullReject('orphan-production-record');for(const legacy of record.legacySourceCandidates??[])if(await read('productionRecords/'+legacy.recordId))fullReject('orphan-production-record');effects.set('productionRecords/'+record.id,record);}
  const lotClock={now:clock.now,date:today,id:'full-product-lot'};
  const lots=createOrderProductLotPlanner({allItems:catalog.allItems,unitInputs:catalog.inputs,shipQtyOf:(line,product)=>shipQtyOfLine(line,product,catalog.inputs),lotPolicy:{buildProductLot:params=>buildProductLot(params,lotClock),withCarryOverProductLot:(ls,stock,material,kg,carry)=>withCarryOverProductLot(ls,stock,material,kg,carry,lotClock)}});
  const productionLots=lots.productionProductLots(productionDeltas,preview.intent.orderId+'-'+attempt),shipped=!isStockProduction(order)&&['SHIPPED','DELIVERED'].includes(preview.intent.targetStatus),consumed:FullRow[]=[];
  const mutations=lots.combineProductLotMutations([...productionLots.mutations,...(shipped?lots.deductProductLotsForOrder(normalizedOrder):[])]);
  const finalDeltas=new Map(productionDeltas);if(shipped)for(const [id,delta]of shipmentDeltas)finalDeltas.set(id,(finalDeltas.get(id)??0)+delta);
  for(const mutation of mutations){const row=await item(mutation.itemId),result=mutation.apply(row.lots??[],row.stock??0);consumed.push(...result.consumedLots);effects.set('items/'+mutation.itemId,{...effects.get('items/'+mutation.itemId),lots:pruneDepletedLotsAtCutoff(result.lots,productLotKstCutoff(clock.now))});}
  for(const [id,delta]of finalDeltas){const row=await item(id),stock=stock3((row.stock??0)+delta);if(!Number.isFinite(stock)||stock<0)fullReject('invalid-final-stock');if(delta)effects.set('items/'+id,{...effects.get('items/'+id),stock});}
  const deltaRows=(map:Map<string,number>)=>[...map].filter(([,delta])=>delta!==0).map(([itemId,delta])=>({itemId,delta}));
  const bomLines=orderStockTouchedIds(order as any,catalog.inputs.bom).flatMap(parentItemId=>catalog.inputs.bom.of(parentItemId).map(line=>({parentItemId,childItemId:line.childId,quantity:line.qty})));
  const production={capturedAt:clock.now,stockDeltas:deltaRows(productionDeltas),productProducedLots:productionLots.traces,productConsumedLots:productionLots.consumedLots,rawCalculationEvidence:preview.plannerAggregate.rawCalculationEvidence??[],bomLines,rawConsumedLots:rawTraces,rawLedgerIds:rawLedgerDocIds(rawTraces as any)};
  const orderPatch:FullRow={status:preview.intent.targetStatus,items:normalizedItems,producedAt:clock.now,rawLotsDeducted:true,rawInventoryAttempt:attempt,rawConsumedLots:rawTraces,producedUnits:preview.plannerAggregate.producedUnits,productionRecordIndex:deriveNextProductionRecordIndex(records,recordHash),inventorySnapshots:{version:1,production},inventoryOperation:null};
  if(preview.plannerAggregate.autoBuilt.length)orderPatch.autoBuilt=preview.plannerAggregate.autoBuilt;
  if(shipped){orderPatch.shippedOut=true;orderPatch.productConsumedLots=consumed;orderPatch.inventorySnapshots.shipment={capturedAt:clock.now,stockDeltas:deltaRows(shipmentDeltas),bomLines:[],productConsumedLots:consumed};}
  const audit={id:generation.operationId,orderId:preview.intent.orderId,companyId:company,partnerName:partnerDisplay,previousStatus:order.status,nextStatus:preview.intent.targetStatus,approvedBy:employee.name,approvedAt:clock.now,state:'processing',legacyEvidenceWarning:false,stockAdjustments:deltaRows(finalDeltas).map(row=>{const i=catalog.allItems.find(i=>i.id===row.itemId);return {...row,name:i?.name??row.itemId,unit:i?.unit??'개'};})};
  // audit ID도 문서 segment로 쓸 수 있는 원 형태다. fake legacy receipt는 만들지 않는다.
  if(await read('orderStatusAudits/'+audit.id))fullReject('orphan-status-audit');
  if(itemIds.size>200)fullReject('item-budget-exceeded');
  const effectSet:FullEffect[]=[...effects].map(([path,data])=>({path,operation:original.get(path)?'update':'create',nativeText:text(data)}));
  const plan:OrderStockFullPlan={version:1,protocol:FULL_PROTOCOL,intent:preview.intent,owner:preview.owner,clock,preview,actorDisplay:employee.name,partnerDisplay,readSet:[...evidence.values()],effectSet,orderPatch:fullCodec(db).decode(text(withOrderListProjection(order,orderPatch,'patch'))),audit,itemIds:[...itemIds],productionDeltas:[...productionDeltas],shipmentDeltas:[...shipmentDeltas]};
  for(const effect of effectSet)validateFullDocument(fullCodec(db).decode(effect.nativeText));validateFullDocument(plan.orderPatch);
  return {status:'planned',plan};
 }catch(error){return {status:'blocked',reason:error instanceof FullRejected?error.reason:'read-or-full-plan-failed'};}
}

