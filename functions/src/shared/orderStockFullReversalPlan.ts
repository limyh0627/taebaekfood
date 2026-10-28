import {planOrderStockReservation} from './orderStockReservationPlan';
import type {Firestore,Transaction} from 'firebase-admin/firestore';
import type {ReservationPreviewActor,ReservationPreviewClock} from './orderStockExecutionPlan';
import {readOrderStockPlanningSource} from './orderStockExecutionPlan';
import {createOrderStockFullEvidenceContext,fullCodec,fullHash,fullId,fullObject,fullReject,FullRejected,fullUsable,validateFullDocument,FULL_PROTOCOL,type FullRow,type FullEffect,type OrderStockFullPlan} from './orderStockFullPlan';
import {isFullLinePlainJson,validateFullLineHistory,prepareFullLineAllocation} from './orderStockFullLinePlan';
import {ensureOrderLineIds,aggregateOrderLineInventory,completedLineAllocation,type OrderRawReversalOrigin} from './orderLineInventory';
import {createOrderProductionPlanner} from './orderProductionPlanner';
import {isStockProduction,stock3} from './orderProductionDomain';
import {workStatusFromItems} from './orderWorkStatus';
import {cancellationRawCommands} from './orderRawCommandPlan';
import {inventoryDocId,operationDocId,legacyOperationDocId} from './rawInventoryCore';
import {prepareRawCommand} from './rawInventoryPrepare';
import {buildPreparedRawWritePlan} from './rawPreparedWritePlan';
import {createOrderProductLotPlanner,pruneDepletedLotsAtCutoff,productLotKstCutoff} from './orderProductLotPlan';
import {buildProductLot,withCarryOverProductLot} from './productLot';
import {shipQtyOfLine} from './orderStockUnits';
import {withOrderListProjection} from './orderListProjectionWrite';
import {kstDateOf} from './calculation';

export interface FullLineReversalIntent {version:1;requestId:string;companyId:'taebaek'|'punghoe';orderId:string;action:'line-reverse';target:{index:number;lineId:string;itemId:string;attempt:number};expectedTarget:FullRow}
export function validateFullLineReversalIntent(input:unknown):FullLineReversalIntent{
 if(!isFullLinePlainJson(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>16384||!fullObject(input)||Object.keys(input).sort().join(',')!=='action,companyId,expectedTarget,orderId,requestId,target,version'||input.version!==1||!fullId(input.requestId)||!fullId(input.orderId)||!['taebaek','punghoe'].includes(input.companyId)||input.action!=='line-reverse'||!fullObject(input.target)||Object.keys(input.target).sort().join(',')!=='attempt,index,itemId,lineId'||!Number.isSafeInteger(input.target.index)||input.target.index<0||typeof input.target.lineId!=='string'||!input.target.lineId||!fullId(input.target.itemId)||!Number.isSafeInteger(input.target.attempt)||input.target.attempt<1||!fullObject(input.expectedTarget))fullReject('invalid-input');
 return input as FullLineReversalIntent;
}
/** 저장된 줄 snapshot과 검증된 원명령을 되돌린다. 현재 BOM으로 과거 수량을 만들지 않는다. */
export async function prepareOrderStockFullReversalPlan(tx:Pick<Transaction,'get'>,db:Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,clock:ReservationPreviewClock):Promise<{status:'planned';plan:OrderStockFullPlan}|{status:'blocked';reason:string}>{
 let history:ReturnType<typeof createOrderStockFullEvidenceContext>|undefined;
 try{
  const intent=validateFullLineReversalIntent(input);
  if(!clock||typeof clock.now!=='string'||!Number.isFinite(clock.nowMs)||!Number.isFinite(Date.parse(clock.now))||Date.parse(clock.now)!==clock.nowMs||new Date(clock.nowMs).toISOString()!==clock.now)fullReject('invalid-clock');
  if(!actor||!fullObject(actor.token)||actor.token.companyId!==intent.companyId||!fullId(actor.token.employeeId)||!actor.uid)fullReject('permission-denied');
  history=createOrderStockFullEvidenceContext(tx,db,actor,intent);const source=await readOrderStockPlanningSource(history.tx,db,actor,intent,clock);if(source.status!=='source')return {status:'blocked',reason:history.nativeFailure??source.reason};
  const {catalog,owner}=source,company=intent.companyId,{text,decode}=fullCodec(db),read=history.readNative,original=history.native,effects=new Map<string,FullRow>(),itemIds=new Set<string>();
  const order=(await read('orders/'+intent.orderId))!;fullUsable(order,company,intent.orderId);
  const employee=await read('employees/'+owner.employeeId);if(!employee||employee.authUid!==owner.uid||(employee.companyId??'taebaek')!==company||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
  if(!['PENDING','PROCESSING','DISPATCHED','ON_HOLD'].includes(order.status))fullReject('unsupported-status');
  if(order.shippedOut||['inventoryOperation','retirementId','retirementClaimPending','rawInventoryJobId'].some(key=>order[key]!=null&&order[key]!==false)||order.inventorySnapshots?.shipment)fullReject('unsupported-existing-work');
  const initialItems=ensureOrderLineIds(order.items as (FullRow&{itemId:string;lineId?:string;checked?:boolean})[]),before=initialItems[intent.target.index];
  if(before&&!isFullLinePlainJson(before))fullReject('unsupported-native-target');
  if(!before||before.itemId!==intent.target.itemId||before.lineId!==intent.target.lineId||text(before)!==text(intent.expectedTarget))fullReject('target-evidence-conflict','conflict');
  const states=validateFullLineHistory(order,intent,initialItems,text),state=states[intent.target.lineId];
  if(!before.checked||!state?.applied)fullReject('unsupported-existing-work');
  if(state.attempt!==intent.target.attempt)fullReject('target-evidence-conflict','conflict');
  if(!state.rawEffectOrigin||!Array.isArray(state.rawEffectReferences))fullReject('unsupported-legacy-reversal');
  const proof=await history.verifyCurrentLineHistory(),verified=proof.operationsByLine.get(intent.target.lineId)!;
  const nextItems=initialItems.map((row,index)=>index===intent.target.index?{...row,checked:false}:row),origin:OrderRawReversalOrigin={protocol:FULL_PROTOCOL,reference:{version:1,companyId:company,orderId:intent.orderId,requestId:intent.requestId},owner,lineId:intent.target.lineId,attempt:state.attempt,sourceReference:state.rawEffectOrigin.reference};
  const nextStates={...states};Object.defineProperty(nextStates,intent.target.lineId,{value:{...state,applied:false,reversedAt:clock.now,rawReversalOrigin:origin},enumerable:true,writable:true,configurable:true});
  const productionDeltas=new Map<string,number>();for(const row of state.production.stockDeltas)productionDeltas.set(row.itemId,stock3((productionDeltas.get(row.itemId)??0)-row.delta));
  const planner=createOrderProductionPlanner(catalog),requested=new Set([...productionDeltas.keys(),...(state.production.productProducedLots??[]).map(row=>row.itemId),...(state.production.productConsumedLots??[]).map(row=>row.itemId)]),allocation=prepareFullLineAllocation(order,catalog,initialItems,states,planner.shipOrder,intent,requested);
  for(const id of allocation.ids)itemIds.add(id);
  const item=async(id:string)=>{const observed=catalog.observation.collections[0].documents.find(row=>row.id===id);if(!observed)fullReject('touched-item-missing');const row=await read('items/'+id);fullUsable(row,company,id);if(await read('inventoryWriterDeletions/'+company+'__'+id))fullReject('blocked-retired-or-history');itemIds.add(id);return row!;};
  for(const id of itemIds)await item(id);
  const allocationQuantities=isStockProduction(order)?new Map<string,number>():completedLineAllocation(order as any,nextItems,nextStates,planner.shipOrder);
  // 원 producer와 같은 original.sequence 내림차순이며 동률은 원 순서를 보존한다.
  const ordered=verified.map((row,index)=>({...row,index})).sort((a,b)=>b.movement.sequence-a.movement.sequence||a.index-b.index),originals=new Map<string,string>();
  for(const row of ordered){if(originals.has(row.operationId))fullReject('duplicate-raw-operation-path');originals.set(row.operationId,row.rawItemId);}
  const commands=cancellationRawCommands({id:intent.orderId,companyId:company},originals,clock.now,employee.name),virtual=new Map<string,any>(),rawPaths=new Set<string>();
  for(const command of commands){
   if(command.kind!=='reverse')fullReject('invalid-reversal-command');
   if(productionDeltas.has(command.rawItemId)||requested.has(command.rawItemId))fullReject('unsupported-overlapping-item-effects');
   const rawItem=await item(command.rawItemId),statePath='rawInventories/'+inventoryDocId(company,command.rawItemId),movementPath='rawMaterialLedger/'+operationDocId(command.operationId),legacyPath='rawMaterialLedger/'+legacyOperationDocId(command.operationId),originalId=command.originalOperationId!,originalPath='rawMaterialLedger/'+operationDocId(originalId),oldOriginalPath='rawMaterialLedger/'+legacyOperationDocId(originalId),guardPath='rawInventoryReversalGuards/'+operationDocId(originalId);
   if(rawPaths.has(movementPath)||rawPaths.has(legacyPath))fullReject('duplicate-raw-operation-path');rawPaths.add(movementPath);rawPaths.add(legacyPath);
   const rawState=await read(statePath),movement=await read(movementPath),oldMovement=legacyPath===movementPath?undefined:await read(legacyPath),originalMovement=await read(originalPath),oldOriginal=oldOriginalPath===originalPath?undefined:await read(oldOriginalPath),guard=await read(guardPath);
   if(movement||oldMovement||guard)fullReject('unconfirmed-existing-raw-reversal');if(rawState)fullUsable(rawState,company,inventoryDocId(company,command.rawItemId));
   const snap=(row:any)=>({exists:()=>row!==undefined,data:()=>row}),rawRead={movementSnap:snap(movement),oldMovementSnap:snap(oldMovement),stateSnap:snap(rawState),itemSnap:snap(rawItem),originalSnap:snap(originalMovement),oldOriginalSnap:snap(oldOriginal),guardSnap:snap(guard)};
   const result=prepareRawCommand(command,rawRead,{now:clock.now},virtual.get(command.rawItemId));if(result.status!=='applied')fullReject('raw-command-'+result.status+('code'in result?':'+result.code:''));
   const materializer=buildPreparedRawWritePlan(command,rawRead,result);effects.set(statePath,materializer.state());effects.set(movementPath,materializer.movement());if(!materializer.hasGuard())fullReject('missing-reversal-guard');effects.set(guardPath,materializer.guard()!);const patch=materializer.itemPatch();if(patch)effects.set('items/'+command.rawItemId,{...(effects.get('items/'+command.rawItemId)??{}),...patch});virtual.set(command.rawItemId,{state:result.state,itemData:{...(virtual.get(command.rawItemId)?.itemData??rawItem),...patch}});
  }
  const lotClock={now:clock.now,date:kstDateOf(new Date(clock.nowMs)),id:'full-product-reversal'},lots=createOrderProductLotPlanner({allItems:catalog.allItems,unitInputs:catalog.inputs,shipQtyOf:(line,product)=>shipQtyOfLine(line,product,catalog.inputs),lotPolicy:{buildProductLot:params=>buildProductLot(params,lotClock),withCarryOverProductLot:(rows,stock,material,kg,carry)=>withCarryOverProductLot(rows,stock,material,kg,carry,lotClock)}}),mutations=lots.combineProductLotMutations([...lots.reverseProductionProductLots(state.production.productProducedLots),...lots.restoreProductLotsForOrder({items:[before]as any,productConsumedLots:state.production.productConsumedLots??[]})]);
  for(const mutation of mutations){const row=await item(mutation.itemId),result=mutation.apply(row.lots??[],row.stock??0);effects.set('items/'+mutation.itemId,{...(effects.get('items/'+mutation.itemId)??{}),lots:pruneDepletedLotsAtCutoff(result.lots,productLotKstCutoff(clock.now))});}
  for(const [id,delta]of productionDeltas){const row=await item(id),stock=stock3((row.stock??0)+delta);if(!Number.isFinite(stock)||stock<0)fullReject('invalid-final-stock');if(delta)effects.set('items/'+id,{...(effects.get('items/'+id)??{}),stock});}
  const postStock=new Map([...allocation.dataByItem].map(([id,row])=>[id,{...row,stock:effects.get('items/'+id)?.stock??row.stock??0}])),finalReservation=planOrderStockReservation(intent.orderId,postStock,()=>new Map([...allocationQuantities].map(([id,qty])=>[id,-qty])),{nowMs:clock.nowMs});const physicalReservation=planOrderStockReservation(intent.orderId,allocation.dataByItem,()=>productionDeltas,{nowMs:clock.nowMs});if(physicalReservation.shortages.length||finalReservation.shortages.length)fullReject('stock-shortage');

  const status=['PENDING','PROCESSING','DISPATCHED'].includes(order.status)?workStatusFromItems(nextItems):order.status,orderPatch=decode(text(withOrderListProjection(order,{items:nextItems,status,itemInventory:nextStates,...aggregateOrderLineInventory(order,nextStates),productionRecordIndex:order.productionRecordIndex??{},inventoryOperation:null},'patch')));
  const audit={id:FULL_PROTOCOL+':'+fullHash(text([company,owner.uid,intent.orderId,intent.requestId])),companyId:company,orderId:intent.orderId,from:order.status,to:status,actor:employee.name,actorUid:owner.uid,createdAt:clock.now,state:'processing'};if(await read('orderStatusAudits/'+audit.id))fullReject('orphan-audit');
  if(itemIds.size>200)fullReject('item-budget-exceeded');const effectSet:FullEffect[]=[...effects].map(([path,data])=>({path,operation:original.get(path)?'update':'create',nativeText:text(data)}));
  const preview={intent,owner,stockSnapshot:[...allocation.dataByItem].map(([id,row])=>[id,row.stock??0]),available:[...allocation.dataByItem].map(([id,row])=>[id,row.stock??0]),quantities:[],allocationQuantities:[...allocationQuantities],reservationDeltas:[],fixedClock:clock,orderText:text(order),orderHash:fullHash(text(order))};
  const plan:OrderStockFullPlan={version:1,protocol:FULL_PROTOCOL,intent,owner,clock,preview,actorDisplay:employee.name,partnerDisplay:typeof order.partnerName==='string'?order.partnerName:'',readSet:history.readSet,readEvidenceVersion:2,historyQueries:history.historyQueries,effectSet,orderPatch,audit,itemIds:[...itemIds],productionDeltas:[...productionDeltas],shipmentDeltas:[],originalAllocationRows:allocation.previousAllocationRows,reversalOf:{lineId:intent.target.lineId,attempt:state.attempt,sourceReference:state.rawEffectOrigin.reference,sourceOwner:state.rawEffectOrigin.owner,sourceLineNativeSha256:fullHash(text(state))}};
  for(const effect of effectSet)validateFullDocument(decode(effect.nativeText));validateFullDocument(orderPatch);return {status:'planned',plan};
 }catch(error){return {status:'blocked',reason:history?.nativeFailure??(error instanceof FullRejected?error.reason:'read-or-full-reversal-plan-failed')};}
}
