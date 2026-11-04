import {holdsUnitStockPure} from './itemInventoryKind';
import {stockShortageError} from './stockShortage';
import type {Firestore} from 'firebase-admin/firestore';
import {fullCodec,fullHash,fullId,fullObject,fullReject} from './orderStockFullPlan';
import {isFullLinePlainJson} from './orderStockFullLinePlan';
import {isCalendarDay} from './orderPlanPrimitives';

export interface FullShipmentIntent {
 version:1;requestId:string;companyId:'taebaek'|'punghoe';orderId:string;action:'shipment-forward';targetStatus:'SHIPPED'|'DELIVERED';expectedOrder:{version:1;nativeSha256:string};deliveredAt?:string;
}
export function validateFullShipmentIntent(input:unknown):FullShipmentIntent {
 if(!isFullLinePlainJson(input)||!fullObject(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>16384||Reflect.ownKeys(input).some(key=>typeof key!=='string'||!['version','requestId','companyId','orderId','action','targetStatus','expectedOrder','deliveredAt'].includes(key))||input.version!==1||!fullId(input.requestId)||!fullId(input.orderId)||!['taebaek','punghoe'].includes(input.companyId)||input.action!=='shipment-forward'||!['SHIPPED','DELIVERED'].includes(input.targetStatus)||!fullObject(input.expectedOrder)||Object.keys(input.expectedOrder).sort().join(',')!=='nativeSha256,version'||input.expectedOrder.version!==1||typeof input.expectedOrder.nativeSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedOrder.nativeSha256))fullReject('invalid-input');
 if(Object.prototype.hasOwnProperty.call(input,'deliveredAt')&&(input.targetStatus!=='DELIVERED'||typeof input.deliveredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(input.deliveredAt)||!isCalendarDay(input.deliveredAt.slice(0,10))))fullReject('invalid-input');
 return input as FullShipmentIntent;
}
export function fullShipmentTargetSha(db:Firestore,companyId:string,orderId:string,targetStatus:'SHIPPED'|'DELIVERED',order:Record<string,unknown>):string {
 return fullHash(fullCodec(db).text({version:1,purpose:'full-shipment-target',companyId,orderId,targetStatus,order}));
}
import type {Transaction} from 'firebase-admin/firestore';
import type {ReservationPreviewActor,ReservationPreviewClock} from './orderStockExecutionPlan';
import {readOrderStockPlanningSource} from './orderStockExecutionPlan';
import {assertFullActorScope,assertFullEmployeeScope,createOrderStockFullEvidenceContext,fullUsable,fullAttemptId,FULL_PROTOCOL,FullRejected,type FullRow,type FullEffect,type OrderStockFullPlan} from './orderStockFullPlan';
import {ensureOrderLineIds} from './orderLineInventory';
import {prepareFullLineAllocation,validateFullLineHistory} from './orderStockFullLinePlan';
import {orderStockTouchedIds,planOrderStockReservation} from './orderStockReservationPlan';
import {createOrderProductionPlanner} from './orderProductionPlanner';
import {createOrderProductLotPlanner,pruneDepletedLotsAtCutoff,productLotKstCutoff} from './orderProductLotPlan';
import {buildProductLot,withCarryOverProductLot} from './productLot';
import {shipQtyOfLine} from './orderStockUnits';
import {isStockProduction,stock3,type ProductionOrder} from './orderProductionDomain';
import {hasCompleteOrderItems} from './orderCompletion';
import {kstDateOf} from './calculation';
import {withOrderListProjection} from './orderListProjectionWrite';
import {assertTransferAssignment} from './orderProductionBatchTransferPlan';
import {operationDocId} from './rawInventoryCore';
import {deriveOrderCompletionProjection,toQuantityMilli,type BatchAssignment} from './orderProductionBatchContract';

/** 같은 거래의 읽기 초안이며 현재 terminal을 실행할 권한은 없다. */
export async function prepareOrderStockFullShipmentDraft(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,clock:ReservationPreviewClock):Promise<{status:'draft';executionAllowed:false;terminalValidated:false;plan:OrderStockFullPlan}|{status:'blocked';reason:string}>{
 let history:ReturnType<typeof createOrderStockFullEvidenceContext>|undefined;
 try {
  const intent=validateFullShipmentIntent(input);
  if(!clock||typeof clock.now!=='string'||!Number.isFinite(clock.nowMs)||!Number.isFinite(Date.parse(clock.now))||Date.parse(clock.now)!==clock.nowMs||new Date(clock.nowMs).toISOString()!==clock.now)fullReject('invalid-clock');
  assertFullActorScope(actor,intent.companyId);
  const owner={uid:actor.uid,employeeId:actor.token.employeeId,companyId:intent.companyId},reference={version:1 as const,companyId:intent.companyId,orderId:intent.orderId,requestId:intent.requestId};
  history=createOrderStockFullEvidenceContext(tx,db,actor,intent);const read=history.readNative,{text}=fullCodec(db);
  const source=await readOrderStockPlanningSource(history.tx,db,actor,intent,clock,false,history.verifyRetirementHistory);if(source.status!=='source')return {status:'blocked',reason:history.retirementFailure?.reason??history.nativeFailure??source.reason};
  const {order,catalog}=source;await read('orders/'+intent.orderId);fullUsable(order,intent.companyId,intent.orderId);
  const employee=await read('employees/'+owner.employeeId);assertFullEmployeeScope(employee,owner);
  if(order.actorUid!==undefined&&order.actorUid!==owner.uid)fullReject('permission-denied');
  if(['inventoryOperation','rawInventoryJobId'].some(key=>order[key]!=null&&order[key]!==false))fullReject('unsupported-existing-work');
  if(fullShipmentTargetSha(db,intent.companyId,intent.orderId,intent.targetStatus,order)!==intent.expectedOrder.nativeSha256)fullReject('target-evidence-conflict','conflict');
  if(isStockProduction(order))fullReject('stock-production-cannot-ship');
  if(!((order.status==='DISPATCHED'&&!order.shippedOut)||(order.status==='SHIPPED'&&order.shippedOut===true&&intent.targetStatus==='DELIVERED')))fullReject('unsupported-status');
  const effects=new Map<string,FullRow>(),itemIds=new Set<string>(),originalAllocationRows:{itemId:string;rows:FullRow[]}[]=[],shipmentDeltas=new Map<string,number>(),consumed:FullRow[]=[];
  let orderPatch:FullRow,allocationIssuerNotApplicable=false;
  if(order.status==='SHIPPED') {
   await history.verifyCurrentShipment();
   orderPatch={status:'DELIVERED',...(intent.deliveredAt!==undefined?{deliveredAt:intent.deliveredAt}:{})};
  } else {
   if(!order.producedAt||!hasCompleteOrderItems(order.items))fullReject('incomplete-order-items');
   const planner=createOrderProductionPlanner(catalog),normalized=ensureOrderLineIds(order.items as ProductionOrder['items']),calculationOrder={...order,id:intent.orderId,items:normalized} as ProductionOrder;
   planner.shipOrder(calculationOrder,shipmentDeltas);
   if(order.itemInventory&&Object.keys(order.itemInventory).length){
    const states=validateFullLineHistory(order,intent,normalized,text),strict=new Set(Object.entries(states).filter(([,state])=>state.applied&&!state.rawEffectOrigin).map(([id])=>id));
    await history.verifyCurrentLineHistory(strict);
    const allocation=prepareFullLineAllocation(order,catalog,normalized,states,planner.shipOrder,intent,orderStockTouchedIds(calculationOrder,catalog.inputs.bom));
    await history.verifyCurrentAllocationIssuerRows();
    allocationIssuerNotApplicable=allocation.previousAllocation.size===0&&allocation.previousAllocationRows.length===0;
    const reservation=planOrderStockReservation(intent.orderId,allocation.dataByItem,()=>shipmentDeltas,{nowMs:clock.nowMs});if(reservation.shortages.length)fullReject('stock-shortage');
    for(const row of allocation.previousAllocationRows)originalAllocationRows.push(row);
    for(const id of allocation.ids)itemIds.add(id);
   } else {
    const {allocationEvidence:proof}=await history.verifyCurrentAggregateProduction(),quantities=new Map(proof.quantities.filter(([,qty])=>qty>0));
    for(const [id,delta] of shipmentDeltas)if(stock3(-delta)!==(quantities.get(id)??0))fullReject('invalid-previous-allocation');
    for(const [id,qty] of quantities)if(stock3(-(shipmentDeltas.get(id)??0))!==qty)fullReject('invalid-previous-allocation');
    const ids=new Set([...quantities.keys(),...orderStockTouchedIds(calculationOrder,catalog.inputs.bom)]),dataByItem=new Map<string,FullRow>();
    for(const observed of catalog.observation.collections[0].documents)if(Array.isArray(observed.data.inventoryReservations)&&observed.data.inventoryReservations.some((row:FullRow)=>row?.orderId===intent.orderId))ids.add(observed.id);
    for(const id of ids){
     const data=catalog.observation.collections[0].documents.find(row=>row.id===id)?.data;if(!data)fullReject('touched-item-missing');
     if(data.stock!==undefined&&(typeof data.stock!=='number'||!Number.isFinite(data.stock)||data.stock<0))fullReject('invalid-stock');
     if(data.inventoryReservations!==undefined&&!Array.isArray(data.inventoryReservations))fullReject('invalid-reservations');
     const own=(data.inventoryReservations??[]).filter((row:FullRow)=>row?.orderId===intent.orderId),qty=quantities.get(id);
     if(own.length!==(qty===undefined?0:1))fullReject('invalid-previous-allocation');
     if(qty!==undefined){const row=own[0];if(!fullObject(row)||row.orderId!==intent.orderId||row.qty!==qty||row.state!=='allocated'||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))fullReject('invalid-previous-allocation');
      originalAllocationRows.push({itemId:id,rows:own});
     }
     dataByItem.set(id,data);itemIds.add(id);
    }
    await history.verifyCurrentAllocationIssuerRows();
    allocationIssuerNotApplicable=quantities.size===0&&originalAllocationRows.length===0;
    const reservation=planOrderStockReservation(intent.orderId,dataByItem,()=>shipmentDeltas,{nowMs:clock.nowMs});if(reservation.shortages.length)fullReject('stock-shortage');
   }
   const item=async(id:string)=>{if(!fullId(id))fullReject('invalid-derived-document-path');const row=await read('items/'+id);fullUsable(row,intent.companyId,id);if(await read('inventoryWriterDeletions/'+intent.companyId+'__'+id))fullReject('blocked-retired-or-history');itemIds.add(id);return row!;};
   for(const id of itemIds)await item(id);
   const lotClock={now:clock.now,date:kstDateOf(new Date(clock.nowMs)),id:'full-product-lot'};
   const lotPlanner=createOrderProductLotPlanner({allItems:catalog.allItems,unitInputs:catalog.inputs,shipQtyOf:(line,product)=>shipQtyOfLine(line,product,catalog.inputs),lotPolicy:{buildProductLot:params=>buildProductLot(params,lotClock),withCarryOverProductLot:(lots,stock,material,kg,carry)=>withCarryOverProductLot(lots,stock,material,kg,carry,lotClock)}});
   for(const mutation of lotPlanner.deductProductLotsForOrder(calculationOrder)){const row=await item(mutation.itemId),result=mutation.apply(row.lots??[],row.stock??0);consumed.push(...result.consumedLots);effects.set('items/'+mutation.itemId,{...effects.get('items/'+mutation.itemId),lots:pruneDepletedLotsAtCutoff(result.lots,productLotKstCutoff(clock.now))});}
   for(const [id,delta]of shipmentDeltas){const row=await item(id),stock=stock3((row.stock??0)+delta);if(!Number.isFinite(stock)||stock<0)fullReject('stock-shortage');if(delta)effects.set('items/'+id,{...effects.get('items/'+id),stock});}
   const deltaRows=[...shipmentDeltas].filter(([,delta])=>delta!==0).map(([itemId,delta])=>({itemId,delta}));
   orderPatch={status:intent.targetStatus,shippedOut:true,shipmentConfirmedBy:employee!.name,shipmentConfirmedAt:clock.now,productConsumedLots:consumed,inventorySnapshots:{...order.inventorySnapshots,shipment:{capturedAt:clock.now,stockDeltas:deltaRows,bomLines:[],productConsumedLots:consumed}},...(intent.deliveredAt!==undefined?{deliveredAt:intent.deliveredAt}:{})};
  }
  let partnerDisplay=typeof order.partnerName==='string'?order.partnerName:'';
  if(order.partnerId){if(!fullId(order.partnerId))fullReject('invalid-partner');const partner=await read('partners/'+order.partnerId);if(partner){if((partner.companyId??'taebaek')!==intent.companyId)fullReject('permission-denied');if(typeof partner.name==='string')partnerDisplay=partner.name;}}
  const audit={id:FULL_PROTOCOL+':'+fullAttemptId(reference,owner.uid),orderId:intent.orderId,companyId:intent.companyId,partnerName:partnerDisplay,previousStatus:order.status,nextStatus:intent.targetStatus,approvedBy:employee!.name,approvedAt:clock.now,state:'processing',legacyEvidenceWarning:false,stockAdjustments:[...shipmentDeltas].filter(([,delta])=>delta!==0).map(([itemId,delta])=>({itemId,delta,name:catalog.allItems.find(row=>row.id===itemId)?.name??itemId,unit:catalog.allItems.find(row=>row.id===itemId)?.unit??'개'}))};
  if(await read('orderStatusAudits/'+audit.id))fullReject('orphan-status-audit');if(itemIds.size>200)fullReject('item-budget-exceeded');
  const effectSet:FullEffect[]=[...effects].map(([path,data])=>({path,operation:history!.native.get(path)?'update':'create',nativeText:text(data)}));
  const preview={intent,owner,...(allocationIssuerNotApplicable?{allocationIssuerNotApplicable:true}:{}),quantities:[],allocationQuantities:[],reservationDeltas:[],fixedClock:clock,orderText:text(order),orderHash:fullHash(text(order))};
  const plan:OrderStockFullPlan={version:1,protocol:FULL_PROTOCOL,intent,owner,clock,preview,actorDisplay:employee!.name,partnerDisplay,readSet:history.readSet,readEvidenceVersion:2,historyQueries:history.historyQueries,...(history.aggregateSourceQueries.length?{aggregateSourceQueries:history.aggregateSourceQueries}:{}),effectSet,orderPatch:withOrderListProjection(order,orderPatch,'patch'),audit,itemIds:[...itemIds],productionDeltas:[],shipmentDeltas:[...shipmentDeltas],originalAllocationRows};
  return {status:'draft',executionAllowed:false,terminalValidated:false,plan};
 } catch(error) {return {status:'blocked',reason:history?.retirementFailure?.reason??history?.nativeFailure??(error instanceof FullRejected?error.reason:'read-or-shipment-plan-failed')};}
}

/** 호출자가 같은 거래에서 검증한 원문만 넘기는 계산 초안이다. 이 자료형은 실행 권위가 아니다. */
export interface BatchConsumerSource {
 reference: import('./orderProductionBatchContract').BatchReference;
 ownerUid:string;
 plan:OrderStockFullPlan;
 receipt:FullRow;
 before:ReadonlyMap<string,FullRow|undefined>;
}
export interface BatchConsumerInput {
 db:Firestore;
 reference:import('./orderProductionBatchContract').BatchReference;
 owner:{uid:string;employeeId:string;companyId:'taebaek'|'punghoe'};
 actorDisplay:string;
 clock:ReservationPreviewClock;
 order:FullRow;
 orders:ReadonlyMap<string,FullRow|undefined>;
 assignments:readonly import('./orderProductionBatchContract').BatchAssignment[];
 items:ReadonlyMap<string,FullRow>;
 sourcePlans:readonly BatchConsumerSource[];
 currentDocuments:ReadonlyMap<string,FullRow|undefined>;
 catalog:Extract<import('./orderProductionCatalogInputs').CatalogDomainResult,{status:'assembled'}>;
}
export interface BatchOwnerTransition {orderId:string;itemId:string;removedRows:FullRow[];allocation:{qty:number;state:'allocated'}|null}
export interface BatchConsumerDraft {effects:FullEffect[];orderPatch:FullRow;assignmentsAfter:BatchAssignment[];ownerTransitions:BatchOwnerTransition[];requiredReads:string[];requiredQueries:string[];orderEffect?:{orderId:string;operation:'update'|'delete';nativeText:string|null};orderEffects?:{orderId:string;operation:'update'|'delete'|'create';nativeText:string|null}[]}

/** 변경 가능한 귀속 지분과 달리 생산 원출력과 원효과의 연결은 불변이다. */
export function assertBatchConsumerSources(input:Pick<BatchConsumerInput,'db'|'reference'|'assignments'|'sourcePlans'>):void {
 const {text,decode}=fullCodec(input.db),seen=new Set<string>();
 if(!input.sourcePlans?.length||!input.assignments?.length)throw Error('source-unproven');
 for(const assignment of input.assignments){
  assertTransferAssignment(assignment,input.reference);
  if(seen.has(assignment.batchId))throw Error('source-unproven');seen.add(assignment.batchId);
  const matches=input.sourcePlans.filter(source=>text(source.reference)===text(assignment.source.reference)&&source.ownerUid===assignment.source.ownerUid);
  if(matches.length!==1)throw Error('source-unproven');
  const source=matches[0],ext=source.plan.batchExtension;
  if(!source.receipt||!ext||source.plan.owner.uid!==source.ownerUid||source.plan.intent.companyId!==source.reference.companyId||source.plan.intent.orderId!==source.reference.orderId||source.plan.intent.requestId!==source.reference.requestId||fullAttemptId(source.reference,source.ownerUid)!==assignment.batchId)throw Error('source-unproven');
  const effects=ext.assignmentEffects.filter(effect=>effect.batchId===assignment.batchId&&effect.operation==='create');
  if(effects.length!==1)throw Error('source-unproven');
  const original=decode(effects[0].nativeText) as import('./orderProductionBatchContract').BatchAssignment;
  assertTransferAssignment(original,input.reference);
  const immutable=(output:import('./orderProductionBatchContract').BatchOutput)=>{const {claims:_claims,...rest}=output;return rest;};
  if(original.batchId!==assignment.batchId||original.companyId!==assignment.companyId||original.outputs.length!==assignment.outputs.length||text(original.source)!==text(assignment.source)||original.outputs.some(row=>{const current=assignment.outputs.find(value=>value.outputId===row.outputId);return !current||text(immutable(row))!==text(immutable(current));}))throw Error('source-unproven');
  const paths=new Set(source.plan.effectSet.map(effect=>effect.path));
  if(paths.size!==source.plan.effectSet.length)throw Error('source-unproven');
  for(const output of assignment.outputs){
   for(const id of output.productionEvidence.rawOperationIds)if(!paths.has('rawMaterialLedger/'+operationDocId(id)))throw Error('source-unproven');
   for(const id of output.productionEvidence.productionRecordIds)if(!paths.has('productionRecords/'+id))throw Error('source-unproven');
   for(const lot of output.productionEvidence.producedLots)if(!paths.has('items/'+lot.itemId))throw Error('source-unproven');
  }
 }
}

export function batchConsumerMissingSourceReads(input:Pick<BatchConsumerInput,'db'|'sourcePlans'>):string[] {
 const {text}=fullCodec(input.db);
 if(!input.sourcePlans?.length)throw Error('source-unproven');
 const missing=[...new Set(input.sourcePlans.flatMap(source=>source.plan.readSet.filter(row=>row.kind!=='digest'&&!source.before.has(row.path)).map(row=>row.path)))].sort();
 if(missing.length)return missing;
 for(const source of input.sourcePlans)for(const row of source.plan.readSet){if(row.kind==='digest')continue;const before=source.before.get(row.path);if(row.exists!==!!before||row.exists&&text(before)!==row.nativeText)throw Error('source-unproven');}
 return [];
}

export function batchConsumerProjection(input:BatchConsumerInput,assignments:readonly BatchAssignment[],revision:number,lastTransition?:import('./orderProductionBatchContract').OrderProductionRefsV1['lastTransition']) {
 const refs=input.order.orderProductionRefsV1;
 if(!refs||!Array.isArray(input.order.items)||!Array.isArray(refs.lines)||!Array.isArray(refs.activeAssignmentIds))throw Error('source-unproven');
 const claims=assignments.flatMap(batch=>batch.outputs.flatMap(output=>output.claims.filter(claim=>claim.orderId===input.reference.orderId).map(claim=>({lineId:claim.lineId,batchId:batch.batchId,outputId:output.outputId,fromMilli:claim.fromMilli,toMilli:claim.toMilli,state:claim.state}))));
 return deriveOrderCompletionProjection({rootOrderId:refs.rootOrderId,revision,lineIds:input.order.items.map((row:FullRow)=>row.lineId),claims,...(refs.splitFrom===undefined?{}:{splitFrom:refs.splitFrom}),...(lastTransition===undefined?{}:{lastTransition})});
}

/** 출고 효과 초안. 원천 및 바닥재고의 최종 권위는 호출 거래가 다시 확인한다. */
export function prepareBatchShipmentEffects(input:BatchConsumerInput & {targetStatus:'SHIPPED'|'DELIVERED';shipmentSource?:BatchConsumerSource;deliveredAt?:string}):BatchConsumerDraft {
 const {text}=fullCodec(input.db),order=input.order,reference=input.reference;
 if(input.owner.companyId!==reference.companyId||!input.owner.uid||typeof input.actorDisplay!=='string'||!input.actorDisplay.trim()||!Number.isFinite(input.clock.nowMs)||Date.parse(input.clock.now)!==input.clock.nowMs)throw Error('invalid-input');
 const missingSource=batchConsumerMissingSourceReads(input);
 if(missingSource.length)return {effects:[],orderPatch:{},assignmentsAfter:[],ownerTransitions:[],requiredReads:missingSource,requiredQueries:[]};
 assertBatchConsumerSources(input);
 if(text(batchConsumerProjection(input,input.assignments,order.orderProductionRefsV1.revision,order.orderProductionRefsV1.lastTransition))!==text(order.orderProductionRefsV1))throw Error('source-unproven');
 if(input.targetStatus==='DELIVERED'){
  const source=input.shipmentSource,shipment=order.inventorySnapshots?.shipment;
  if(!source||!source.receipt||source.reference.companyId!==reference.companyId||source.reference.orderId!==reference.orderId||source.plan.intent.companyId!==source.reference.companyId||source.plan.intent.orderId!==source.reference.orderId||source.plan.intent.requestId!==source.reference.requestId||source.plan.intent.action!=='shipment-forward'||source.plan.intent.targetStatus!=='SHIPPED'||source.plan.owner.uid!==source.ownerUid||order.status!=='SHIPPED'||order.shippedOut!==true||!shipment||text(source.plan.orderPatch.inventorySnapshots?.shipment)!==text(shipment)||text(source.plan.orderPatch.productConsumedLots)!==text(order.productConsumedLots))throw Error('shipment-source-required');
  if(input.deliveredAt!==undefined&&(!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(input.deliveredAt)||!isCalendarDay(input.deliveredAt.slice(0,10))))throw Error('invalid-input');
  const required=source.plan.readSet.filter(row=>row.kind!=='digest'&&!source.before.has(row.path)).map(row=>row.path).sort();
  if(required.length)return {effects:[],orderPatch:{},assignmentsAfter:[],ownerTransitions:[],requiredReads:required,requiredQueries:[]};
  for(const row of source.plan.readSet){if(row.kind==='digest')continue;const before=source.before.get(row.path);if(row.exists!==!!before||row.exists&&text(before)!==row.nativeText)throw Error('source-unproven');}
  const patch=withOrderListProjection(order,{status:'DELIVERED',approvedBy:input.actorDisplay,orderProductionRefsV1:batchConsumerProjection(input,input.assignments,order.orderProductionRefsV1.revision+1,{reference:input.reference,ownerUid:input.owner.uid}),...(input.deliveredAt===undefined?{}:{deliveredAt:input.deliveredAt})},'patch');
  return {effects:[],orderPatch:patch,assignmentsAfter:[...input.assignments],ownerTransitions:[],requiredReads:[],requiredQueries:[],orderEffects:[{orderId:reference.orderId,operation:'update',nativeText:text(patch)}]};
 }
 if(input.targetStatus!=='SHIPPED'||order.status!=='DISPATCHED'||order.shippedOut||!Array.isArray(order.items)||!hasCompleteOrderItems(order.items))throw Error('incomplete-order-items');
 const changes=new Map<string,number>(),lineTotals=new Map<string,number>();
 for(const assignment of input.assignments)for(const output of assignment.outputs)for(const claim of output.claims){
  if(claim.orderId!==reference.orderId||claim.state!=='allocated')continue;
  if(output.role!=='customer'||!('order' in output.unit))throw Error('source-unproven');
  const amount=(claim.toMilli-claim.fromMilli)/1000,qty=stock3(amount*output.unit.stock.unitsPerOrderUnit);
  toQuantityMilli(qty);lineTotals.set(claim.lineId,(lineTotals.get(claim.lineId)??0)+(claim.toMilli-claim.fromMilli));
  changes.set(output.itemId,stock3((changes.get(output.itemId)??0)-qty));
 }
 if(!changes.size||order.items.some((row:FullRow)=>{const projected=order.orderProductionRefsV1.lines.find((value:FullRow)=>value.lineId===row.lineId),ordered=row.isBoxUnit===true?row.boxQuantity:row.boxQuantity==null?row.quantity:undefined;return !projected||ordered===undefined||toQuantityMilli(projected.completedQty)!==toQuantityMilli(ordered)||toQuantityMilli(projected.completedQty)!==lineTotals.get(row.lineId);} ))throw Error('incomplete-order-items');
 const expected=new Map<string,number>();createOrderProductionPlanner(input.catalog).shipOrder(order as ProductionOrder,expected);
 if(text([...changes].sort())!==text([...expected].filter(([,n])=>n!==0).sort()))throw Error('shipment-quantity-mismatch');
 const missing=[...changes.keys()].filter(id=>!input.items.has(id)||!input.currentDocuments.has('items/'+id)).map(id=>'items/'+id);
 if(missing.length)return {effects:[],orderPatch:{},assignmentsAfter:[],ownerTransitions:[],requiredReads:missing.sort(),requiredQueries:[]};
 const rows=new Map<string,FullRow>(),transitions:BatchOwnerTransition[]=[];
 for(const [id,delta] of changes){
  const row=input.items.get(id),current=input.currentDocuments.get('items/'+id);
  if(!row||!current||text(row)!==text(current)||(row.companyId??'taebaek')!==reference.companyId||typeof row.stock!=='number'||!Number.isFinite(row.stock)||holdsUnitStockPure(row)&&!Array.isArray(row.inventoryReservations))throw Error('source-unproven');
  const own=(row.inventoryReservations??[]).filter((value:FullRow)=>value?.orderId===reference.orderId);
  if(holdsUnitStockPure(row)?own.length!==1||own[0].state!=='allocated'||own[0].qty!==-delta:own.length!==0)throw Error('invalid-previous-allocation');
  rows.set(id,row);transitions.push({orderId:reference.orderId,itemId:id,removedRows:own,allocation:null});
 }
 const shortages=planOrderStockReservation(reference.orderId,rows,()=>changes,{nowMs:input.clock.nowMs}).shortages;if(shortages.length)throw stockShortageError(shortages,id=>rows.get(id));
 const lotClock={now:input.clock.now,date:kstDateOf(new Date(input.clock.nowMs)),id:'batch-shipment'};
 const lotPlanner=createOrderProductLotPlanner({allItems:input.catalog.allItems,unitInputs:input.catalog.inputs,shipQtyOf:(line,product)=>shipQtyOfLine(line,product,input.catalog.inputs),lotPolicy:{buildProductLot:p=>buildProductLot(p,lotClock),withCarryOverProductLot:(lots,stock,material,kg,carry)=>withCarryOverProductLot(lots,stock,material,kg,carry,lotClock)}});
 const patches=new Map<string,FullRow>(),consumed:FullRow[]=[];
 for(const mutation of lotPlanner.deductProductLotsForOrder(order as ProductionOrder)){const row=rows.get(mutation.itemId);if(!row)throw Error('source-unproven');const result=mutation.apply(row.lots??[],row.stock);consumed.push(...result.consumedLots);patches.set(mutation.itemId,{lots:pruneDepletedLotsAtCutoff(result.lots,productLotKstCutoff(input.clock.now))});}
 for(const [id,delta] of changes){const row=rows.get(id)!;patches.set(id,{...patches.get(id),stock:stock3(row.stock+delta)});}
 const assignmentsAfter=input.assignments.map(batch=>{let changed=false;const outputs=batch.outputs.map(output=>{const claims=output.claims.map(claim=>{if(claim.orderId!==reference.orderId||claim.state!=='allocated')return claim;changed=true;return {...claim,state:'shipped' as const,lastReference:reference};});return {...output,claims};});return changed?{...batch,revision:batch.revision+1,outputs,lastTransfer:{reference,ownerUid:input.owner.uid,at:input.clock.now}}:batch;});
 const orderPatch=withOrderListProjection(order,{status:'SHIPPED',shippedOut:true,shipmentConfirmedBy:input.actorDisplay,shipmentConfirmedAt:input.clock.now,productConsumedLots:consumed,inventorySnapshots:{...order.inventorySnapshots,shipment:{capturedAt:input.clock.now,stockDeltas:[...changes].map(([itemId,delta])=>({itemId,delta})),bomLines:[],productConsumedLots:consumed}},orderProductionRefsV1:batchConsumerProjection(input,assignmentsAfter,order.orderProductionRefsV1.revision+1,{reference:input.reference,ownerUid:input.owner.uid})},'patch');
 return {effects:[...patches].map(([id,patch])=>({path:'items/'+id,operation:'update' as const,nativeText:text(patch)})),orderPatch,assignmentsAfter,ownerTransitions:transitions,requiredReads:[],requiredQueries:[],orderEffects:[{orderId:reference.orderId,operation:'update',nativeText:text(orderPatch)}]};
}
