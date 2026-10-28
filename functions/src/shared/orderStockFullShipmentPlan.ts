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

/** 같은 거래의 읽기 초안이며 현재 terminal을 실행할 권한은 없다. */
export async function prepareOrderStockFullShipmentDraft(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,clock:ReservationPreviewClock):Promise<{status:'draft';executionAllowed:false;terminalValidated:false;plan:OrderStockFullPlan}|{status:'blocked';reason:string}>{
 let history:ReturnType<typeof createOrderStockFullEvidenceContext>|undefined;
 try {
  const intent=validateFullShipmentIntent(input);
  if(!clock||typeof clock.now!=='string'||!Number.isFinite(clock.nowMs)||!Number.isFinite(Date.parse(clock.now))||Date.parse(clock.now)!==clock.nowMs||new Date(clock.nowMs).toISOString()!==clock.now)fullReject('invalid-clock');
  assertFullActorScope(actor,intent.companyId);
  const owner={uid:actor.uid,employeeId:actor.token.employeeId,companyId:intent.companyId},reference={version:1 as const,companyId:intent.companyId,orderId:intent.orderId,requestId:intent.requestId};
  history=createOrderStockFullEvidenceContext(tx,db,actor,intent);const read=history.readNative,{text}=fullCodec(db);
  const source=await readOrderStockPlanningSource(history.tx,db,actor,intent,clock);if(source.status!=='source')return {status:'blocked',reason:history.nativeFailure??source.reason};
  const {order,catalog}=source;await read('orders/'+intent.orderId);fullUsable(order,intent.companyId,intent.orderId);
  const employee=await read('employees/'+owner.employeeId);assertFullEmployeeScope(employee,owner);
  if(order.actorUid!==undefined&&order.actorUid!==owner.uid)fullReject('permission-denied');
  if(['inventoryOperation','retirementId','retirementClaimPending','rawInventoryJobId'].some(key=>order[key]!=null&&order[key]!==false))fullReject('unsupported-existing-work');
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
     if(qty!==undefined){const row=own[0];if(proof.kind==='full'){
      const expected={reservationAttemptId:proof.reservationAttemptId,operationId:proof.operationId,orderId:intent.orderId,qty,createdAt:proof.createdAt,state:'allocated',...(proof.authorityVersion===1?{serverProtocol:'full-v1'}:{})};
      if(text(row)!==text(expected))fullReject('invalid-previous-allocation');
     }else if(!fullObject(row)||row.orderId!==intent.orderId||row.operationId!==proof.operationId||row.qty!==qty||row.state!=='allocated'||text(row.generation)!==text(proof.generation)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))fullReject('invalid-previous-allocation');
      originalAllocationRows.push({itemId:id,rows:own});
     }
     dataByItem.set(id,data);itemIds.add(id);
    }
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
 } catch(error) {return {status:'blocked',reason:history?.nativeFailure??(error instanceof FullRejected?error.reason:'read-or-shipment-plan-failed')};}
}
