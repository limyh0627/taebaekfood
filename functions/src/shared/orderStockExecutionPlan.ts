import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {assembleOrderProductionCatalogInputs,SERVER_PREVIEW_POLICY} from './orderProductionCatalogInputs';
import {createOrderProductionPlanner,type StockUsePlan} from './orderProductionPlanner';
import {isStockProduction,type ProductionOrder} from './orderProductionDomain';
import {orderStockTouchedIds,planOrderStockReservation} from './orderStockReservationPlan';
import {encodeCatalogValue} from './catalogOrderReferenceProof';

type Row=Record<string,any>;
export interface ReservationPreviewActor {uid:string;token:Row}
export interface ReservationPreviewClock {now:string;nowMs:number}
export interface ReservationPreviewIntent {version:1;requestId:string;companyId:'taebaek'|'punghoe';orderId:string;action:'status-forward';targetStatus:'DISPATCHED'|'SHIPPED'|'DELIVERED';stockUsePlan?:StockUsePlan}
const flags={executionAllowed:false,reservationOnly:true,resolvedPerLineSupported:false,fullApplyReady:false} as const;
const blocked=(reason:string)=>({status:'blocked' as const,...flags,reason});
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const own=(v:object,key:string)=>Object.prototype.hasOwnProperty.call(v,key);
const plain=(v:unknown,seen=new Set<object>(),depth=0):boolean=>{
 if(depth>50)return false;if(v===null||typeof v==='string'||typeof v==='boolean')return true;
 if(typeof v==='number')return Number.isFinite(v);
 if(!v||typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!object(v))return false;
 seen.add(v);const ok=Reflect.ownKeys(v).every(key=>{if(Array.isArray(v)&&key==='length')return true;const d=Object.getOwnPropertyDescriptor(v,key)!;return typeof key==='string'&&d.enumerable&&'value'in d&&plain(d.value,seen,depth+1);});seen.delete(v);return ok;
};
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&v!=='.'&&v!=='..'&&!/^__.*__$/.test(v)&&!v.includes('/')&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)&&Buffer.byteLength(v,'utf8')<=1500;
const stamp=(v:unknown):v is Timestamp=>v instanceof Timestamp&&Number.isFinite(v.toMillis());
const adapter={special:(v:unknown):ReturnType<typeof encodeCatalogValue>|undefined=>v instanceof Timestamp?['timestamp',v.seconds,v.nanoseconds]:v instanceof DocumentReference?['reference',v.path]:v instanceof GeoPoint?['geo',v.latitude,v.longitude]:Buffer.isBuffer(v)?['bytes',[...v]]:undefined};
const numbers=(v:unknown):boolean=>typeof v==='number'?Number.isFinite(v)&&v>=0:Array.isArray(v)?v.every(numbers):v&&typeof v==='object'?Object.values(v).every(numbers):true;

/** 호출 거래의 읽기만 수행한다. blocked의 거래 중단은 caller가 쓰기 전에 결정해야 한다. */
export async function prepareOrderStockReservationPreview(tx:Pick<Transaction,'get'>,db:Pick<Firestore,'collection'>,actor:ReservationPreviewActor|null|undefined,input:unknown,fixedClock:ReservationPreviewClock){
 if(!object(input)||!plain(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>16384||Reflect.ownKeys(input).some(k=>!['version','requestId','companyId','orderId','action','targetStatus','stockUsePlan'].includes(String(k)))||input.version!==1||!id(input.requestId)||!id(input.orderId)||!['taebaek','punghoe'].includes(input.companyId)||input.action!=='status-forward'||!['DISPATCHED','SHIPPED','DELIVERED'].includes(input.targetStatus)||own(input,'stockUsePlan')&&input.stockUsePlan===undefined)return blocked('invalid-input');
 const intent=JSON.parse(JSON.stringify(input)) as ReservationPreviewIntent;
 if(!actor||typeof actor.uid!=='string'||!actor.uid||!object(actor.token)||actor.token.companyId!==intent.companyId||typeof actor.token.employeeId!=='string'||!actor.token.employeeId.trim())return blocked('permission-denied');
 if(!fixedClock||typeof fixedClock.now!=='string'||!Number.isFinite(fixedClock.nowMs)||!Number.isFinite(Date.parse(fixedClock.now))||Date.parse(fixedClock.now)!==fixedClock.nowMs||new Date(Date.parse(fixedClock.now)).toISOString()!==fixedClock.now)return blocked('invalid-clock');
 const owner={uid:actor.uid,employeeId:actor.token.employeeId,companyId:intent.companyId},capturedClock={...fixedClock};
 try{
  const snap=await tx.get(db.collection('orders').doc(intent.orderId));
  if(!snap.exists)return blocked('order-missing');
  const order=snap.data();
  if(!object(order)||!stamp(snap.updateTime)||order.id!==undefined&&order.id!==intent.orderId)return blocked('invalid-order');
  if(order.companyId!==intent.companyId)return blocked('permission-denied');
  if(order.actorUid!==undefined&&order.actorUid!==owner.uid)return blocked('permission-denied');
  if(!['PENDING','PROCESSING','ON_HOLD'].includes(order.status)||order.producedAt||order.shippedOut||['inventoryOperation','retirementId','retirementClaimPending','inventoryGenerationCompletion','inventorySnapshots','rawConsumedLots','productionRecordIndex','rawInventoryJobId'].some(key=>order[key]!=null&&order[key]!==false)||order.itemInventory&&Object.values(order.itemInventory).some((v:any)=>v?.applied))return blocked('unsupported-existing-work');
  if(!Array.isArray(order.items)||!order.items.length||order.items.length>500||!order.items.every((line:unknown)=>object(line)&&id(line.itemId)&&typeof line.quantity==='number'&&Number.isFinite(line.quantity)&&line.quantity>0&&(line.lineId===undefined||typeof line.lineId==='string')&&(line.isBoxUnit===undefined||typeof line.isBoxUnit==='boolean')&&['boxQuantity','unitsPerBox'].every(key=>line[key]===undefined||typeof line[key]==='number'&&Number.isFinite(line[key])&&line[key]>=0)))return blocked('invalid-order');
  const catalog=await assembleOrderProductionCatalogInputs(tx,db,{companyId:intent.companyId,policyVersion:SERVER_PREVIEW_POLICY});
  if(catalog.status==='blocked')return blocked(catalog.reason);
  if(catalog.observation.collections.slice(1).some(collection=>collection.documents.some(({data})=>['quantity','units_per_box','ratio','yield_rate'].some(key=>data[key]!=null&&Number(data[key])<0))))return blocked('invalid-catalog-quantity');
  const calculationOrder=order as ProductionOrder,ids=orderStockTouchedIds(calculationOrder,catalog.inputs.bom),dataByItem=new Map<string,Row>();
  for(const itemId of ids){const observed=catalog.observation.collections[0].documents.find(row=>row.id===itemId);if(!observed)return blocked('touched-item-missing');const data=observed.data;if(data.stock!==undefined&&(typeof data.stock!=='number'||!Number.isFinite(data.stock)||data.stock<0))return blocked('invalid-stock');if(Array.isArray(data.inventoryReservations)&&data.inventoryReservations.some((row:any)=>row?.orderId===intent.orderId))return blocked('unsupported-existing-work');dataByItem.set(itemId,data);}
  const planner=createOrderProductionPlanner(catalog),reservationDeltas=new Map<string,number>(),allocated=new Map<string,number>();
  let production:ReturnType<typeof planner.planOrderProduction>|undefined;
  const stockProduction=isStockProduction(calculationOrder),wantShipped=!stockProduction&&['SHIPPED','DELIVERED'].includes(intent.targetStatus),wantsAllocationUntilShipment=!stockProduction&&!wantShipped;
  const reservation=planOrderStockReservation(intent.orderId,dataByItem,stock=>{
   production=planner.planOrderProduction(calculationOrder,reservationDeltas,stock,intent.stockUsePlan,allocated,{strictSelection:true});
   if(wantShipped||wantsAllocationUntilShipment)planner.shipOrder(calculationOrder,reservationDeltas);
   if([...reservationDeltas.values()].some(value=>!Number.isFinite(value))||!numbers(production))throw Object.assign(Error('invalid-output'),{code:'invalid-output'});
   return reservationDeltas;
  },{nowMs:capturedClock.nowMs});
  if([...reservation.available.values(),...reservation.quantities.values()].some(value=>!Number.isFinite(value)||value<0))return blocked('invalid-output');
  if(reservation.shortages.length)return blocked('stock-shortage');
  const allocationQuantities=new Map<string,number>();
  if(wantsAllocationUntilShipment){const shipment=new Map<string,number>();planner.shipOrder(calculationOrder,shipment);for(const [itemId,delta]of shipment)if(delta<0)allocationQuantities.set(itemId,-delta);}
  const orderText=JSON.stringify(encodeCatalogValue(order,adapter));
  return {status:'preview' as const,...flags,intent,owner,selectionMode:intent.stockUsePlan===undefined?'automatic' as const:'explicit' as const,selection:intent.stockUsePlan===undefined?{mode:'automatic' as const}:intent.stockUsePlan,stockSnapshot:[...reservation.available],available:[...reservation.available],reservationDeltas:[...reservationDeltas],allocationQuantities:[...allocationQuantities],quantities:[...reservation.quantities],shortages:reservation.shortages,plannerAggregate:production!,orderText,orderHash:createHash('sha256').update(orderText).digest('hex'),orderVersion:{seconds:snap.updateTime!.seconds,nanoseconds:snap.updateTime!.nanoseconds},referenceDigest:catalog.referenceDigest,queryReadTimes:catalog.queryReadTimes,policyVersion:catalog.policyVersion,fixedClock:capturedClock,basisUsage:'before-reserve-only' as const};
 }catch(error){const code=(error as {code?:unknown})?.code;return blocked(typeof code==='string'&&['invalid-selection','unsupported-selection','invalid-output'].includes(code)?code:'read-or-plan-failed');}
}
export type OrderStockReservationPreviewResult=Awaited<ReturnType<typeof prepareOrderStockReservationPreview>>;
