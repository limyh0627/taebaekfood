import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'crypto';
import * as admin from 'firebase-admin';
import {cancellationEvidenceText} from './shared/orderCancellationEvidence';
import {recoverOrderInventoryLock,recoverOrderInventoryLockCommand} from './orderLockRecovery';
const available=['127.0.0.1:8182','127.0.0.1:8082'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
const run='unlock-'+randomUUID(),tracked=new Set<string>();let app:admin.app.App,db:admin.firestore.Firestore;
const ref=(path:string)=>{tracked.add(path);return db.doc(path);};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
async function seed(suffix:string,action:'cancel-shipment'|'delete'='cancel-shipment'){
 const orderId=run+'-'+suffix,order={id:orderId,companyId:'taebaek',status:action==='delete'?'DISPATCHED':'SHIPPED',shippedOut:action!=='delete',items:[{itemId:'product',quantity:2}],inventorySnapshots:{shipment:{stockDeltas:[{itemId:'product',delta:-2}]}}};
 const evidence=digest(cancellationEvidenceText(order,action)),failedOperationId=`order-cancellation-${action}-${orderId}-${evidence}`;
 const operation={id:failedOperationId,state:'failed',kind:'status',stage:'final-stock',targetStatus:action==='delete'?'PENDING':'DISPATCHED',startedAt:'2026-10-11T00:00:00Z',actor:'admin',error:'원료 검증 실패'};
 await Promise.all([ref('appMeta/releaseCutover').set({status:'active',releaseId:run}),ref(`orders/${orderId}`).create({...order,inventoryOperation:operation})]);
 tracked.add(`orderStatusAudits/${failedOperationId}`);tracked.add('orderLockRecoveryOperations/order-unlock-'+digest(JSON.stringify(['taebaek',orderId,failedOperationId,operation.startedAt])));
 return {orderId,failedOperationId,evidence,action,operation,order,input:{action:'recover' as const,orderId,failedOperationId,failedStartedAt:operation.startedAt,releaseId:run}};
}
describe.skipIf(!available)('같은 회사 사용자 원자 취소 잠금 복구 SDK 거래',{timeout:30000},()=>{
 beforeAll(()=>{app=admin.initializeApp({projectId:'demo-'+run});db=app.firestore();});
 afterAll(async()=>{for(const path of tracked){await db.doc(path).delete();expect((await db.doc(path).get()).exists).toBe(false);}await app?.delete();});
 it('로그인·회사 claim 없이 복구하지 않는다',async()=>{
  const call=(request:any)=>(recoverOrderInventoryLockCommand as any).run(request);
  await expect(call({data:{}})).rejects.toThrow('로그인');await expect(call({auth:{uid:'staff',token:{}},data:{}})).rejects.toThrow('현재 회사');
 });
 it('실제 등록된 callable handler도 같은 회사 직원의 inspect·recover만 허용한다',async()=>{
  const f=await seed('staff-callable'),call=(request:any)=>(recoverOrderInventoryLockCommand as any).run(request);
  // 플랫폼이 전달하는 인증 metadata는 합성이다. Admin Firestore SDK·실제 등록 handler/TX를 검증한다.
  const auth={uid:'staff',token:{companyId:'taebaek',employeeId:'staff-employee',isAdmin:false}};
  expect(await call({auth,data:{...f.input,action:'inspect'}})).toMatchObject({status:'ready',inventoryApplied:'none'});
  await expect(call({auth:{uid:'foreign',token:{companyId:'punghoe',employeeId:'foreign-employee'}},data:f.input})).rejects.toMatchObject({code:'permission-denied'});
  expect((await ref('orders/'+f.orderId).get()).get('inventoryOperation')).toEqual(f.operation);
  expect(await call({auth,data:f.input})).toMatchObject({status:'recovered',inventoryApplied:'none'});
  const receipt=(await ref('orderLockRecoveryOperations/order-unlock-'+digest(JSON.stringify(['taebaek',f.orderId,f.failedOperationId,f.operation.startedAt]))).get()).data();
  expect(receipt?.recoveredBy).toBe('staff');
 });
 it.each(['cancel-shipment','delete'] as const)('%s 실패는 원문을 읽고 잠금·복구영수증만 변경한다',async(action)=>{
  const f=await seed(action,action),orderRef=ref(`orders/${f.orderId}`),before=await orderRef.get();
  const itemRef=ref(`items/${f.orderId}`),rawRef=ref(`rawInventoryStates/${f.orderId}`),ledgerRef=ref(`rawMaterialLedger/${f.orderId}`);
  await Promise.all([itemRef.create({stock:4,lots:[{qtyRemaining:4}]}),rawRef.create({stockKg:99}),ledgerRef.create({reportedDeltaKg:-1})]);
  const original=await Promise.all([itemRef.get(),rawRef.get(),ledgerRef.get()]);
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',{...f.input,action:'inspect'})).toMatchObject({status:'ready',inventoryApplied:'none',orderId:f.orderId,failedOperationId:f.failedOperationId});
  expect((await orderRef.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'recovered',inventoryApplied:'none'});
  const current=await orderRef.get();expect(current.data()).toEqual({...before.data(),inventoryOperation:null,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'duplicate',inventoryApplied:'none'});
  expect((await orderRef.get()).updateTime!.isEqual(current.updateTime!)).toBe(true);
  for(const [index,snap] of (await Promise.all([itemRef.get(),rawRef.get(),ledgerRef.get()])).entries())expect(snap.updateTime!.isEqual(original[index].updateTime!)).toBe(true);
 });
 it('회사·진행 상태·operation·원문·완료표가 바뀌면 보호한다',async()=>{
  const f=await seed('blocked'),orderRef=ref(`orders/${f.orderId}`);
  await expect(recoverOrderInventoryLock(db,'punghoe','actor',f.input)).rejects.toThrow('회사');
  await orderRef.update({'inventoryOperation.state':'processing'});expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'blocked',reason:'OPERATION_NOT_FAILED'});
  await orderRef.update({inventoryOperation:{...f.operation,id:'other'}});expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'blocked',reason:'OPERATION_CHANGED'});
  await orderRef.update({inventoryOperation:f.operation,items:[{itemId:'product',quantity:3}]});expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'blocked',reason:'APPROVAL_EVIDENCE_CHANGED'});
  await orderRef.update({items:f.order.items});await ref(`orderStatusAudits/${f.failedOperationId}`).create({id:f.failedOperationId,companyId:'taebaek',orderId:f.orderId,state:'completed',cancellation:{action:f.action,evidence:f.evidence}});
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'blocked',inventoryApplied:'complete'});
  expect((await orderRef.get()).get('inventoryOperation')).toEqual(f.operation);
 });
 it('legacy 상태 실패는 빈 감사가 있어도 미반영으로 해제하지 않는다',async()=>{
  const f=await seed('legacy'),failed='order-status-'+f.orderId;
  await ref(`orders/${f.orderId}`).update({inventoryOperation:{...f.operation,id:failed}});tracked.add(`orderStatusAudits/${failed}`);
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',{...f.input,failedOperationId:failed})).toMatchObject({status:'blocked',inventoryApplied:'unknown',reason:'LEGACY_OPERATION_UNPROVEN'});
 });
 it('동시 해제 두 번은 잠금을 한 번만 변경하고 영수증으로 재확인한다',async()=>{
  const f=await seed('concurrent');const result=await Promise.all([recoverOrderInventoryLock(db,'taebaek','a',f.input),recoverOrderInventoryLock(db,'taebaek','b',f.input)]);
  expect(result.map(row=>row.status).sort()).toEqual(['duplicate','recovered']);expect((await ref(`orders/${f.orderId}`).get()).get('inventoryOperation')).toBeNull();
 });
 it('같은 결정 작업번호가 다시 실패하면 새 세대만 복구하고 옛 승인은 차단한다',async()=>{
  const f=await seed('generation');expect((await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).status).toBe('recovered');
  const failedStartedAt='2026-10-11T00:00:01Z';await ref(`orders/${f.orderId}`).update({inventoryOperation:{...f.operation,startedAt:failedStartedAt}});
  tracked.add('orderLockRecoveryOperations/order-unlock-'+digest(JSON.stringify(['taebaek',f.orderId,f.failedOperationId,failedStartedAt])));
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',f.input)).toMatchObject({status:'blocked',reason:'OPERATION_GENERATION_CHANGED'});
  const next={...f.input,failedStartedAt};expect((await recoverOrderInventoryLock(db,'taebaek','actor',{...next,action:'inspect'})).status).toBe('ready');
  expect((await recoverOrderInventoryLock(db,'taebaek','actor',next)).status).toBe('recovered');
  await ref(`orderStatusAudits/${f.failedOperationId}`).create({id:f.failedOperationId,companyId:'taebaek',orderId:f.orderId,state:'completed',cancellation:{action:f.action,evidence:f.evidence}});
  expect(await recoverOrderInventoryLock(db,'taebaek','actor',next)).toMatchObject({status:'blocked',inventoryApplied:'complete'});
 }); it('같은 주문·완료표를 쓰는 취소 커밋과 경합하면 완료 또는 해제 중 한 가지만 성립한다',async()=>{
  const f=await seed('race'),orderRef=ref(`orders/${f.orderId}`),auditRef=ref(`orderStatusAudits/${f.failedOperationId}`);
  const completion=db.runTransaction(async tx=>{const [order,audit]=await Promise.all([tx.get(orderRef),tx.get(auditRef)]);if(audit.exists||order.get('inventoryOperation')?.id!==f.failedOperationId)return false;tx.update(orderRef,{status:'DISPATCHED',inventoryOperation:null});tx.create(auditRef,{id:f.failedOperationId,companyId:'taebaek',orderId:f.orderId,state:'completed',cancellation:{action:f.action,evidence:f.evidence}});return true;});
  const [completed,recovery]=await Promise.all([completion,recoverOrderInventoryLock(db,'taebaek','actor',f.input)]);
  expect(completed?recovery.status==='blocked':recovery.status==='recovered').toBe(true);
 });
});

