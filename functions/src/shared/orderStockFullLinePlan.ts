import {hasOrderInventoryGenerationCompletion} from './orderInventoryCompletionEvidence';
import {readOrderStockPlanningSource,type ReservationPreviewClock} from './orderStockExecutionPlan';
import {createOrderProductionPlanner,type StockUsePlan} from './orderProductionPlanner';
import {ensureOrderLineIds,aggregateOrderLineInventory,completedLineAllocation,type OrderItemInventoryState} from './orderLineInventory';
import {workStatusFromItems} from './orderWorkStatus';
import {isStockProduction,stock3} from './orderProductionDomain';
import {orderStockTouchedIds,planOrderStockReservation} from './orderStockReservationPlan';
import {rawLedgerDocIds} from './orderRawCommandPlan';
import {validateOrderInventoryGeneration} from './orderPlanPrimitives';
import {validateProductionRecordIndex} from './orderProductionRecordPlan';
import {fullReject,fullObject,fullId,fullHash,type FullRow} from './orderStockFullPlan';

export interface FullLineIntent {version:1;requestId:string;companyId:'taebaek'|'punghoe';orderId:string;action:'line-forward';target:{index:number;lineId:string;itemId:string};expectedTarget:FullRow;stockUsePlan?:StockUsePlan}
export type FullPlanningSource=Extract<Awaited<ReturnType<typeof readOrderStockPlanningSource>>,{status:'source'}>;
const jsonInput=(value:unknown,seen=new Set<object>()):boolean=>{if(value===null||['string','boolean'].includes(typeof value))return true;if(typeof value==='number')return Number.isFinite(value);if(!value||typeof value!=='object'||seen.has(value)||!Array.isArray(value)&&!fullObject(value))return false;seen.add(value);const result=Reflect.ownKeys(value).every(key=>{if(Array.isArray(value)&&key==='length')return true;const d=Object.getOwnPropertyDescriptor(value,key)!;return typeof key==='string'&&d.enumerable&&'value'in d&&jsonInput(d.value,seen);});seen.delete(value);return result;};
export function validateFullLineIntent(input:unknown):FullLineIntent {
 if(!jsonInput(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>16384)fullReject('invalid-input');
 if(!fullObject(input)||Object.keys(input).some(key=>!['version','requestId','companyId','orderId','action','target','expectedTarget','stockUsePlan'].includes(key))||input.version!==1||!fullId(input.requestId)||!fullId(input.orderId)||!['taebaek','punghoe'].includes(input.companyId)||input.action!=='line-forward'||!fullObject(input.target)||Object.keys(input.target).sort().join(',')!=='index,itemId,lineId'||!Number.isSafeInteger(input.target.index)||input.target.index<0||typeof input.target.lineId!=='string'||!input.target.lineId||!fullId(input.target.itemId)||!fullObject(input.expectedTarget)||Object.prototype.hasOwnProperty.call(input,'stockUsePlan')&&input.stockUsePlan===undefined)fullReject('invalid-input');
 return input as FullLineIntent;
}
/** 클릭 줄만 최신 원문에 병합하고 원 index 순서의 pending 줄에 공유 계산 상태를 적용한다. */
export function prepareOrderStockFullLineBasis(source:FullPlanningSource,intent:FullLineIntent,actorDisplay:string,clock:ReservationPreviewClock,text:(v:unknown)=>string){
 const {order,catalog,owner,orderSnapshot}=source;
 if(!['PENDING','PROCESSING','DISPATCHED','ON_HOLD'].includes(order.status))fullReject('unsupported-status');
 if(order.shippedOut||['inventoryOperation','retirementId','retirementClaimPending','rawInventoryJobId'].some(key=>order[key]!=null&&order[key]!==false)||order.inventorySnapshots?.shipment)fullReject('unsupported-existing-work');
 const initialItems=ensureOrderLineIds(order.items as (FullRow & {itemId:string;lineId?:string;checked?:boolean})[]),before=initialItems[intent.target.index];
 if(before&&!jsonInput(before))fullReject('unsupported-native-target');
 if(!before||before.itemId!==intent.target.itemId||before.lineId!==intent.target.lineId||text(before)!==text(intent.expectedTarget))fullReject('target-evidence-conflict','conflict');
 if(before.checked||order.itemInventory?.[before.lineId!]?.applied)fullReject('unsupported-existing-work');
 const currentStates=validateFullLineHistory(order,intent,initialItems,text);
 const nextItems=initialItems.map((row,index)=>index===intent.target.index?{...row,checked:true,checkedBy:actorDisplay,checkedAt:clock.now}:row);
 const effectiveStatus=['PENDING','PROCESSING','DISPATCHED'].includes(order.status)?workStatusFromItems(nextItems):order.status;
 const pendingRows=nextItems.map((item,index)=>({item,index})).filter(row=>row.item.checked&&currentStates[row.item.lineId!]?.applied!==true);
 const planner=createOrderProductionPlanner(catalog),{previousAllocationRows,dataByItem}=prepareFullLineAllocation(order,catalog,initialItems,currentStates,planner.shipOrder,intent,orderStockTouchedIds({items:nextItems.filter(row=>row.checked)} as any,catalog.inputs.bom));
 const productionDeltas=new Map<string,number>(),reservationDeltas=new Map<string,number>(),allocated=new Map<string,number>();
 const rows:{lineId:string;index:number;item:FullRow;attempt:number;production:ReturnType<typeof planner.planOrderProduction>;rowDeltas:Map<string,number>;lotBaseId:string}[]=[];
 const reservation=planOrderStockReservation(intent.orderId,dataByItem,stock=>{
  for(const row of pendingRows){const rowBefore=new Map(productionDeltas),single={...order,items:[row.item]},attempt=(currentStates[row.item.lineId!]?.attempt??0)+1;
   if(!Number.isSafeInteger(attempt)||attempt<1)fullReject('invalid-raw-attempt');
   const production=planner.planOrderProduction(single as any,productionDeltas,stock,row.index===intent.target.index?intent.stockUsePlan:undefined,allocated,{strictSelection:true});
   const rowDeltas=new Map<string,number>();for(const [id,value]of productionDeltas){const delta=stock3(value-(rowBefore.get(id)??0));if(delta)rowDeltas.set(id,delta);}
   rows.push({lineId:row.item.lineId!,index:row.index,item:row.item,attempt,production,rowDeltas,lotBaseId:`${intent.orderId}-${row.item.lineId}-${attempt}`});
  }
  for(const [id,value]of productionDeltas)reservationDeltas.set(id,value);
  if(!isStockProduction(order))for(const row of pendingRows)planner.shipOrder({...order,items:[row.item]} as any,reservationDeltas);
  return reservationDeltas;
 },{nowMs:clock.nowMs,preserveOwnAllocation:true});
 if(reservation.shortages.length)fullReject('stock-shortage');
 const prior=new Map(previousAllocationRows.map(row=>[row.itemId,stock3(row.rows.reduce((sum,r)=>sum+r.qty,0))]));
 const quantities:[string,number][]=[];for(const [id,total]of reservation.quantities){const extra=stock3(total-(prior.get(id)??0));if(!Number.isFinite(extra)||extra<0)fullReject('invalid-output');if(extra)quantities.push([id,extra]);}
 const nextStates={...currentStates};for(const row of rows)Object.defineProperty(nextStates,row.lineId,{value:{applied:true},enumerable:true,writable:true,configurable:true});
 const allocation=isStockProduction(order)?new Map<string,number>():completedLineAllocation(order as any,nextItems,nextStates,planner.shipOrder);
 const preview={intent,owner,stockSnapshot:[...reservation.available],available:[...reservation.available],quantities,allocationQuantities:[...allocation],reservationDeltas:[...reservationDeltas],fixedClock:clock,plannerAggregate:rows[0]?.production,orderText:text(order),orderHash:fullHash(text(order))};
 return {status:'basis' as const,preview,catalog,orderSnapshot,productionDeltas,shipmentDeltas:new Map<string,number>(),calculationOrder:order,lineRows:rows,nextItems,effectiveStatus,currentStates,previousAllocationRows};
}

/** 정상 A 행 검증을 완료·해제 양쪽에서 같은 본문으로 수행한다. */
export function prepareFullLineAllocation(order:FullRow,catalog:FullPlanningSource['catalog'],initialItems:readonly FullRow[],currentStates:Record<string,OrderItemInventoryState>,shipOrder:(order:any,deltas:Map<string,number>)=>void,identity:{orderId:string;companyId:string},requestedIds:Iterable<string>){
 const ids=new Set(requestedIds);
 for(const state of Object.values(currentStates))for(const row of state.production.stockDeltas)ids.add(row.itemId);
 const previousAllocationRows:{itemId:string;rows:FullRow[]}[]=[],dataByItem=new Map<string,FullRow>();
 const previousAllocation=isStockProduction(order)?new Map<string,number>():completedLineAllocation(order as any,initialItems,currentStates,shipOrder);
 for(const id of previousAllocation.keys())ids.add(id);
 for(const observed of catalog.observation.collections[0].documents)if(Array.isArray(observed.data.inventoryReservations)&&observed.data.inventoryReservations.some((row:any)=>row?.orderId===identity.orderId))ids.add(observed.id);
 for(const id of ids){const data=catalog.observation.collections[0].documents.find(row=>row.id===id)?.data;if(!data)fullReject('touched-item-missing');if(data.stock!==undefined&&(typeof data.stock!=='number'||!Number.isFinite(data.stock)||data.stock<0))fullReject('invalid-stock');if(data.inventoryReservations!==undefined&&!Array.isArray(data.inventoryReservations))fullReject('invalid-reservations');const own=(data.inventoryReservations??[]).filter((row:any)=>row?.orderId===identity.orderId);if(own.some((row:any)=>row.state!=='allocated'||!Number.isFinite(row.qty)||row.qty<=0||typeof row.operationId!=='string'||!row.operationId||row.reservationAttemptId!==undefined&&(typeof row.reservationAttemptId!=='string'||!row.reservationAttemptId)||!Number.isFinite(Date.parse(row.createdAt))))fullReject('invalid-previous-allocation');if(stock3(own.reduce((sum:number,row:any)=>sum+row.qty,0))!==(previousAllocation.get(id)??0))fullReject('invalid-previous-allocation');for(const row of own)if(row.generation!==undefined){try{validateOrderInventoryGeneration(row.generation);}catch{fullReject('invalid-previous-allocation');}if(row.generation.companyId!==identity.companyId||row.generation.orderId!==identity.orderId||row.generation.operationId!==row.operationId)fullReject('invalid-previous-allocation');}if(own.length)previousAllocationRows.push({itemId:id,rows:own});dataByItem.set(id,data);}
 return {ids,previousAllocationRows,dataByItem,previousAllocation};
}

export const isFullLinePlainJson=jsonInput;

/** 대상 클릭과 무관한 원줄/완료표/aggregate 관계를 같은 조건으로 검증한다. */
export function validateFullLineHistory(order:FullRow,intent:Pick<FullLineIntent,'companyId'|'orderId'>,initialItems:readonly FullRow[],text:(value:unknown)=>string){
 const currentStates=(order.itemInventory??{}) as Record<string,OrderItemInventoryState>;
 if(!fullObject(currentStates))fullReject('invalid-line-history');
 for(const [lineId,state]of Object.entries(currentStates)){
  const line=initialItems.find(row=>row.lineId===lineId);
  if(!line||!fullObject(state)||state.version!==1||state.lineId!==lineId||state.itemId!==line.itemId||typeof state.applied!=='boolean'||state.applied&&line.checked!==true||!state.applied&&(typeof state.reversedAt!=='string'||!Number.isFinite(Date.parse(state.reversedAt))||Date.parse(state.reversedAt)<Date.parse(state.completedAt??''))||!Number.isSafeInteger(state.attempt)||state.attempt<1||typeof state.completedAt!=='string'||!Number.isFinite(Date.parse(state.completedAt))||!fullObject(state.production)||state.production.capturedAt!==state.completedAt||!Array.isArray(state.production.stockDeltas)||!Array.isArray(state.production.bomLines)||!Array.isArray(state.rawConsumedLots)||!Array.isArray(state.autoBuilt)||!Array.isArray(state.producedUnits)||text(state.production.rawConsumedLots??[])!==text(state.rawConsumedLots)||text(state.production.rawLedgerIds??[])!==text(rawLedgerDocIds(state.rawConsumedLots)))fullReject('invalid-line-history');
  for(const trace of state.rawConsumedLots)if(!fullId(trace.rawItemId)||!Number.isFinite(trace.kg)||trace.kg<=0||trace.operationId!==`${trace.ledgerOnly?'production-ledger':'production'}:${intent.orderId}:${lineId}:a${state.attempt}:${trace.rawItemId}`||typeof trace.ledgerId!=='string')fullReject('invalid-line-history');
 }
 let terminalPatch:FullRow|undefined;
 if(order.inventoryGenerationCompletion!==undefined){const marker=order.inventoryGenerationCompletion;try{validateOrderInventoryGeneration(marker?.generation);}catch{fullReject('prior-line-completion-unproven');}if(!hasOrderInventoryGenerationCompletion({...order,id:intent.orderId} as any,marker.generation))fullReject('prior-line-completion-unproven');terminalPatch=JSON.parse(marker.requestText).patch;}
 for(const [lineId,state]of Object.entries(currentStates))if(!state.applied){
  if(state.rawReversalOrigin)continue; // 실제 새 reverse plan/receipt 관계는 같은 거래 Evidence가 검증한다.
  if(!terminalPatch||!fullObject(terminalPatch.itemInventory)||!Array.isArray(terminalPatch.items)||text(terminalPatch.itemInventory[lineId]??null)!==text(state)||!terminalPatch.items.some((line:FullRow)=>line.lineId===lineId&&line.itemId===state.itemId&&line.checked===false))fullReject('prior-line-completion-unproven');
  const aggregate=aggregateOrderLineInventory(terminalPatch,terminalPatch.itemInventory);for(const [key,value]of Object.entries(aggregate))if(text(terminalPatch[key]??null)!==text(value))fullReject('prior-line-completion-unproven');
 }
 const hasStates=Object.keys(currentStates).length>0;
 if(hasStates){const aggregate=aggregateOrderLineInventory(order,currentStates);for(const [key,value]of Object.entries(aggregate))if(text(order[key]??null)!==text(value))fullReject('invalid-line-aggregate');try{validateProductionRecordIndex(order.productionRecordIndex??{},intent.companyId,intent.orderId);}catch{fullReject('invalid-production-record-index');}}
 else if((order.rawInventoryAttempt??0)!==0||order.producedAt||order.rawLotsDeducted||order.rawConsumedLots?.length||order.autoBuilt?.length||order.producedUnits?.length||order.inventorySnapshots||order.productionRecordIndex&&Object.keys(order.productionRecordIndex).length)fullReject('unsupported-existing-work');
 return currentStates;
}
