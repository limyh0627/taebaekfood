import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,updateDoc,deleteDoc,getDoc,writeBatch,runTransaction,type Firestore} from 'firebase/firestore';
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {advanceInventoryWriterProtocol} from '../../functions/src/shared/inventoryWriterProtocol';

const enabled=process.env.INVENTORY_WRITER_RULES_TEST==='true';
describe.skipIf(!enabled)('재고 writer 실제 직원 인증·Rules 봉쇄',{timeout:60000},()=>{
 const run=randomUUID(),projectId='demo-writer-rules-'+run.slice(0,8),uid='writer-'+run,paths=new Set<string>();
 let env:RulesTestEnvironment,db:Firestore,app:ReturnType<typeof initializeApp>,admin:ReturnType<typeof adminApp>;
 const ref=(collection:string,id:string)=>{paths.add(collection+'/'+id);return doc(db,collection,id);};
 const seed=async(collection:string,id:string,data:Record<string,any>)=>{paths.add(collection+'/'+id);await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),collection,id),data));};
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('로컬 Firestore/Auth 주소를 명시해 주세요.');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});
  // Auth는 현재 에뮬레이터의 프로젝트를 사용하고 Rules·자료는 별도 고유 프로젝트로 격리한다.
  admin=adminApp({projectId:'demo-taebaekfood-local'},uid);const accounts=adminAuth(admin),email=uid+'@example.invalid',password=randomUUID()+'A1!';
  await accounts.createUser({uid,email,password});await accounts.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-only'},uid);db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8082);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(auth,email,password);
  expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:false});
 },90000);
 afterAll(async()=>{
  if(env){await env.withSecurityRulesDisabled(async context=>{for(const path of paths){await deleteDoc(doc(context.firestore(),path));expect((await getDoc(doc(context.firestore(),path))).exists()).toBe(false);}});await env.cleanup();}
  if(admin){await adminAuth(admin).deleteUser(uid);await expect(adminAuth(admin).getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});await deleteAdminApp(admin);}
  if(app)await deleteApp(app);
 },90000);
 const marked=(data:Record<string,any>,revision=7)=>({...data,inventoryWriterProtocolVersion:1,inventoryWriteRevision:revision});
 it('생산 기록은 생성·수정의 표식과 +1을 요구하고 정상 수동 삭제는 유지한다',async()=>{
  const record=ref('productionRecords','record-current');
  await assertFails(setDoc(record,{companyId:'taebaek',orderId:'synthetic',finishedQty:3}));
  await assertSucceeds(setDoc(record,marked({companyId:'taebaek',orderId:'synthetic',finishedQty:3},1)));
  await assertFails(updateDoc(record,{finishedQty:4}));
  await assertFails(updateDoc(record,{finishedQty:4,inventoryWriteRevision:1}));
  await assertSucceeds(updateDoc(record,{finishedQty:4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2}));
  await assertSucceeds(deleteDoc(record));
  const legacy=ref('productionRecords','record-legacy');await seed('productionRecords','record-legacy',{companyId:'taebaek',finishedQty:1});
  await assertFails(updateDoc(legacy,{finishedQty:2}));
  await assertSucceeds(updateDoc(legacy,{finishedQty:2,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));
  await assertSucceeds(deleteDoc(legacy));
 });
 it.each([false,true])('cached27 item-only stock/lots/예약 쓰기는 표식 %s와 무관하게 거절한다',async tagged=>{
  const id='item-'+tagged,base={companyId:'taebaek',stock:10,lots:[{id:'lot',qtyRemaining:10}],inventoryReservations:[{orderId:'old',operationId:'old',qty:2}]};
  await seed('items',id,tagged?marked(base):base);const item=ref('items',id),before=(await getDoc(item)).data();
  for(const patch of [{stock:9},{lots:[]},{inventoryReservations:[]},{stocktakeAnchors:[{id:'old'}]},{allocated:1}])await assertFails(updateDoc(item,patch));
  expect((await getDoc(item)).data()).toEqual(before);
  await assertSucceeds(updateDoc(item,advanceInventoryWriterProtocol(before,{stock:9})));
  await assertFails(updateDoc(item,{inventoryWriterProtocolVersion:0,inventoryWriteRevision:0}));
  await assertFails(setDoc(item,{companyId:'taebaek',stock:1}));
  const after=(await getDoc(item)).data()!;await assertSucceeds(updateDoc(item,{name:'현재 이름'}));expect((await getDoc(item)).get('inventoryWriteRevision')).toBe(after.inventoryWriteRevision);
 });
 it.each(['rawInventories','rawInventoryJobs','rawMaterialLedger','rawInventoryReversalGuards'])('%s는 무표식·복제 revision·표식 탈락·삭제를 막고 정상 원자 쓰기를 허용한다',async collection=>{
  const id=collection,target=ref(collection,id);await assertFails(setDoc(target,{companyId:'taebaek',status:'processing'}));
  await assertSucceeds(setDoc(target,advanceInventoryWriterProtocol(undefined,{companyId:'taebaek',status:'processing'})));
  const before=(await getDoc(target)).data()!;await assertFails(updateDoc(target,{status:'complete'}));await assertFails(updateDoc(target,{status:'complete',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));
  await assertFails(deleteDoc(target));await assertSucceeds(updateDoc(target,advanceInventoryWriterProtocol(before,{status:'complete'})));
 });
 it.each([false,true])('cached 주문 상태·claim·stage·품목 효과 변경은 표식 %s에서도 거절한다',async tagged=>{
  const id='order-cached-'+tagged,base={companyId:'taebaek',status:'PENDING',inventoryOperation:{id:'old',stage:'claim'},items:[]};
  await seed('orders',id,tagged?marked(base):base);const target=ref('orders',id),before=(await getDoc(target)).data()!;
  for(const patch of [{status:'DISPATCHED'},{inventoryOperation:{id:'new',stage:'claim'}},{'inventoryOperation.stage':'final-stock'},{items:[{itemId:'raw',quantity:1}]},{shippedOut:true}])await assertFails(updateDoc(target,patch));
  await assertSucceeds(updateDoc(target,advanceInventoryWriterProtocol(before,{status:'PROCESSING'})));
  await assertSucceeds(updateDoc(target,{deliveryDate:'2026-10-14',note:'현재 메모'}));
  await assertFails(updateDoc(target,{inventoryWriterProtocolVersion:0}));
 });
 it('표식 있는 문서의 누락·소수·역행 revision과 타회사 쓰기는 모두 거절한다',async()=>{
  const item=ref('items','invalid-revision');await seed('items','invalid-revision',marked({companyId:'taebaek',stock:5}));
  for(const revision of [0,7,8.1,9007199254740992])await assertFails(updateDoc(item,{stock:4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:revision}));
  await assertFails(updateDoc(item,{companyId:'punghoe',stock:4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:8}));
  await seed('items','invalid-revision',{companyId:'taebaek',stock:5,inventoryWriterProtocolVersion:1});
  await assertFails(updateDoc(item,{stock:4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));
 });
 it('cached raw 원장/state/item 한 거래의 일부 쓰기도 남지 않는다',async()=>{
  await seed('items','raw',{companyId:'taebaek',stock:5,lots:[]});await seed('rawInventories','taebaek__raw',{companyId:'taebaek',stockKg:5});
  const ledger=ref('rawMaterialLedger','old-operation'),item=ref('items','raw'),state=ref('rawInventories','taebaek__raw');
  const batch=writeBatch(db);batch.set(ledger,{companyId:'taebaek',operationId:'old-operation'});batch.update(item,{stock:4});batch.update(state,{stockKg:4});await assertFails(batch.commit());
  expect((await getDoc(ledger)).exists()).toBe(false);expect((await getDoc(item)).get('stock')).toBe(5);
  await assertSucceeds(runTransaction(db,async tx=>{const [a,b]=await Promise.all([tx.get(item),tx.get(state)]);tx.update(item,advanceInventoryWriterProtocol(a.data(),{stock:4}));tx.update(state,advanceInventoryWriterProtocol(b.data(),{stockKg:4}));tx.set(ledger,advanceInventoryWriterProtocol(undefined,{companyId:'taebaek',operationId:'new'}));}));
 });
 it('신규 품목은1, 삭제 기록과 함께 지우고 재생성은 마지막 품목 revision 다음 값만 허용한다',async()=>{
  const item=ref('items','recreate'),tomb=ref('inventoryWriterDeletions','taebaek__recreate');await assertFails(setDoc(item,{companyId:'taebaek',stock:1}));
  await assertSucceeds(setDoc(item,advanceInventoryWriterProtocol(undefined,{companyId:'taebaek',stock:1})));await assertFails(deleteDoc(item));
  const deleted={companyId:'taebaek',itemId:'recreate',inventoryWriterProtocolVersion:1,beforeRevision:1,lastDeletedItemRevision:1,deletionRevision:1};
  const batch=writeBatch(db);batch.delete(item);batch.set(tomb,deleted);await assertSucceeds(batch.commit());await assertFails(deleteDoc(tomb));
  await assertFails(setDoc(item,{companyId:'taebaek',stock:1,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));
  await assertSucceeds(setDoc(item,{companyId:'taebaek',stock:1,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2}));
  const reuse=writeBatch(db);reuse.delete(item);reuse.set(tomb,deleted);await assertFails(reuse.commit());expect((await getDoc(item)).exists()).toBe(true);
  const again=writeBatch(db);again.delete(item);again.set(tomb,{...deleted,beforeRevision:2,lastDeletedItemRevision:2,deletionRevision:2});await assertSucceeds(again.commit());
 });
 it('retired 주문의 서버 표식은 불변이며 첫 server claim 뒤 정상 protocol claim을 허용한다',async()=>{
  const order=ref('orders','retired'),base=marked({companyId:'taebaek',status:'PENDING',retirementId:'server-retirement',retirementClaimPending:true,inventoryOperation:null});await seed('orders','retired',base);
  await assertFails(updateDoc(order,{inventoryOperation:{id:'cached',state:'processing'}}));await assertFails(updateDoc(order,advanceInventoryWriterProtocol(base,{inventoryOperation:{id:'new'}})));
  await assertFails(updateDoc(order,{retirementClaimPending:false}));await assertFails(updateDoc(order,{retirementId:'changed'}));await assertSucceeds(updateDoc(order,{note:'메모'}));
  await seed('orders','retired',{...base,retirementClaimPending:false});await assertSucceeds(updateDoc(order,advanceInventoryWriterProtocol(base,{inventoryOperation:{id:'new',state:'processing'}})));
 });
 it('주문 삭제는 현재 claim의 새 audit를 같은 거래에 쓰며 옛 audit 재사용은 거절한다',async()=>{
  const order=ref('orders','delete-order'),audit=ref('orderStatusAudits','delete-claim'),base=marked({companyId:'taebaek',status:'PENDING',inventoryOperation:{id:'delete-claim'}});
  await seed('orders','delete-order',base);await assertFails(deleteDoc(order));const receipt={id:'delete-claim',companyId:'taebaek',orderId:'delete-order',state:'completed',beforeOrderWriteRevision:7,cancellation:{action:'delete',deleted:true},inventoryWriterProtocolVersion:1,inventoryWriteRevision:1};
  await seed('orderStatusAudits','delete-claim',receipt);await assertFails(deleteDoc(order));await env.withSecurityRulesDisabled(context=>deleteDoc(doc(context.firestore(),'orderStatusAudits','delete-claim')));
  const batch=writeBatch(db);batch.delete(order);batch.set(audit,receipt);await assertSucceeds(batch.commit());
 });
 it('늦은 cached 예약 TX가 먼저 읽어도 정상 writer 커밋 뒤 재시도에서 거절된다',async()=>{
  const item=ref('items','race');await seed('items','race',marked({companyId:'taebaek',stock:5,inventoryReservations:[]}));
  let reached!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>reached=resolve),held=new Promise<void>(resolve=>release=resolve);let attempts=0;
  const late=runTransaction(db,async tx=>{await tx.get(item);if(++attempts===1){reached();await held;}tx.update(item,{inventoryReservations:[{orderId:'old',qty:1}]});}).then(()=>false,()=>true);
  await ready;const before=(await getDoc(item)).data()!;await assertSucceeds(updateDoc(item,advanceInventoryWriterProtocol(before,{stock:4})));release();expect(await late).toBe(true);expect((await getDoc(item)).get('inventoryReservations')).toEqual([]);expect((await getDoc(item)).get('stock')).toBe(4);
 });
});
