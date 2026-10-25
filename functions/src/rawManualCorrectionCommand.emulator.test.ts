import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../src/test/emulatorTestPolicy';
import type {App} from 'firebase-admin/app';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import type {RawManualCorrectionRequest} from './rawManualCorrectionCommand';

const policy=createEmulatorTestPolicy(process.env,'raw-manual-transaction',randomUUID);
let app:App|undefined,db:Firestore|undefined;
let appSDK:typeof import('firebase-admin/app');
let execute:typeof import('./rawManualCorrectionCommand').executeRawManualCorrectionCommand;
let core:typeof import('./shared/rawInventoryCore');
const ownedPaths=new Set<string>();
const actor={uid:'raw-manual-sdk-actor',token:{companyId:'taebaek',employeeId:'raw-manual-sdk-employee',isAdmin:false}};
const now='2026-10-26T00:00:00.000Z';
function assertOwned(){policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);if(app)policy.assertOwned(app.options.projectId!);if(db)policy.assertOwned(db.projectId);}
async function guarded<T>(work:()=>Promise<T>):Promise<T>{assertOwned();const result=await work();assertOwned();return result;}
function reference(path:string):DocumentReference{assertOwned();ownedPaths.add(path);return db!.doc(path);}
async function cleanup(){
 await cleanupOwnedResources([
  async()=>{if(!db)return;assertOwned();for(const path of ownedPaths){await guarded(()=>db!.doc(path).delete());}},
  ()=>{if(db){policy.assertOwned(db.projectId);return db.terminate();}},
  ()=>{if(app){policy.assertOwned(app.options.projectId!);return appSDK.deleteApp(app);}},
 ]);
}
function request(rawItemId:string):RawManualCorrectionRequest{
 const operationId='raw-manual-v1-'+randomUUID();
 return{version:1,operationId,companyId:'taebaek',actorUid:actor.uid,employeeId:actor.token.employeeId,
  command:{operationId,companyId:'taebaek',rawItemId,materialSnapshot:'합성 참깨',effectiveAt:now,source:{type:'adjustment',id:operationId},kind:'consume',kg:10},
  options:{now,newLotId:'lot-'+operationId,carryOverLotId:'carry-'+operationId,legacy:{note:'에뮬레이터 합성 정정',type:'correction',addedBy:'합성 직원',originalAmount:10,originalUnit:'kg'}},
  display:{originalId:'fixture-original',material:'합성 참깨',amount:'10',unit:'kg',date:'2026-10-26',note:'에뮬레이터 합성 정정',mode:'pos'}};
}
async function fixture(){
 const rawItemId='raw-'+randomUUID(),r=request(rawItemId);
 const seed=core.applyRawCommand({state:null,command:{operationId:'seed-'+rawItemId,companyId:'taebaek',rawItemId,materialSnapshot:'합성 참깨',effectiveAt:'2026-10-25T00:00:00.000Z',source:{type:'stocktake',id:'seed-'+rawItemId},kind:'stocktake',targetKg:100},det:{now:'2026-10-25T00:00:00.000Z',newLotId:'seed-lot-'+rawItemId}});
 if(seed.status!=='applied')throw Error('순수 코어 seed 준비 실패');
 const module=await guarded(()=>import('./rawManualCorrectionCommand'));
 const paths={item:'items/'+rawItemId,state:'rawInventories/'+core.inventoryDocId('taebaek',rawItemId),movement:'rawMaterialLedger/'+core.operationDocId(r.operationId),legacy:'rawMaterialLedger/'+core.legacyOperationDocId(r.operationId),receipt:'rawManualCorrectionReceipts/'+module.rawManualCorrectionReceiptId(r.companyId,r.operationId)};
 for(const path of Object.values(paths))reference(path);
 const batch=db!.batch();batch.set(reference(paths.item),JSON.parse(JSON.stringify({id:rawItemId,companyId:'taebaek',name:'합성 참깨',stock:100,lots:[...seed.state.activeLots,...seed.state.recentDepletedLots]})));batch.set(reference(paths.state),JSON.parse(JSON.stringify(seed.state)));await guarded(()=>batch.commit());
 const read=async()=>{
  const rows=await guarded(()=>db!.getAll(...[paths.item,paths.state,paths.movement,paths.receipt].map(reference)));
  return{item:rows[0]!.data(),state:rows[1]!.data(),movement:rows[2]!.data(),receipt:rows[3]!.data()};
 };
 const run=(action:'apply'|'inspect'|'cancel')=>guarded(()=>execute(db!,actor,{action,request:r}));
 return{r,paths,read,run};
}
describe.skipIf(!policy.enabled)('원료수동정정 실제 소유 Admin Firestore transaction',()=>{
 beforeAll(async()=>{
  assertOwned();
  try{
   appSDK=await guarded(()=>import('firebase-admin/app'));
   const firestoreSDK=await guarded(()=>import('firebase-admin/firestore'));
   core=await guarded(()=>import('./shared/rawInventoryCore'));
   const server=await guarded(()=>import('./rawManualCorrectionCommand'));execute=server.executeRawManualCorrectionCommand;
   assertOwned();app=appSDK.initializeApp({projectId:policy.projectId},policy.appName);assertOwned();
   db=firestoreSDK.getFirestore(app);assertOwned();
  }catch(error){await cleanupOwnedResources([cleanup],error);throw error;}
 });
 afterAll(cleanup);
 it('동시 apply/cancel은 같은 terminal 하나와 일치하는 원장·상태·mirror만 남긴다',async()=>{
  const f=await fixture();assertOwned();const results=await guarded(()=>Promise.all([f.run('apply'),f.run('cancel')]));
  expect(['applied','cancelled']).toContain(results[0]!.status);expect(results[1]!.status).toBe(results[0]!.status);
  const saved=await f.read();assertOwned();expect(saved.receipt!.status).toBe(results[0]!.status);expect(saved.receipt!.request.operationId).toBe(f.r.operationId);
  const applied=results[0]!.status==='applied';expect(saved.item!.stock).toBe(applied?90:100);expect(saved.state!.stockKg).toBe(applied?90:100);expect(!!saved.movement).toBe(applied);
  if(applied){expect(saved.movement).toMatchObject({operationId:f.r.operationId,appliedDeltaKg:-10,balanceAfterKg:90});expect(saved.item!.inventoryWriteRevision).toBe(1);expect(saved.state!.inventoryWriteRevision).toBe(1);}
 });
 it.each(['apply','cancel'] as const)('%s 선행 commit 뒤 늦은 반대 요청은 기존 terminal을 바꾸지 않는다',async first=>{
  const f=await fixture();assertOwned();const original=await f.run(first);assertOwned();const before=await f.read();assertOwned();
  const late=await f.run(first==='apply'?'cancel':'apply');assertOwned();expect(late).toEqual(original);expect(await f.read()).toEqual(before);assertOwned();
 });
 it('실제 commit 응답을 시험 transport에서 버린 뒤 inspect/동일apply가 효과1을 확인한다',async()=>{
  const f=await fixture();assertOwned();
  const loseResponse=async()=>{await f.run('apply');assertOwned();throw Error('시험 transport가 commit ACK를 버림');};
  await expect(loseResponse()).rejects.toThrow('commit ACK');assertOwned();const before=await f.read();assertOwned();expect(before.item!.stock).toBe(90);
  expect((await f.run('inspect')).status).toBe('applied');assertOwned();expect((await f.run('apply')).status).toBe('applied');assertOwned();expect(await f.read()).toEqual(before);assertOwned();
 });
 it.each(['movement','legacy'] as const)('%s orphan 원장이 있으면 cancel은 conflict이며 receipt를 생성하지 않는다',async field=>{
  const f=await fixture();assertOwned();await guarded(()=>reference(f.paths[field]).set({companyId:'taebaek',operationId:f.r.operationId,marker:'own-orphan'}));
  expect((await f.run('cancel')).status).toBe('conflict');assertOwned();const saved=await f.read();assertOwned();expect(saved.receipt).toBeUndefined();expect(saved.item!.stock).toBe(100);expect(saved.state!.stockKg).toBe(100);
  expect((await guarded(()=>reference(f.paths[field]).get())).data()!.marker).toBe('own-orphan');
 });
 it('실 tx.create 직전 시험용 throw는 상태·원장·mirror·receipt 모두 무변경으로 rollback한다',async()=>{
  const f=await fixture();assertOwned();const before=await f.read();assertOwned();
  // 실제 Firestore 거래를 쓰되 receipt create 직전만 의도적으로 실패시킨다. 서버 자연실패 재현은 아니다.
  const failing={collection:(name:string)=>db!.collection(name),runTransaction:<T,>(work:(tx:Transaction)=>Promise<T>)=>db!.runTransaction(tx=>{
   const wrapped=new Proxy(tx,{get(target,property){if(property==='create')return()=>{throw Error('시험용 receipt create 직전 실패');};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
   return work(wrapped);
  })} as unknown as Firestore;
  await expect(guarded(()=>execute(failing,actor,{action:'apply',request:f.r}))).rejects.toThrow('create 직전');assertOwned();expect(await f.read()).toEqual(before);assertOwned();
 });
});
