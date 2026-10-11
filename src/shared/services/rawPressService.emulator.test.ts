import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { initializeApp,deleteApp } from 'firebase/app';
import { connectAuthEmulator,getAuth,signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator,getFirestore } from 'firebase/firestore';
import { initializeApp as adminApp,deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { executeRawPressWithDb } from './rawPressService';
import { executeRawInventoryCommand } from './rawInventoryService';
import { inventoryDocId,operationDocId } from '../rawInventoryCore';
import type { RawPressRequest } from '../rawPressAttempt';
import type { CompanyId } from '../types';
describe.skipIf(process.env.RAW_PRESS_EMULATOR_TEST!=='true')('압착 실제 Auth·Firestore 원자 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='press-'+randomUUID(),paths=new Set<string>();
 let admin:ReturnType<typeof adminApp>,store:ReturnType<typeof adminFirestore>,accounts:ReturnType<typeof adminAuth>;
 const clients:any[]=[];
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('로컬 Emulator 주소만 허용');
  admin=adminApp({projectId},prefix);store=adminFirestore(admin);accounts=adminAuth(admin);
  for(const companyId of ['taebaek','punghoe'] as const){const uid=prefix+'-'+companyId,password=randomUUID()+'A1!',email=uid+'@example.invalid';await accounts.createUser({uid,email,password});await accounts.setCustomUserClaims(uid,{employeeId:uid,companyId,isAdmin:true});const app=initializeApp({projectId,apiKey:'local-only'},uid),db=getFirestore(app),auth=getAuth(app);connectFirestoreEmulator(db,'127.0.0.1',8082);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(auth,email,password);clients.push({app,db,auth,uid,companyId});}
 },90000);
 afterAll(async()=>{for(const path of paths){await store.doc(path).delete();expect((await store.doc(path).get()).exists).toBe(false);}for(const c of clients){await accounts.deleteUser(c.uid);await expect(accounts.getUser(c.uid)).rejects.toMatchObject({code:'auth/user-not-found'});await deleteApp(c.app);}if(admin)await deleteAdminApp(admin);},90000);
 async function seed(suffix:string,companyId:CompanyId='taebaek'){
  const c=clients.find(x=>x.companyId===companyId),id=prefix+'-'+suffix,source=id+'-source',derived=id+'-derived',lot=id+'-lot',time='2026-10-12T01:00:00Z';
  for(const item of [source,derived]){paths.add('items/'+item);paths.add('rawInventories/'+inventoryDocId(companyId,item));await store.doc('items/'+item).create({companyId,name:item===source?'참깨':'통깨참기름',stock:0,lots:[]});}
  paths.add('rawMaterialLedger/'+operationDocId(id+'-seed'));
  expect((await executeRawInventoryCommand({operationId:id+'-seed',companyId,rawItemId:source,materialSnapshot:'참깨',effectiveAt:'2026-10-01T00:00:00Z',kind:'receive',kg:100,lot:{supplierName:'합성 공급처'},source:{type:'manual',id:id+'-seed'}},{db:c.db,newLotId:lot})).status).toBe('applied');
  paths.add('rawMaterialLedger/'+operationDocId(id));paths.add('rawMaterialLedger/'+operationDocId('yield:'+id));paths.add('rawInventoryJobs/raw-press-'+operationDocId(id));
  const request:RawPressRequest={version:1,companyId,actorUid:c.uid,entry:{id,material:'참깨',date:'2026-10-12',received:0,used:10,note:'합성 시험',type:'manual',createdAt:time,effectiveAt:time,targetLotId:lot},yieldRule:{product:'통깨참기름',rate:0.48},sourceCommand:{operationId:id,companyId,rawItemId:source,materialSnapshot:'참깨',effectiveAt:time,source:{type:'manual',id},kind:'consume-lot',kg:10,lotId:lot},derivedCommand:{operationId:'yield:'+id,companyId,rawItemId:derived,materialSnapshot:'통깨참기름',effectiveAt:time,source:{type:'manual',id},kind:'receive',kg:4.8,lot:{supplierName:'참깨 압착',qtyIn:0}},sourceLegacy:{type:'manual'},derivedLegacy:{type:'auto'}};
  return {c,request,source,derived};
 }
 const scope=(c:any,r:RawPressRequest)=>async()=>{const token=await c.auth.currentUser.getIdTokenResult();if(c.auth.currentUser.uid!==r.actorUid||token.claims.companyId!==r.companyId)throw Error('로그인 원문 변경');};
 const read=async()=>Promise.all([...paths].map(async path=>[path,(await store.doc(path).get()).data()]));
 it('동시 동일 원문은 하나의 pair만 만들며 재개도 추가 차감하지 않는다',async()=>{const {c,request,source,derived}=await seed('same');const results=await Promise.all([executeRawPressWithDb(c.db,request,scope(c,request)),executeRawPressWithDb(c.db,request,scope(c,request))]);expect(results.map(x=>x.status).sort()).toEqual(['applied','duplicate']);expect((await store.doc('items/'+source).get()).data()!.stock).toBe(90);expect((await store.doc('items/'+derived).get()).data()!.stock).toBe(4.8);const before=await read();expect((await executeRawPressWithDb(c.db,request,scope(c,request))).status).toBe('duplicate');expect(await read()).toEqual(before);},60000);
 it('파생 회사 거절과 서명된 다른 회사·UID는 어느 쪽도 쓰지 않는다',async()=>{const {c,request,derived}=await seed('boundary');await store.doc('items/'+derived).update({companyId:'punghoe'});const before=await read();await expect(executeRawPressWithDb(c.db,request,scope(c,request))).rejects.toMatchObject({code:'permission-denied'});expect(await read()).toEqual(before);await expect(executeRawPressWithDb(clients[1].db,request,scope(clients[1],request))).rejects.toThrow('로그인');expect(await read()).toEqual(before);},60000);
 it('부족 거절은 원료·파생·job 쓰기0이며 완료 영수증 변조는 보존한다',async()=>{const {c,request}=await seed('reject');const excessive={...request,entry:{...request.entry,used:101},sourceCommand:{...request.sourceCommand,kg:101},derivedCommand:{...request.derivedCommand,kg:48.48}};const before=await read();expect(await executeRawPressWithDb(c.db,excessive,scope(c,excessive))).toMatchObject({status:'blocked',retainPending:false});expect(await read()).toEqual(before);await executeRawPressWithDb(c.db,request,scope(c,request));const receipt='rawMaterialLedger/'+operationDocId(request.entry.id);await store.doc(receipt).update({reportedDeltaKg:-9});const damaged=await read();expect(await executeRawPressWithDb(c.db,request,scope(c,request))).toMatchObject({status:'blocked',retainPending:true});expect(await read()).toEqual(damaged);},60000);
 it.each(['source','derived'] as const)('%s 최신 앵커 소급은 각 적용량과 pair disposition을 보존한다',async side=>{const {c,request}=await seed('anchor-'+side);const command=side==='source'?request.sourceCommand:request.derivedCommand;const operationId=request.entry.id+'-anchor';paths.add('rawMaterialLedger/'+operationDocId(operationId));expect((await executeRawInventoryCommand({...command,kind:'stocktake',operationId,targetKg:side==='source'?100:0,effectiveAt:'2026-10-13T00:00:00Z'},{db:c.db})).status).toBe('applied');expect(await executeRawPressWithDb(c.db,request,scope(c,request))).toMatchObject({status:'applied',sourceAppliedKg:side==='source'?0:-10,derivedAppliedKg:0});const job=(await store.doc('rawInventoryJobs/raw-press-'+operationDocId(request.entry.id)).get()).data()!;expect(job.derivedDisposition).toBe(side==='source'?'source-unapplied':'received');expect((await store.doc('rawMaterialLedger/'+operationDocId(request.entry.id)).get()).exists).toBe(true);const derived=(await store.doc('rawMaterialLedger/'+operationDocId(request.derivedCommand.operationId)).get());if(side==='source')expect(derived.exists).toBe(false);else expect(derived.data()).toMatchObject({reportedDeltaKg:4.8,appliedDeltaKg:0});const before=await read();expect((await executeRawPressWithDb(c.db,request,scope(c,request))).status).toBe('duplicate');expect(await read()).toEqual(before);},60000);
});
