import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore} from 'firebase-admin/firestore';
import {encodeCatalogValue} from './catalogOrderReferenceProof';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {prepareOrderStockReservationPreview,type ReservationPreviewActor,type ReservationPreviewClock,type ReservationPreviewIntent} from './orderStockExecutionPlan';

type Row=Record<string,any>;
export const PRIVATE_STOCK_RESERVATION_COLLECTION='orderStockReservationAttemptsV1';
const protocol='private-stock-reservation-v1';
const limits={items:200,writes:202,attempt:786432,aggregate:4194304};
const flags={canApply:false,fullApplyReady:false,reservationOnly:true} as const;
const adapter={special:(v:unknown):ReturnType<typeof encodeCatalogValue>|undefined=>v instanceof Timestamp?['timestamp',v.seconds,v.nanoseconds]:v instanceof DocumentReference?['reference',v.path]:v instanceof GeoPoint?['geo',v.latitude,v.longitude]:Buffer.isBuffer(v)?['bytes',[...v]]:undefined};
const text=(v:unknown)=>JSON.stringify(encodeCatalogValue(v,adapter));
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&v!=='.'&&v!=='..'&&!/^__.*__$/.test(v)&&!v.includes('/')&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)&&Buffer.byteLength(v,'utf8')<=1500;
const plain=(v:unknown,seen=new Set<object>(),depth=0):boolean=>{
 if(depth>50)return false;if(v===null||typeof v==='string'||typeof v==='boolean')return true;if(typeof v==='number')return Number.isFinite(v);
 if(!v||typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!object(v))return false;seen.add(v);
 const ok=Reflect.ownKeys(v).every(k=>{if(Array.isArray(v)&&k==='length')return true;const d=Object.getOwnPropertyDescriptor(v,k)!;return typeof k==='string'&&d.enumerable&&'value'in d&&plain(d.value,seen,depth+1);});seen.delete(v);return ok;
};
class Rejected extends Error {constructor(readonly reason:string,readonly status:'blocked'|'conflict'='blocked'){super(reason);}}
function reject(reason:string,status:'blocked'|'conflict'='blocked'):never{throw new Rejected(reason,status);}
const business=(row:Row)=>text(Object.fromEntries(Object.entries(row).filter(([k])=>!['inventoryOperation','inventoryWriterProtocolVersion','inventoryWriteRevision'].includes(k))));
function usable(row:Row|undefined,company:string,itemId:string,isItem:boolean){
 if(!row||row.companyId!==company||row.id!==undefined&&row.id!==itemId)reject('missing-or-cross-company');
 if('archived'in row&&(typeof row.archived!=='boolean'||row.archived))reject('blocked-retired-or-history');
 try{advanceInventoryWriterProtocol(row,{});}catch{reject('invalid-writer-protocol');}
 if(isItem&&row.inventoryReservations!==undefined&&!Array.isArray(row.inventoryReservations))reject('invalid-reservations');
}
function budget(attempt:Row,writes:{path:string;patch:Row}[]){
 if(writes.length>limits.writes||Buffer.byteLength(text(attempt),'utf8')>limits.attempt||writes.reduce((sum,w)=>sum+Buffer.byteLength(text(w),'utf8'),0)>limits.aggregate)reject('write-budget-exceeded');
}
export interface PrivateStockReservationResult {status:'reserved'|'released'|'unknown'|'blocked'|'conflict';reason?:string;attemptId?:string;receipt?:Row;duplicate?:boolean;terminal?:boolean;currentEvidence?:'matches'|'changed'|'not-applicable';canApply:false;fullApplyReady:false;reservationOnly:true}

/** 미배포 demo 실험 전용이다. 기존 catchall 때문에 이 collection은 운영 서버 전용 권위가 아니다. */
export async function executePrivateOrderStockReservation(db:Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,fixedClock:ReservationPreviewClock):Promise<PrivateStockReservationResult>{
 try{
  if(!object(input)||!plain(input)||Object.keys(input).sort().join(',')!=='intent,mode'||!['reserve','release','inspect'].includes(input.mode)||!object(input.intent))reject('invalid-input');
  const raw=input.intent;
  if(Object.keys(raw).some(k=>!['version','requestId','companyId','orderId','action','targetStatus','stockUsePlan'].includes(k))||raw.version!==1||!id(raw.requestId)||!id(raw.orderId)||!['taebaek','punghoe'].includes(raw.companyId)||raw.action!=='status-forward'||!['DISPATCHED','SHIPPED','DELIVERED'].includes(raw.targetStatus)||Buffer.byteLength(text(raw),'utf8')>32768)reject('invalid-input');
  if('stockUsePlan'in raw&&(!object(raw.stockUsePlan)||Object.entries(raw.stockUsePlan).some(([index,choice])=>! /^(0|[1-9]\d*)$/.test(index)||Number(index)>=500||!object(choice)||!Object.prototype.hasOwnProperty.call(choice,'own')||Object.entries(choice).some(([key,value])=>!['own','loose'].includes(key)||typeof value!=='number'||!Number.isFinite(value)||value<0))))reject('invalid-input');
  if(!actor||typeof actor.uid!=='string'||!actor.uid||!object(actor.token)||actor.token.companyId!==raw.companyId||typeof actor.token.employeeId!=='string'||!actor.token.employeeId.trim())reject('permission-denied');
  if(!fixedClock||typeof fixedClock.now!=='string'||!Number.isFinite(fixedClock.nowMs)||!Number.isFinite(Date.parse(fixedClock.now))||Date.parse(fixedClock.now)!==fixedClock.nowMs||new Date(fixedClock.nowMs).toISOString()!==fixedClock.now)reject('invalid-clock');
  // callback 재시도에도 최초 원문·시각·실행 식별이 바뀌지 않는다.
  const intent=JSON.parse(JSON.stringify(raw)) as ReservationPreviewIntent,mode=input.mode as 'reserve'|'release'|'inspect',clock={...fixedClock};
  const owner={uid:actor.uid,employeeId:actor.token.employeeId,companyId:intent.companyId},capturedActor={uid:actor.uid,token:{...owner}},intentText=text(intent),intentHash=hash(intentText);
  const attemptId=hash(text({version:1,companyId:intent.companyId,uid:owner.uid,requestId:intent.requestId}));
  const ref=db.collection(PRIVATE_STOCK_RESERVATION_COLLECTION).doc(attemptId),orderRef=db.collection('orders').doc(intent.orderId);
  return await db.runTransaction(async tx=>{
   const savedSnap=await tx.get(ref),saved=savedSnap.data();
   if(saved&&(saved.version!==1||text(saved.owner)!==text(owner)||saved.intentText!==intentText||saved.intentHash!==intentHash||saved.attemptId!==attemptId||!['reserved','released'].includes(saved.state)||!object(saved.receipt)))reject('attempt-intent-conflict','conflict');
   const answer=(row:Row,duplicate:boolean):PrivateStockReservationResult=>({status:row.state,attemptId,receipt:row.receipt,duplicate,terminal:row.state==='released',...flags});
   if(saved&&mode!=='inspect'&&(mode==='reserve'||saved.state==='released'))return answer(saved,true);
   if(!saved&&mode==='inspect')return {status:'unknown',attemptId,reason:'attempt-unobserved',...flags};
   if(!saved&&mode==='release'){
    const receipt={attemptId,state:'released',cancelledBeforeReservation:true,acceptedAt:clock.now},next={version:1,attemptId,owner,companyId:intent.companyId,intentText,intentHash,state:'released',fixedClock:clock,receipt};
    budget(next,[{path:ref.path,patch:next}]);tx.create(ref,next);return answer(next,false);
   }
   if(saved?.state==='released')return {...answer(saved,true),currentEvidence:'not-applicable'};
   if(!saved){
    const preview=await prepareOrderStockReservationPreview(tx,db,capturedActor,intent,clock);
    if(preview.status!=='preview')reject(preview.reason);
    const ids=preview.stockSnapshot.map(([itemId])=>itemId);
    if(ids.length>limits.items||ids.some(itemId=>!id(itemId)||!id(intent.companyId+'__'+itemId)))reject('item-budget-or-id');
    const orderSnap=await tx.get(orderRef),order=orderSnap.data();usable(order,intent.companyId,intent.orderId,false);
    if(order!.inventoryOperation!=null||Object.keys(order!).some(k=>k.startsWith('privateReservation')))reject('existing-order-lock');
    if(text(order)!==preview.orderText)reject('order-changed','conflict');
    const rows=new Map<string,Row>();
    for(const itemId of ids){const item=await tx.get(db.collection('items').doc(itemId)),tomb=await tx.get(db.collection('inventoryWriterDeletions').doc(intent.companyId+'__'+itemId));if(tomb.exists)reject('blocked-retired-or-history');const row=item.data();usable(row,intent.companyId,itemId,true);rows.set(itemId,row!);}
    const lock={id:protocol+':'+attemptId,actorUid:owner.uid,kind:'status',stage:'reservation',targetStatus:intent.targetStatus,state:'processing',startedAt:clock.now,actor:owner.employeeId,privateReservationProtocol:protocol,privateReservationAttemptId:attemptId};
    const ownRows=preview.quantities.map(([itemId,qty])=>({itemId,row:{reservationAttemptId:attemptId,operationId:lock.id,orderId:intent.orderId,qty,createdAt:clock.now,state:'processing'}}));
    const itemWrites=ownRows.map(({itemId,row})=>({path:'items/'+itemId,patch:advanceInventoryWriterProtocol(rows.get(itemId),{inventoryReservations:[...(rows.get(itemId)!.inventoryReservations??[]),row]})}));
    const receipt={attemptId,state:'reserved',acceptedAt:clock.now,reservedItems:ownRows.length};
    // Firestore는 tuple의 중첩 배열을 저장하지 못하므로 native codec 문자열로 원계획을 보존한다.
    const next={version:1,attemptId,owner,companyId:intent.companyId,intentText,intentHash,state:'reserved',fixedClock:clock,receipt,previewText:text(preview),ownRows,lock,orderBusinessText:business(order!),touchedItemIds:ids};
    const writes=[...itemWrites,{path:orderRef.path,patch:advanceInventoryWriterProtocol(order,{inventoryOperation:lock})},{path:ref.path,patch:next}];budget(next,writes);
    for(const w of writes.slice(0,-1))tx.update(db.doc(w.path),w.patch);tx.create(ref,next);return answer(next,false);
   }
   // 원계획 A의 digest는 다시 계산하지 않는다. 실제 현재 B의 본인 행과 잠금 전문을 CAS한다.
   if(!Array.isArray(saved.ownRows)||!Array.isArray(saved.touchedItemIds)||saved.touchedItemIds.length>limits.items||!object(saved.lock)||typeof saved.orderBusinessText!=='string')reject('invalid-attempt-evidence','conflict');
   const orderSnap=await tx.get(orderRef),order=orderSnap.data();
   let matches=!!order&&text(order.inventoryOperation??null)===text(saved.lock)&&business(order)===saved.orderBusinessText;
   const itemWrites:{path:string;patch:Row}[]=[];
   try{
    usable(order,intent.companyId,intent.orderId,false);
    const items=new Map<string,Row>();
    for(const itemId of saved.touchedItemIds){if(!id(itemId)||!id(intent.companyId+'__'+itemId))reject('invalid-attempt-evidence','conflict');const snap=await tx.get(db.collection('items').doc(itemId)),tomb=await tx.get(db.collection('inventoryWriterDeletions').doc(intent.companyId+'__'+itemId));if(tomb.exists)reject('blocked-retired-or-history');usable(snap.data(),intent.companyId,itemId,true);items.set(itemId,snap.data()!);}
    const seen=new Set<string>();
    for(const evidence of saved.ownRows){if(!object(evidence)||!id(evidence.itemId)||seen.has(evidence.itemId)||!items.has(evidence.itemId)||!object(evidence.row)||evidence.row.reservationAttemptId!==attemptId||evidence.row.orderId!==intent.orderId)reject('invalid-attempt-evidence','conflict');seen.add(evidence.itemId);
     const item=items.get(evidence.itemId)!,reservations=item.inventoryReservations??[],own=reservations.filter((row:any)=>row&&typeof row==='object'&&(row.orderId===intent.orderId||row.reservationAttemptId===attemptId||row.operationId===saved.lock.id));
     if(own.length!==1||text(own[0])!==text(evidence.row))matches=false;
     else itemWrites.push({path:'items/'+evidence.itemId,patch:advanceInventoryWriterProtocol(item,{inventoryReservations:reservations.filter((row:any)=>row!==own[0])})});
    }
    for(const [itemId,item] of items)if(!seen.has(itemId)&&(item.inventoryReservations??[]).some((row:any)=>row&&typeof row==='object'&&(row.orderId===intent.orderId||row.reservationAttemptId===attemptId||row.operationId===saved.lock.id)))matches=false;
   }catch(error){if(!(error instanceof Rejected))throw error;matches=false;}
   if(mode==='inspect')return {...answer(saved,true),currentEvidence:matches?'matches':'changed'};
   if(!matches)reject('current-reservation-or-order-conflict','conflict');
   const receipt={attemptId,state:'released',acceptedAt:clock.now,cancelledBeforeReservation:false,reservedReceipt:saved.receipt};
   const next={...saved,state:'released',releasedAt:clock.now,receipt},writes=[...itemWrites,{path:orderRef.path,patch:advanceInventoryWriterProtocol(order,{inventoryOperation:null})},{path:ref.path,patch:next}];budget(next,writes);
   for(const w of writes.slice(0,-1))tx.update(db.doc(w.path),w.patch);tx.update(ref,next);return answer(next,false);
  },mode==='inspect'?{readOnly:true}:{});
 }catch(error){if(error instanceof Rejected)return {status:error.status,reason:error.reason,...flags};return {status:'unknown',reason:'transaction-result-unconfirmed',...flags};}
}
