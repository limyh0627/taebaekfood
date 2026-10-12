import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {getFirestore as adminFirestore} from 'firebase-admin/firestore';
import {executeOrderRawBatchWithDb,readOrderRawBatchJobRequest,orderRawBatchRequestHash} from './orderRawBatchService';
import {executeRawInventoryCommand} from './rawInventoryService';
import {inventoryDocId,operationDocId} from '../rawInventoryCore';
import {orderRawBatchJobId,orderRawBatchOrderEvidence,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
import {OrderStatus,type Order} from '../types';
import {claimOrderInventoryOperation} from './firebaseService';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve(),functions:{},storage:{}}));
// 운영 오류가 난 실제 엔진의 Map 저장 함수를 실행한다. 단순한 서비스 fixture로 다시 축소하지 않는다.
function reservationFromEngine(){
 const source=readFileSync('src/features/admin/orderStockEngine.ts','utf8'),file=ts.createSourceFile('engine.ts',source,ts.ScriptTarget.Latest,true);
 let declaration:ts.VariableDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='saveReservation')declaration=node;ts.forEachChild(node,visit);};visit(file);
 if(!declaration?.initializer)throw Error('실제 엔진 예약 저장 함수를 찾지 못했습니다.');
 const code=ts.transpileModule('const save = '+declaration.initializer.getText(file)+'; return save;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const save=new Function('plain',code)((value:unknown)=>JSON.parse(JSON.stringify(value)));
 return save({quantities:new Map([['product',2]]),stockSnapshot:new Map([['product',0]]),previousReservations:new Map([['product',null]]),allocationQuantities:new Map([['product',2]])});
}

describe.skipIf(process.env.ORDER_RAW_BATCH_EMULATOR_TEST!=='true')('새 주문 원료 일괄 실제 직원 Auth·Firestore',()=>{
 const prefix='order-batch-'+randomUUID(),paths=new Set<string>();
 let admin:ReturnType<typeof adminApp>,store:ReturnType<typeof adminFirestore>,accounts:ReturnType<typeof adminAuth>,app:ReturnType<typeof initializeApp>,database:ReturnType<typeof getFirestore>,auth:ReturnType<typeof getAuth>;
 const uid=prefix+'-employee';
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('로컬 Emulator만 허용');
  const projectId='demo-taebaekfood-local';admin=adminApp({projectId},prefix);store=adminFirestore(admin);accounts=adminAuth(admin);
  const email=uid+'@example.invalid',password=randomUUID()+'A1!';await accounts.createUser({uid,email,password});await accounts.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-only'},prefix);database=getFirestore(app);auth=getAuth(app);connectFirestoreEmulator(database,'127.0.0.1',8082);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(auth,email,password);gateway.db=database;gateway.auth=auth;
 },90000);
 afterAll(async()=>{for(const path of paths){await store.doc(path).delete();expect((await store.doc(path).get()).exists).toBe(false);}if(accounts){await accounts.deleteUser(uid);await expect(accounts.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}if(app)await deleteApp(app);if(admin)await deleteAdminApp(admin);},90000);
 async function seed(name:string){
  const id=prefix+'-'+name,raw=id+'-raw',startedAt='2026-10-12T01:00:00.000Z';
  const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:id,operationId:id+'-claim',actorUid:uid,startedAt};
  const order={id,companyId:'taebaek',status:'PENDING',items:[],inventoryOperation:{id:generation.operationId,contractVersion:1,actorUid:uid,startedAt,state:'processing',stage:'reservation'}} as unknown as Order;
  paths.add('orders/'+id);await store.doc('orders/'+id).set(order);paths.add('items/'+raw);await store.doc('items/'+raw).set({companyId:'taebaek',name:'참깨',stock:0,lots:[]});paths.add('rawInventories/'+inventoryDocId('taebaek',raw));
  paths.add('rawMaterialLedger/'+operationDocId(id+'-seed'));expect((await executeRawInventoryCommand({operationId:id+'-seed',companyId:'taebaek',rawItemId:raw,kind:'receive',kg:10,effectiveAt:'2026-10-01T00:00:00Z',source:{type:'manual',id:id+'-seed'},materialSnapshot:'참깨',lot:{supplierName:'합성'}},{db:database})).status).toBe('applied');
  const request:OrderRawBatchRequest={version:1,generation,jobId:orderRawBatchJobId(generation),recordedAt:startedAt,legacyJobIds:[],business:{orderText:orderRawBatchOrderEvidence(order),selection:{targetStatus:'DISPATCHED'}},plan:{fixed:true,finalPlan:{reservation:reservationFromEngine()}},commands:[1,2].map(index=>({command:{operationId:id+'-raw-'+index,companyId:'taebaek',rawItemId:raw,kind:'consume',kg:3,effectiveAt:startedAt,source:{type:'production',id},materialSnapshot:'참깨'},options:{legacy:{type:'auto',note:'옛 화면 표시'}}}))};
  paths.add('rawInventoryJobs/'+request.jobId);request.commands.forEach(row=>paths.add('rawMaterialLedger/'+operationDocId(row.command.operationId)));return {id,raw,request};
 }
 const scope=async()=>{const user=auth.currentUser;if(user?.uid!==uid)throw Error('사용자 변경');const token=await user.getIdTokenResult();if(auth.currentUser?.uid!==uid||token.claims.companyId!=='taebaek'||token.claims.employeeId!==uid)throw Error('회사 변경');};
 const snapshot=async()=>Promise.all([...paths].map(async path=>[path,(await store.doc(path).get()).data()]));
 it('예약 Map tuple이 든 실제 직원 첫 원문은 문자열로 저장되고 응답유실 재개도 쓰기0이다',async()=>{
  const {request}=await seed('nested-reservation');const first=JSON.stringify(request),hash=await orderRawBatchRequestHash(request);
  expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('committed');
  const location='rawInventoryJobs/'+request.jobId,doc=await store.doc(location).get(),saved=doc.data()!;
  expect(saved).not.toHaveProperty('request');expect(typeof saved.requestText).toBe('string');
  expect(readOrderRawBatchJobRequest(saved)).toEqual(request);expect(saved.requestHash).toBe(hash);expect(JSON.stringify(request)).toBe(first);
  const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,readOrderRawBatchJobRequest(saved),scope)).status).toBe('duplicate');
  expect(await snapshot()).toEqual(before);expect((await store.doc(location).get()).updateTime!.isEqual(doc.updateTime!)).toBe(true);
 },60000);
 it('동일 홀더 두 명령과 legacy 칸이 있는 실제 영수증을 재개해도 다시 쓰지 않는다',async()=>{const {raw,request}=await seed('same');expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('committed');expect((await store.doc('items/'+raw).get()).data()!.stock).toBe(4);const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('duplicate');expect(await snapshot()).toEqual(before);},60000);
 it('두번째 명령 부족이면 첫 명령·job·단계도 그대로이다',async()=>{const {request}=await seed('reject');request.commands[1].command={...request.commands[1].command,kg:8} as typeof request.commands[number]['command'];const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('rejected');expect(await snapshot()).toEqual(before);},60000);
 it('같은 세대의 주문 원문 변경과 failed 새효과는 쓰기0이다',async()=>{const {id,request}=await seed('changed');await store.doc('orders/'+id).update({purpose:'make-stock'});const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('blocked');expect(await snapshot()).toEqual(before);await store.doc('orders/'+id).update({'inventoryOperation.state':'failed'});const failed=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('blocked');expect(await snapshot()).toEqual(failed);},60000);
 it('영수증 적용량 손상은 완료로 추정하지 않는다',async()=>{const {request}=await seed('damaged');await executeOrderRawBatchWithDb(database,request,scope);await store.doc('rawMaterialLedger/'+operationDocId(request.commands[0].command.operationId)).update({appliedDeltaKg:-2});const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('blocked');expect(await snapshot()).toEqual(before);},60000);
 it('동일 홀더 consume→ledger-consume→consume는 실제 재고4·원장1을 같은 TX로 보존한다',async()=>{const {raw,request}=await seed('mixed');const first=request.commands[0],second=request.commands[1];request.commands=[first,{command:{...second.command,kind:'ledger-consume',kg:3,source:{type:'oem',id:request.generation.orderId}}},{command:{...first.command,operationId:first.command.operationId+'-third'}}];paths.add('rawMaterialLedger/'+operationDocId(request.commands[2].command.operationId));const result=await executeOrderRawBatchWithDb(database,request,scope);expect(result.status).toBe('committed');expect((await store.doc('items/'+raw).get()).data()!.stock).toBe(4);const ledgerDocs=await Promise.all([request.generation.orderId+'-seed',...request.commands.map(row=>row.command.operationId)].map(id=>store.doc('rawMaterialLedger/'+operationDocId(id)).get()));expect(ledgerDocs.reduce((sum,row)=>sum+row.data()!.reportedDeltaKg,0)).toBe(1);expect(result.results.map(row=>row.movement.appliedDeltaKg)).toEqual([-3,0,-3]);const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('duplicate');expect(await snapshot()).toEqual(before);},60000);
 it('최신 실사 앞 명령은 applied0여도 모든 원장 영수증과 완료 job을 남긴다',async()=>{const {raw,request}=await seed('anchor');const id=request.generation.orderId+'-anchor';paths.add('rawMaterialLedger/'+operationDocId(id));await executeRawInventoryCommand({kind:'stocktake',operationId:id,companyId:'taebaek',rawItemId:raw,materialSnapshot:'참깨',effectiveAt:'2026-10-13T00:00:00Z',targetKg:10,source:{type:'stocktake',id}},{db:database});const result=await executeOrderRawBatchWithDb(database,request,scope);expect(result.status).toBe('committed');expect(result.results.map(row=>[row.movement.reportedDeltaKg,row.movement.appliedDeltaKg])).toEqual([[-3,0],[-3,0]]);expect((await store.doc('items/'+raw).get()).data()!.stock).toBe(10);expect((await store.doc('rawInventoryJobs/'+request.jobId).get()).exists).toBe(true);for(const row of request.commands)expect((await store.doc('rawMaterialLedger/'+operationDocId(row.command.operationId)).get()).exists).toBe(true);const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,request,scope)).status).toBe('duplicate');expect(await snapshot()).toEqual(before);},60000);
 it('실제 직원 Rules의 타회사 품목 거절은 원료·job·주문 쓰기0이다',async()=>{const {raw,request}=await seed('foreign');await store.doc('items/'+raw).update({companyId:'punghoe'});const before=await snapshot();await expect(executeOrderRawBatchWithDb(database,request,scope)).rejects.toMatchObject({code:'permission-denied'});expect(await snapshot()).toEqual(before);},60000);
 it('JSON 첫 원문을 실제 같은 직원·줄 claim으로 재개하면 최초 세대와 tuple/hash를 유지한다',async()=>{
  const {id,request}=await seed('actual-claim-retry');const firstOp={id:request.generation.operationId,contractVersion:1,productionRecordContractVersion:1,actorUid:uid,startedAt:request.generation.startedAt,state:'failed',stage:'reservation',actor:'합성 직원',kind:'line',lineId:'line-1',targetStatus:'DISPATCHED'};
  const order={...(await store.doc('orders/'+id).get()).data(),id,items:[{lineId:'line-1',itemId:'product',name:'합성 생산품',quantity:2}],inventoryOperation:firstOp} as unknown as Order;
  await store.doc('orders/'+id).set(order);request.business.orderText=orderRawBatchOrderEvidence(order);request.business.selection={lineId:'line-1',targetStatus:'DISPATCHED'};
  request.plan.productionRecords={version:1,generation:request.generation,recordedAt:request.recordedAt,previousIndex:{},records:[]};
  const first=JSON.stringify(request),hash=await orderRawBatchRequestHash(request);const reloaded=JSON.parse(first) as OrderRawBatchRequest;
  const selected=await claimOrderInventoryOperation(id,OrderStatus.PENDING,{...firstOp,id:id+'-new-id',startedAt:'2026-10-13T01:00:00.000Z',state:'processing'} as NonNullable<Order['inventoryOperation']>);
  expect(selected.inventoryOperation).toMatchObject({...firstOp,state:'processing'});expect(reloaded.generation).toEqual(request.generation);expect(JSON.stringify(reloaded)).toBe(first);expect(await orderRawBatchRequestHash(reloaded)).toBe(hash);
  expect((await executeOrderRawBatchWithDb(database,reloaded,scope)).status).toBe('committed');const saved=await store.doc('rawInventoryJobs/'+request.jobId).get();expect(readOrderRawBatchJobRequest(saved.data()!)).toEqual(reloaded);expect(saved.get('requestHash')).toBe(hash);
  const before=await snapshot();expect((await executeOrderRawBatchWithDb(database,reloaded,scope)).status).toBe('duplicate');expect(await snapshot()).toEqual(before);expect((await saved.ref.get()).updateTime!.isEqual(saved.updateTime!)).toBe(true);
 },60000);
 it('생산기록 계약이 없는 옛 실패 claim은 새 첫 원문으로 승격하지 않고 쓰기0이다',async()=>{
  const {id,request}=await seed('old-claim');await store.doc('orders/'+id).update({inventoryOperation:{id:request.generation.operationId,contractVersion:1,actorUid:uid,startedAt:request.generation.startedAt,state:'failed',kind:'line',lineId:'line-1',targetStatus:'DISPATCHED'}});
  const before=await store.doc('orders/'+id).get(),all=await snapshot();await expect(claimOrderInventoryOperation(id,OrderStatus.PENDING,{id:id+'-new',startedAt:'2026-10-13T01:00:00.000Z',state:'processing',actor:'합성 직원',kind:'line',lineId:'line-1',targetStatus:OrderStatus.DISPATCHED})).rejects.toThrow('생산기록');expect(await snapshot()).toEqual(all);expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 },60000);

});
