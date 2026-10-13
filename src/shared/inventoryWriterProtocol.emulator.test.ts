import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,deleteDoc,getDoc,type Firestore} from 'firebase/firestore';
import {initializeApp as adminInit,deleteApp as adminDelete} from 'firebase-admin/app';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {captureInventoryWriterContext,runInventoryWriterTransaction,protectItemInventoryPatch} from './inventoryWriterProtocol';

describe.skipIf(process.env.INVENTORY_WRITER_TRANSACTION_TEST!=='true')('재고 거래 재시도 실제 직원 인증',{timeout:60000},()=>{
 const uid='writer-tx-'+randomUUID(),projectId='demo-writer-tx-'+randomUUID().slice(0,8),paths=new Set<string>();
 let env:RulesTestEnvironment,db:Firestore,app:ReturnType<typeof initializeApp>,admin:ReturnType<typeof adminInit>;
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('로컬 에뮬레이터 주소가 필요합니다.');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});
  admin=adminInit({projectId:'demo-taebaekfood-local'},uid);
  const email=uid+'@example.invalid',password=randomUUID()+'A1!';
  await adminAuth(admin).createUser({uid,email,password});await adminAuth(admin).setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-only'},uid);db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8082);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(auth,email,password);
  expect((await auth.currentUser!.getIdTokenResult(true)).claims.companyId).toBe('taebaek');
 },90000);
 afterAll(async()=>{
  if(env){await env.withSecurityRulesDisabled(async c=>{for(const path of paths){await deleteDoc(doc(c.firestore(),path));expect((await getDoc(doc(c.firestore(),path))).exists()).toBe(false);}});await env.cleanup();}
  if(admin){await adminAuth(admin).deleteUser(uid);await expect(adminAuth(admin).getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});await adminDelete(admin);}
  if(app)await deleteApp(app);
 },90000);
 async function seed(id:string,companyId='taebaek'){
  const path='items/'+uid+'-'+id;paths.add(path);await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),{companyId,stock:3,lots:[]}));return doc(db,path);
 }
 it('동시 수량 +2와 +3은 두 요청을 각각 한 번 반영한다',async()=>{
  const target=await seed('concurrent');let completed=0;
  const apply=async(delta:number)=>{
   const context=await captureInventoryWriterContext(db,{requestIdentity:uid+'-'+delta});expect(context).toBeDefined();
   const result=await runInventoryWriterTransaction(db,context,async tx=>{const snap=await tx.get(target),before=snap.data()!;tx.update(target,protectItemInventoryPatch(before,{stock:before.stock+delta}));return delta;});completed++;return result;
  };
  expect(await Promise.all([apply(2),apply(3)])).toEqual([2,3]);expect(completed).toBe(2);
  const result=(await getDoc(target)).data()!;expect(result.stock).toBe(8);expect(result.inventoryWriteRevision).toBe(2);
 });
 it('정상 경합 없이 Rules가 거절한 쓰기는 새 거래로 재시도하지 않는다',async()=>{
  const target=await seed('denied');const context=await captureInventoryWriterContext(db,{requestIdentity:uid+'-deny'});let attempts=0;
  await expect(runInventoryWriterTransaction(db,context,async tx=>{attempts++;await tx.get(target);tx.update(target,{stock:4});})).rejects.toMatchObject({code:'permission-denied'});
  expect(attempts).toBe(1);expect((await getDoc(target)).get('stock')).toBe(3);
 });
});
