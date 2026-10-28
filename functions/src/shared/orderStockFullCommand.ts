import {type Firestore} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';
import {withOrderListProjection} from './orderListProjectionWrite';
import {prepareOrderStockFullPlan,FULL_PROTOCOL,FULL_ATTEMPTS,fullCodec,fullId,fullHash,fullReject,FullRejected,fullObject,fullPath,fullUsable,fullBudget,fullSnapshotNative,type OrderStockFullPlan,type FullRow} from './orderStockFullPlan';
import type {ReservationPreviewActor,ReservationPreviewClock} from './orderStockExecutionPlan';

export interface FullReference {version:1;companyId:'taebaek'|'punghoe';orderId:string;requestId:string}
export interface FullResult {status:'missing-unknown'|'reserved'|'applied'|'cancelled'|'blocked'|'conflict'|'unknown';publicEnabled:false;reason?:string;reference?:FullReference;serverPlanHash?:string;targetStatus?:string;requestedAt?:string;originalPresent?:boolean;canApply:boolean;duplicate?:boolean;attemptId?:string}
const plain=(v:unknown,seen=new Set<object>()):boolean=>{if(v===null||['string','boolean'].includes(typeof v))return true;if(typeof v==='number')return Number.isFinite(v);if(!v||typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!fullObject(v))return false;seen.add(v);const valid=Reflect.ownKeys(v).every(k=>{if(Array.isArray(v)&&k==='length')return true;const d=Object.getOwnPropertyDescriptor(v,k)!;return typeof k==='string'&&d.enumerable&&'value'in d&&plain(d.value,seen);});seen.delete(v);return valid;};
const keys=(v:FullRow,expected:string)=>Object.keys(v).sort().join(',')===expected;
export const fullAttemptId=(reference:FullReference,uid:string)=>fullHash(JSON.stringify([FULL_PROTOCOL,reference.companyId,uid,reference.orderId,reference.requestId]));

/** 준비의 가상 B와 적용의 현재 B가 같은 최종 쓰기·영수증을 조립한다. 이 함수는 DB를 읽거나 쓰지 않는다. */
export function materializeOrderStockFullTerminal(db:Firestore,plan:OrderStockFullPlan,saved:FullRow,current:ReadonlyMap<string,FullRow|undefined>,mode:'apply'|'cancel',clock:ReservationPreviewClock){
 const {text,decode}=fullCodec(db),reference=saved.reference as FullReference,orderPath='orders/'+reference.orderId,attemptPath=FULL_ATTEMPTS+'/'+saved.attemptId,order=current.get(orderPath);
 if(!order)fullReject('missing-or-cross-company');
 const expectedB=new Map<string,string>(saved.expectedB.map((row:FullRow)=>[row.path,row.nativeText]));
 const advance=(before:FullRow|undefined,patch:FullRow)=>{try{return advanceInventoryWriterProtocol(before,patch);}catch{fullReject('invalid-writer-protocol');}};
 const writes=new Map<string,{operation:'create'|'update';data:FullRow}>();
 const add=(path:string,data:FullRow,operation:'create'|'update'='update')=>{fullPath(path);if(writes.has(path))fullReject('duplicate-effect-path','conflict');writes.set(path,{operation,data});};
 if(mode==='apply')for(const effect of plan.effectSet){fullPath(effect.path);const before=plan.readSet.find(row=>row.path===effect.path);if(!before||effect.operation!==(before.exists?'update':'create')||!['items','rawInventories','rawMaterialLedger','productionRecords'].includes(effect.path.split('/')[0]))fullReject('invalid-effect-collection','conflict');add(effect.path,decode(effect.nativeText),effect.operation);}
 const allocation=new Map<string,number>(plan.preview.allocationQuantities);
 for(const id of plan.itemIds){const path='items/'+id,before=current.get(path)!,ownedRow=saved.ownRows.find((row:FullRow)=>row.itemId===id),existing=writes.get(path),patch=existing?.data??{};if(mode==='cancel'&&!ownedRow)continue;const reservations=(before.inventoryReservations??[]).filter((row:FullRow)=>!ownedRow||text(row)!==text(ownedRow.row));
  if(mode==='apply'&&allocation.has(id))reservations.push({reservationAttemptId:saved.lock.nonce,operationId:saved.lock.id,orderId:reference.orderId,qty:allocation.get(id),createdAt:plan.clock.now,state:'allocated'});
  if(ownedRow||existing||mode==='apply'&&allocation.has(id))writes.set(path,{operation:'update',data:advance(before,{...patch,...(ownedRow||mode==='apply'&&allocation.has(id)?{inventoryReservations:reservations}:{})})});
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
// 완료 시각은 적용 때 정한다. 준비 admission만 정규 ISO가 가질 수 있는 최대 길이로 같은 payload를 검사한다.
const FULL_TERMINAL_BUDGET_CLOCK:ReservationPreviewClock={now:new Date(8640000000000000).toISOString(),nowMs:8640000000000000};

/** 모든 효과는 새 full receipt와 같은 거래에 속한다. 호출 실패를 미실행으로 해석하지 않는다. */
export async function executePrivateOrderStockFull(db:Firestore,actor:ReservationPreviewActor|null|undefined,input:unknown,fixedClock:ReservationPreviewClock):Promise<FullResult>{
 const fail=(status:FullResult['status'],reason:string):FullResult=>({status,reason,publicEnabled:false,canApply:false});
 try{
  if(!fullObject(input)||!plain(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>32768||!['prepare-reserve','inspect','apply','cancel'].includes(input.mode))fullReject('invalid-input');
  const mode=input.mode as 'prepare-reserve'|'inspect'|'apply'|'cancel';
  if(!keys(input,mode==='prepare-reserve'?'intent,mode':mode==='apply'?'expectedPlanHash,mode,reference':'mode,reference'))fullReject('invalid-input');
  const raw=mode==='prepare-reserve'?input.intent:input.reference;
  if(!fullObject(raw)||raw.version!==1||!['taebaek','punghoe'].includes(raw.companyId)||!fullId(raw.orderId)||!fullId(raw.requestId))fullReject('invalid-input');
  if(mode!=='prepare-reserve'&&!keys(raw,'companyId,orderId,requestId,version'))fullReject('invalid-input');
  if(mode==='apply'&&(typeof input.expectedPlanHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedPlanHash)))fullReject('invalid-input');
  if(!actor||typeof actor.uid!=='string'||!actor.uid||!fullObject(actor.token)||actor.token.companyId!==raw.companyId||!fullId(actor.token.employeeId))fullReject('permission-denied');
  if(!fixedClock||!Number.isFinite(fixedClock.nowMs)||typeof fixedClock.now!=='string'||!Number.isFinite(Date.parse(fixedClock.now))||Date.parse(fixedClock.now)!==fixedClock.nowMs||new Date(fixedClock.nowMs).toISOString()!==fixedClock.now)fullReject('invalid-clock');
  const reference:FullReference={version:1,companyId:raw.companyId,orderId:raw.orderId,requestId:raw.requestId},owner={uid:actor.uid,employeeId:actor.token.employeeId,companyId:reference.companyId},clock={...fixedClock},nonce=randomUUID(),attemptId=fullAttemptId(reference,owner.uid),intent=mode==='prepare-reserve'?JSON.parse(JSON.stringify(raw)):undefined;
  const {text,decode}=fullCodec(db),attemptRef=db.collection(FULL_ATTEMPTS).doc(attemptId),orderRef=db.collection('orders').doc(reference.orderId),capturedActor={uid:owner.uid,token:{companyId:owner.companyId,employeeId:owner.employeeId}};
  return await db.runTransaction(async tx=>{
   const savedSnap=await tx.get(attemptRef);fullSnapshotNative(db,savedSnap);const saved=savedSnap.data();
   // terminal 복구도 현재 로그인 직원의 실제 관계를 확인한 다음 최소 요약만 반환한다.
   const employee=(await tx.get(db.collection('employees').doc(owner.employeeId))).data();
   if(!employee||employee.authUid!==owner.uid||(employee.companyId??'taebaek')!==owner.companyId||employee.status==='out'||typeof employee.name!=='string'||!employee.name.trim())fullReject('permission-denied');
   const answer=(row:FullRow,duplicate:boolean,canApply=false):FullResult=>({status:row.state,reference,attemptId,publicEnabled:false,canApply,duplicate,originalPresent:typeof row.fullPlanText==='string',...(row.fullPlanHash?{serverPlanHash:row.fullPlanHash}:{}),...(row.targetStatus?{targetStatus:row.targetStatus}:{}),requestedAt:row.clock.now});
   let plan:OrderStockFullPlan|undefined;
   if(saved){
    if(saved.version!==1||saved.protocol!==FULL_PROTOCOL||saved.attemptId!==attemptId||text(saved.owner)!==text(owner)||text(saved.reference)!==text(reference)||!['reserved','applied','cancelled'].includes(saved.state)||!fullObject(saved.receipt)||saved.receipt.state!==saved.state||fullHash(text(saved.receipt))!==saved.receiptHash||!fullObject(saved.clock))fullReject('invalid-attempt','conflict');
    if(saved.fullPlanText!==undefined){if(typeof saved.fullPlanText!=='string'||fullHash(saved.fullPlanText)!==saved.fullPlanHash)fullReject('invalid-plan-hash','conflict');plan=decode(saved.fullPlanText);if(plan?.version!==1||plan.protocol!==FULL_PROTOCOL||text(plan.owner)!==text(owner)||plan.intent.orderId!==reference.orderId||plan.intent.requestId!==reference.requestId||plan.intent.companyId!==reference.companyId||text(plan.intent)!==saved.intentText||fullHash(saved.intentText)!==saved.intentHash||!Array.isArray(plan.readSet)||!Array.isArray(plan.effectSet)||!Array.isArray(plan.itemIds))fullReject('invalid-plan-evidence','conflict');}
    if(plan&&saved.state!=='reserved'){
     const expected=new Set([orderRef.path,'orderStatusAudits/'+plan.audit.id,...saved.ownRows.map((row:FullRow)=>'items/'+row.itemId),...(saved.state==='applied'?[...plan.effectSet.map(row=>row.path),...plan.preview.allocationQuantities.map(([id]:[string,number])=>'items/'+id)]:[])]);
     if(saved.receipt.fullPlanHash!==saved.fullPlanHash||!Array.isArray(saved.receipt.effects)||saved.receipt.effects.length!==expected.size||saved.receipt.effects.some((row:FullRow)=>!fullObject(row)||!expected.delete(row.path)||typeof row.hash!=='string'||!/^[a-f0-9]{64}$/.test(row.hash)))fullReject('invalid-terminal-receipt','conflict');
    }
    if(!plan&&(saved.state!=='cancelled'||saved.receipt.cancelledBeforePrepare!==true))fullReject('missing-full-plan','conflict');
    if(mode==='prepare-reserve'&&saved.intentText!==undefined&&text(intent)!==saved.intentText)fullReject('attempt-intent-conflict','conflict');
    if(saved.state!=='reserved'){if(mode==='apply'&&saved.state==='applied'&&input.expectedPlanHash!==saved.fullPlanHash)fullReject('plan-confirmation-conflict','conflict');return answer(saved,true);}
    if(!plan)fullReject('missing-full-plan','conflict');
    if(mode==='prepare-reserve')return answer(saved,true);
   }else if(mode==='inspect'||mode==='apply')return {...fail('missing-unknown','attempt-unobserved'),reference,attemptId,originalPresent:false};
   if(!saved&&mode==='cancel'){
    const order=(await tx.get(orderRef)).data();fullUsable(order,reference.companyId,reference.orderId);
    if(order!.inventoryOperation?.fullAttemptId===attemptId)fullReject('unobserved-own-lock','conflict');
    const receipt={state:'cancelled',cancelledBeforePrepare:true,at:clock.now},next={version:1,protocol:FULL_PROTOCOL,attemptId,reference,owner,clock,state:'cancelled',receipt,receiptHash:fullHash(text(receipt))};
    fullBudget(db,next,[{path:attemptRef.path,data:next}]);tx.create(attemptRef,next);return answer(next,false);
   }
   if(!saved){
    const built=await prepareOrderStockFullPlan(tx,db,capturedActor,intent,clock);if(built.status!=='planned')fullReject(built.reason);plan=built.plan;
    const original=new Map(plan.readSet.map(row=>[row.path,decode(row.nativeText)])),order=original.get(orderRef.path)!;
    const lock={id:FULL_PROTOCOL+':'+attemptId,kind:'status',stage:'reservation',targetStatus:plan.intent.targetStatus,state:'processing',startedAt:clock.now,actor:plan.actorDisplay,actorUid:owner.uid,fullProtocol:FULL_PROTOCOL,fullAttemptId:attemptId,fullReference:reference,nonce};
    const ownRows=plan.preview.quantities.map(([itemId,qty]:[string,number])=>({itemId,row:{reservationAttemptId:nonce,operationId:lock.id,orderId:reference.orderId,qty,createdAt:clock.now,state:'processing'}}));
    const writes:{path:string;data:FullRow}[]=[],expectedB:{path:string;nativeText:string}[]=[];
    for(const id of plan.itemIds){const before=original.get('items/'+id)!;const own=ownRows.find((row:FullRow)=>row.itemId===id);let after=before;if(own){const patch=advanceInventoryWriterProtocol(before,{inventoryReservations:[...(before.inventoryReservations??[]),own.row]});writes.push({path:'items/'+id,data:patch});after={...before,...patch};}if(own)expectedB.push({path:'items/'+id,nativeText:text(after)});}
    const orderPatch=advanceInventoryWriterProtocol(order,{inventoryOperation:lock});writes.push({path:orderRef.path,data:orderPatch});expectedB.push({path:orderRef.path,nativeText:text({...order,...orderPatch})});
    writes.push({path:'orderStatusAudits/'+plan.audit.id,data:plan.audit});expectedB.push({path:'orderStatusAudits/'+plan.audit.id,nativeText:text(plan.audit)});
    const fullPlanText=text(plan),receipt={state:'reserved',at:clock.now},next={version:1,protocol:FULL_PROTOCOL,attemptId,reference,owner,clock,state:'reserved',targetStatus:plan.intent.targetStatus,intentText:text(plan.intent),intentHash:fullHash(text(plan.intent)),fullPlanText,fullPlanHash:fullHash(fullPlanText),expectedB,ownRows,lock,receipt,receiptHash:fullHash(text(receipt))};
    fullBudget(db,next,[...writes,{path:attemptRef.path,data:next}]);
    const reservedCurrent=new Map<string,FullRow|undefined>(original);
    for(const write of writes)reservedCurrent.set(write.path,{...(reservedCurrent.get(write.path)??{}),...write.data});
    materializeOrderStockFullTerminal(db,plan,next,reservedCurrent,'apply',FULL_TERMINAL_BUDGET_CLOCK);
    for(const write of writes)if(write.path.startsWith('orderStatusAudits/'))tx.create(db.doc(write.path),write.data);else tx.update(db.doc(write.path),write.data);
    tx.create(attemptRef,next);return answer(next,false,true);
   }
   if(mode==='apply'&&input.expectedPlanHash!==saved.fullPlanHash)fullReject('plan-confirmation-conflict','conflict');
   if(!Array.isArray(saved.expectedB)||!Array.isArray(saved.ownRows)||!fullObject(saved.lock)||typeof saved.lock.nonce!=='string'||!saved.lock.nonce||text(saved.ownRows)!==text(plan!.preview.quantities.map(([itemId,qty]:[string,number])=>({itemId,row:{reservationAttemptId:saved.lock.nonce,operationId:saved.lock.id,orderId:reference.orderId,qty,createdAt:plan!.clock.now,state:'processing'}}))))fullReject('invalid-reservation-evidence','conflict');
   const current=new Map<string,FullRow|undefined>(),versions=new Map<string,any>();
   const cancelPaths=new Set([orderRef.path,'orderStatusAudits/'+plan!.audit.id,...saved.ownRows.map((row:FullRow)=>'items/'+row.itemId)]);
   for(const evidence of plan!.readSet){fullPath(evidence.path);if(mode==='cancel'&&!cancelPaths.has(evidence.path))continue;if(current.has(evidence.path))fullReject('duplicate-read-evidence','conflict');const snap=await tx.get(db.doc(evidence.path));fullSnapshotNative(db,snap,mode==='cancel'&&evidence.path.startsWith('items/')?['inventoryReservations']:mode==='cancel'&&evidence.path===orderRef.path?['inventoryOperation']:undefined);current.set(evidence.path,snap.data());versions.set(evidence.path,snap.updateTime);}
   // 처리중 감사의 자기 쓰기는 원A의 부재 버전 대신 B 원문으로 검증한다.
   const expectedB=new Map<string,string>();for(const row of saved.expectedB){fullPath(row.path);if(expectedB.has(row.path)||typeof row.nativeText!=='string')fullReject('invalid-reservation-evidence','conflict');decode(row.nativeText);expectedB.set(row.path,row.nativeText);}
   let matches=true;
   if(mode!=='cancel')for(const evidence of plan!.readSet){const row=current.get(evidence.path),b=expectedB.get(evidence.path);if(b!==undefined){if(text(row??null)!==b)matches=false;}else {const version=versions.get(evidence.path);if(text(row??null)!==evidence.nativeText||!!row!==evidence.exists||(version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null)&&text(version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null)!==text(evidence.version))matches=false;}}
   const order=current.get(orderRef.path);fullUsable(order,reference.companyId,reference.orderId);
   let owned=text(order!.inventoryOperation??null)===text(saved.lock);
   for(const id of plan!.itemIds){if(mode==='cancel'&&!saved.ownRows.some((row:FullRow)=>row.itemId===id))continue;const item=current.get('items/'+id);if(mode!=='cancel'){fullUsable(item,reference.companyId,id);if(current.get('inventoryWriterDeletions/'+reference.companyId+'__'+id))fullReject('blocked-retired-or-history','conflict');}else if(!item||item.companyId!==reference.companyId)fullReject('missing-or-cross-company','conflict');
    const rows=(item!.inventoryReservations??[]).filter((row:FullRow)=>row&&(row.orderId===reference.orderId||row.operationId===saved.lock.id||row.reservationAttemptId===saved.lock.nonce)),expected=saved.ownRows.filter((row:FullRow)=>row.itemId===id);if(rows.length!==expected.length||rows.some((row:FullRow,i:number)=>text(row)!==text(expected[i].row)))owned=false;
   }
   if(mode==='inspect')return {...answer(saved,true,matches&&owned),...(matches&&owned?{}:{reason:'current-evidence-changed'})};
   if(!owned||mode==='apply'&&!matches)fullReject('current-evidence-conflict','conflict');
   if(mode!=='apply'&&mode!=='cancel')fullReject('invalid-input');
   const {writes,next}=materializeOrderStockFullTerminal(db,plan!,saved,current,mode,clock);
   for(const [path,write]of writes)if(write.operation==='create')tx.create(db.doc(path),write.data);else if(path.startsWith('rawInventories/'))tx.set(db.doc(path),write.data);else tx.update(db.doc(path),write.data);
   tx.update(attemptRef,next);return answer(next,false);
  },mode==='inspect'?{readOnly:true}:{});
 }catch(error){return error instanceof FullRejected?fail(error.status,error.reason):fail('unknown','transaction-result-unconfirmed');}
}



