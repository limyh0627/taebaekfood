import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {OrderStatus} from '../types';
import {finalOrderInventoryRequestText,type OrderInventoryGeneration} from '../orderInventoryGeneration';
const gateway=vi.hoisted(()=>({db:undefined as any}));
const callable=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('firebase/functions',()=>({httpsCallable:(_functions:unknown,name:string)=>{if(name!=='claimRetiredOrderInventoryOperationCommand')throw Error('다른 명령입니다.');return callable.call;}}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},authReady:Promise.resolve(),functions:{},auth:{currentUser:{uid:'writer',getIdTokenResult:async()=>({claims:{companyId:'taebaek',employeeId:'writer'}})}}}));
import {addItem,updateItem,commitCompanyWrites,setDocument,claimOrderInventoryOperation} from './firebaseService';
describe.skipIf(process.env.INVENTORY_WRITER_EMULATOR_TEST!=='true')('공용 gateway 실제 SDK fence·삭제 기록',()=>{
 let env:RulesTestEnvironment;
 let adminApp:ReturnType<typeof initializeAdminApp>,adminDb:ReturnType<typeof getAdminFirestore>;
 const storage=new Map<string,string>(),previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const projectId='demo-writer-'+randomUUID().slice(0,18),paths=new Set<string>();
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('승인된 로컬 에뮬레이터 주소가 아닙니다.');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});
  gateway.db=env.authenticatedContext('writer',{companyId:'taebaek',employeeId:'writer',isAdmin:false}).firestore();
  adminApp=initializeAdminApp({projectId},projectId);adminDb=getAdminFirestore(adminApp);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}});
 },30_000);
 afterAll(async()=>{if(env){await env.withSecurityRulesDisabled(async ctx=>{for(const path of paths){const {deleteDoc}=await import('firebase/firestore');await deleteDoc(doc(ctx.firestore(),path));}});await env.cleanup();}if(adminApp)await deleteAdminApp(adminApp);if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete (globalThis as any).localStorage;},30_000);
 async function seed(path:string,data:Record<string,unknown>){paths.add(path);await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));}
 async function read(path:string){return (await getDoc(doc(gateway.db,path))).data();}
 it('초기 create1·민감변경2·metadata 유지와 구형stock update 거절',async()=>{
  paths.add('items/new');await addItem('items',{id:'new',name:'합성',stock:0,lots:[]});expect(await read('items/new')).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});
  await updateItem('items','new',{stock:2});expect(await read('items/new')).toMatchObject({stock:2,inventoryWriteRevision:2});
  await updateItem('items','new',{cost:0});expect(await read('items/new')).toMatchObject({stock:2,cost:0,inventoryWriteRevision:2});
  await expect(updateDoc(doc(gateway.db,'items/new'),{stock:3})).rejects.toMatchObject({code:'permission-denied'});expect((await read('items/new'))?.stock).toBe(2);
 });
 it('미표식 legacy품목도 구형writer는 거절하고 현재writer만 최초marker를 만든다',async()=>{
  await seed('items/legacy',{companyId:'taebaek',name:'과거',stock:1,lots:[]});
  await expect(updateDoc(doc(gateway.db,'items/legacy'),{stock:2})).rejects.toMatchObject({code:'permission-denied'});
  await updateItem('items','legacy',{stock:2});expect(await read('items/legacy')).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,stock:2});
 });
 it('stale 전체 객체는 marker를 새로 붙여 정상재고를 덮지 않는다',async()=>{
  await seed('items/stale',{companyId:'taebaek',name:'합성',stock:5,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});
  await expect(updateItem('items','stale',{name:'수정',stock:3,lots:[]})).rejects.toThrow('사본');expect(await read('items/stale')).toMatchObject({stock:5,inventoryWriteRevision:4});
 });
 it('linkeddelete·tombstone 이번TX 증가·재생성 floor 및 재사용삭제 거절',async()=>{
  await seed('items/delete',{companyId:'taebaek',name:'합성',stock:0,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});
  await seed('partner_item/link',{companyId:'taebaek',itemId:'delete'});paths.add('inventoryWriterDeletions/taebaek__delete');
  await commitCompanyWrites([{kind:'delete',collection:'items',id:'delete'},{kind:'delete',collection:'partner_item',id:'link'}]);
  expect((await getDoc(doc(gateway.db,'items/delete'))).exists()).toBe(false);expect(await read('inventoryWriterDeletions/taebaek__delete')).toMatchObject({deletionRevision:1,beforeRevision:4,lastDeletedItemRevision:4});
  await addItem('items',{id:'delete',name:'재생성',stock:0,lots:[]});expect(await read('items/delete')).toMatchObject({inventoryWriteRevision:5});
  const {deleteDoc}=await import('firebase/firestore');await expect(deleteDoc(doc(gateway.db,'items/delete'))).rejects.toMatchObject({code:'permission-denied'});
  await commitCompanyWrites([{kind:'delete',collection:'items',id:'delete'}]);expect(await read('inventoryWriterDeletions/taebaek__delete')).toMatchObject({deletionRevision:2,beforeRevision:5});
 });
 it('서버retirement metadata는 일반memo저장 뒤 유지하고 client 변경은 거절한다',async()=>{
  await seed('orders/pending',{companyId:'taebaek',status:'주문대기',items:[],retirementId:'terminal',retirementClaimPending:true,inventoryWriterProtocolVersion:1,inventoryWriteRevision:3});
  await setDocument('orders','pending',{memo:'새 메모'});expect(await read('orders/pending')).toMatchObject({retirementId:'terminal',retirementClaimPending:true,inventoryWriteRevision:3});
  await expect(updateItem('orders','pending',{retirementClaimPending:false})).rejects.toThrow('서버');
 });
 it('실제 server 첫claim commit 응답유실 뒤 pendingfalse를 최초원문 ACK하며 item/raw 추가쓰기0이다',async()=>{
  gateway.db=env.authenticatedContext('writer',{companyId:'taebaek',employeeId:'writer',isAdmin:true}).firestore();
  const {claimRetiredOrderInventoryOperation:serverClaim}=await import('../../../functions/src/orderRequestRetirement');
  const retirementId='a'.repeat(64),orderId='first-claim';
  await seed('appMeta/releaseCutover',{status:'active',releaseId:'release'});
  await seed('items/claim-item',{companyId:'taebaek',stock:7,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:3});
  await seed('rawInventories/claim-raw',{companyId:'taebaek',rawItemId:'claim-item',stockKg:7,activeLots:[],recentDepletedLots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:3});
  await seed('orders/'+orderId,{companyId:'taebaek',status:OrderStatus.PENDING,items:[],inventoryOperation:null,retirementId,retirementClaimPending:true,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});
  await seed('orderRequestRetirements/'+retirementId,{status:'retired',inventoryApplied:'unknown',action:'allow-new-claim',allowNewClaim:true,companyId:'taebaek',actorUid:'writer',orderId,retirementId,generation:{operationId:'old'},manifest:[{collection:'items',id:'claim-item',existed:true,revision:3,deletionRevision:0,deletionFloor:0},{collection:'rawInventories',id:'claim-raw',rawItemId:'claim-item',existed:true,revision:3}]});
  const operation={id:'original-nonce',startedAt:'2026-10-13T00:00:00Z',actor:'합성 직원',kind:'status' as const,targetStatus:OrderStatus.PROCESSING,state:'processing' as const};
  const beforeItem=await adminDb.doc('items/claim-item').get(),beforeRaw=await adminDb.doc('rawInventories/claim-raw').get();
  let lost=true;callable.call.mockReset().mockImplementation(async(input:any)=>{const data=await serverClaim(adminDb,'taebaek','writer',input);if(lost){lost=false;throw Error('응답 유실');}return {data};});
  await expect(claimOrderInventoryOperation(orderId,OrderStatus.PENDING,operation)).rejects.toThrow('응답 유실');
  const key='order-retirement-first-claim:writer:taebaek:'+orderId,first=storage.get(key)!;
  expect(first).toBeTruthy();expect(await read('orders/'+orderId)).toMatchObject({retirementClaimPending:false,inventoryOperation:{id:'original-nonce'},inventoryWriteRevision:5});
  const firstOrder=await adminDb.doc('orders/'+orderId).get(),firstTerminal=await adminDb.doc('orderRequestRetirements/'+retirementId).get();
  const ack=await claimOrderInventoryOperation(orderId,OrderStatus.PENDING,{...operation,id:'replacement-nonce',startedAt:'2026-10-14T00:00:00Z'});
  expect(ack.inventoryOperation).toMatchObject({id:operation.id,startedAt:operation.startedAt});expect(storage.has(key)).toBe(false);
  expect(callable.call).toHaveBeenCalledTimes(2);expect(callable.call.mock.calls[1][0].requestText).toBe(JSON.parse(first).requestText);
  for(const [path,before]of [['items/claim-item',beforeItem],['rawInventories/claim-raw',beforeRaw],['orders/'+orderId,firstOrder],['orderRequestRetirements/'+retirementId,firstTerminal]] as const)expect((await adminDb.doc(path).get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  const generation:OrderInventoryGeneration={contractVersion:1,companyId:'taebaek',orderId,operationId:operation.id,startedAt:operation.startedAt,actorUid:'writer'};
  await adminDb.doc('orders/'+orderId).update({status:OrderStatus.PROCESSING,inventoryOperation:null,inventoryGenerationCompletion:{generation,completedAt:operation.startedAt,requestText:finalOrderInventoryRequestText(generation,new Map(),[],{}),consumedLots:[],consumedLotsText:'[]'}});
  storage.set(key,first);const completedOrder=await adminDb.doc('orders/'+orderId).get();
  const completedAck=await claimOrderInventoryOperation(orderId,OrderStatus.PENDING,{...operation,id:'replacement-completed',startedAt:'2026-10-15T00:00:00Z'});
  expect(completedAck.inventoryOperation).toBeNull();expect(completedAck.inventoryGenerationCompletion?.generation).toEqual(generation);expect(storage.has(key)).toBe(false);
  expect(callable.call.mock.calls[2][0].requestText).toBe(JSON.parse(first).requestText);
  for(const [path,before]of [['items/claim-item',beforeItem],['rawInventories/claim-raw',beforeRaw],['orders/'+orderId,completedOrder],['orderRequestRetirements/'+retirementId,firstTerminal]] as const)expect((await adminDb.doc(path).get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  storage.set(key,first);await expect(claimOrderInventoryOperation(orderId,OrderStatus.PENDING,{...operation,targetStatus:OrderStatus.SHIPPED})).rejects.toThrow('명세가 다릅니다');expect(storage.get(key)).toBe(first);expect(callable.call).toHaveBeenCalledTimes(3);
  storage.set(key,'{');await expect(claimOrderInventoryOperation(orderId,OrderStatus.PENDING,operation)).rejects.toThrow('명세가 다릅니다');expect(storage.get(key)).toBe('{');expect(callable.call).toHaveBeenCalledTimes(3);
  const wrongTerminal=JSON.stringify({version:1,requestText:JSON.stringify({retirementId:'b'.repeat(64)}),requestHash:'wrong'});
  storage.set(key,wrongTerminal);await expect(claimOrderInventoryOperation(orderId,OrderStatus.PENDING,operation)).rejects.toThrow('해제 영수증');expect(storage.get(key)).toBe(wrongTerminal);expect(callable.call).toHaveBeenCalledTimes(3);storage.delete(key);
  for(const [path,before]of [['items/claim-item',beforeItem],['rawInventories/claim-raw',beforeRaw],['orders/'+orderId,completedOrder],['orderRequestRetirements/'+retirementId,firstTerminal]] as const)expect((await adminDb.doc(path).get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 },30_000);
});
