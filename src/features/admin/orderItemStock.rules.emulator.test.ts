import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
import type {Order} from '../../shared/types';
import type {OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';
import {cleanupOwnedResources} from '../../test/emulatorTestPolicy';

// 실제 직원 가입 대신 신원 조회만 합성한다. Firestore 거래와 Rules 평가는 실제 SDK로 수행한다.
const ports=vi.hoisted(()=>({auth:{currentUser:null as any},tokenCalls:0,rpcCalls:0}));
vi.mock('firebase/auth',async original=>({...await original<typeof import('firebase/auth')>(),getAuth:()=>ports.auth}));
vi.mock('../../shared/firebase',()=>({auth:ports.auth,authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/functions',async original=>({...await original<typeof import('firebase/functions')>(),httpsCallable:()=>{ports.rpcCalls++;throw Error('예약 stage-only 시험에서 RPC는 허용하지 않습니다.');}}));

const enabled=process.env.HACCP_EMULATOR_TEST==='true';
const projectId='demo-order-list-20261027';
const route={host:process.env.FIRESTORE_EMULATOR_HOST,project:process.env.ORDER_LIST_EMULATOR_PROJECT,optin:process.env.HACCP_EMULATOR_TEST};
const host=/^(127\.0\.0\.1|localhost):8287$/.exec(route.host??'');
const prefix='reservation-sdk-'+randomUUID()+'-';
const actor=prefix+'employee',time='2026-10-15T00:00:00.000Z';
let env:RulesTestEnvironment|undefined,runtime:typeof import('@firebase/rules-unit-testing'),sdk:typeof import('firebase/firestore'),api:typeof import('./orderItemStock');
const paths=new Set<string>(),observations:Record<string,unknown>[]=[];let sequence=0;
function guard(){
 if(!enabled||!host||route.project!==projectId||process.env.FIRESTORE_EMULATOR_HOST!==route.host||process.env.ORDER_LIST_EMULATOR_PROJECT!==route.project||process.env.HACCP_EMULATOR_TEST!==route.optin)throw Error('root 소유 demo/8287 명시 격리 시험만 허용합니다.');
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==projectId)throw Error('외부 프로젝트 환경을 제거해 주세요.');
 if(process.env.FIREBASE_CONFIG||env&&env.projectId!==projectId)throw Error('시험 환경의 프로젝트가 다릅니다.');
}
if(enabled)guard();
function own(path:string){
 const [collection,id,...rest]=path.split('/');
 if(rest.length||!id||!(collection==='items'||collection==='orders'?id.startsWith(prefix):collection==='inventoryWriterDeletions'&&id.startsWith('taebaek__'+prefix)))throw Error('이번 실행의 소유 문서가 아닙니다.');
}
function owned(collection:'orders'|'items',suffix:string){const path=collection+'/'+prefix+suffix;own(path);paths.add(path);return path;}
async function put(path:string,value:Record<string,unknown>){guard();own(path);paths.add(path);await env!.withSecurityRulesDisabled(async ctx=>{guard();await sdk.setDoc(sdk.doc(ctx.firestore(),path),value);guard();});}
async function readAll(selected:readonly string[]){guard();const result:Record<string,any>={};await env!.withSecurityRulesDisabled(async ctx=>{for(const path of selected){guard();own(path);result[path]=(await sdk.getDoc(sdk.doc(ctx.firestore(),path))).data()??null;}guard();});expect(Object.keys(result)).toHaveLength(selected.length);return result;}

async function fixture(count:number,options:{emptyArrays?:boolean;companyAt?:number;stock?:number}={}){
 guard();const tag=String(++sequence),orderPath=owned('orders',tag+'-order'),orderId=orderPath.split('/')[1];
 const itemPaths=Array.from({length:count},(_,index)=>owned('items',tag+'-'+index)),ids=itemPaths.map(path=>path.split('/')[1]);
 const generation:OrderInventoryGeneration={contractVersion:1,companyId:'taebaek',orderId,operationId:prefix+tag+'-operation',startedAt:time,actorUid:actor};
 const order={id:orderId,companyId:'taebaek',status:'PENDING',createdAt:time,deliveryDate:time,items:ids.map(itemId=>({itemId,quantity:1})),inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,orderListProjection:{version:1,candidateDay:'9999-12-31'},inventoryOperation:{id:generation.operationId,contractVersion:1,actorUid:actor,startedAt:time,state:'processing',kind:'line',lineId:prefix+tag+'-line',targetStatus:'DISPATCHED',actor:'합성 직원',stage:'claim'}};
 await put(orderPath,order);
 const items=ids.map((id,index)=>({id,companyId:options.companyAt===index?'punghoe':'taebaek',name:'합성 품목 '+index,stock:options.stock??10,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,...(options.emptyArrays?{inventoryReservations:[]}:{} )}));
 for(let index=0;index<items.length;index++){const {id,...data}=items[index];await put(itemPaths[index],data);}
 ports.auth.currentUser={uid:actor,getIdTokenResult:async()=>{ports.tokenCalls++;return {claims:{companyId:'taebaek'}};}};
 const db=env!.authenticatedContext(actor,{employeeId:actor,companyId:'taebaek',isAdmin:false}).firestore();
 let currentActor=actor;
 const operations=api.createOrderItemStockOperations({db:db as unknown as import('firebase/firestore').Firestore,allItems:items as any,bomIndex:{of:()=>[]} as any,getActorUid:()=>currentActor});
 return {order:order as unknown as Order,orderPath,itemPaths,ids,generation,operations,selected:[orderPath,...itemPaths],setActor:(value:string)=>{currentActor=value;}};
}
async function reserve(f:Awaited<ReturnType<typeof fixture>>,used:number,qty=1){
 const plan=vi.fn(()=>new Map(f.ids.slice(0,used).map(id=>[id,-qty]))),tokens=ports.tokenCalls;
 // spy는 실제 Transaction.update에 그대로 위임하며 읽기 개수와 쓰기 개수를 따로 관측한다.
 const updates=vi.spyOn(sdk.Transaction.prototype,'update'),writeStart=updates.mock.calls.length;
 const promise=f.operations.reserveOrderStock(f.order,f.generation.operationId,plan,[],{generation:f.generation});
 return {plan,tokens,promise,updates,writeStart};
}
const writePaths=(run:Awaited<ReturnType<typeof reserve>>)=>run.updates.mock.calls.slice(run.writeStart).map(([ref])=>ref.path).sort();
function assertSuccess(f:Awaited<ReturnType<typeof fixture>>,before:Record<string,any>,after:Record<string,any>,used:number){
 expect(after[f.orderPath]).toEqual({...before[f.orderPath],inventoryWriteRevision:2,inventoryOperation:{...before[f.orderPath].inventoryOperation,stage:'reservation'}});
 f.itemPaths.forEach((path,index)=>{
  if(index>=used){expect(after[path]).toEqual(before[path]);return;}
  const row=after[path].inventoryReservations[0];
  expect(row).toEqual({operationId:f.generation.operationId,orderId:f.order.id,qty:1,createdAt:expect.any(String),state:'processing',generation:f.generation});
  expect(Number.isFinite(Date.parse(row.createdAt))).toBe(true);
  expect(after[path]).toEqual({...before[path],inventoryWriteRevision:2,inventoryReservations:[row]});
 });
}

describe.skipIf(!enabled)('실제 주문 예약 거래의 Rules 한도 진단 (root 소유 SDK)',()=>{
 beforeAll(async()=>{guard();runtime=await import('@firebase/rules-unit-testing');guard();sdk=await import('firebase/firestore');guard();api=await import('./orderItemStock');guard();try{env=await runtime.initializeTestEnvironment({projectId,firestore:{host:host![1],port:8287,rules:readFileSync('firestore.rules','utf8')}});guard();}catch(error){await cleanupOwnedResources([()=>env?.cleanup()],error);throw error;}});
 afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env){guard();await env.withSecurityRulesDisabled(async ctx=>{for(const path of paths){guard();own(path);await sdk.deleteDoc(sdk.doc(ctx.firestore(),path));expect((await sdk.getDoc(sdk.doc(ctx.firestore(),path))).exists()).toBe(false);guard();}});}},()=>env?.cleanup()]);if(enabled&&process.env.ORDER_RESERVATION_OBSERVATIONS_PATH){const root=resolve('privatework/order-reservation-noop'),output=resolve(process.env.ORDER_RESERVATION_OBSERVATIONS_PATH);if(dirname(output)!==root||!/^observations-[a-f0-9-]+[.]json$/.test(basename(output)))throw Error('지정 private 관측 경로만 허용합니다.');mkdirSync(root,{recursive:true});if(realpathSync(root)!==root)throw Error('관측 경로의 junction은 허용하지 않습니다.');writeFileSync(output,JSON.stringify({observations,ownedPaths:paths.size,cleanupConfirmed:true,auth:'합성 getAuth 조회와 실제 Rules unit claims',realFirestoreSDK:true,realReservationAPI:true,operatingWrites:0,rpcCalls:ports.rpcCalls},null,2),{flag:'wx'});}});
 it.each([1,19,20,21])('실제 %i개 예약과 주문 stage의 원자 허용·거절 경계를 관측한다',async count=>{
  const f=await fixture(count),before=await readAll(f.selected),r=await reserve(f,count);
  if(count<=20){await r.promise;assertSuccess(f,before,await readAll(f.selected),count);}else{await expect(r.promise).rejects.toMatchObject({code:'permission-denied'});expect(await readAll(f.selected)).toEqual(before);}
  expect(r.plan).toHaveBeenCalledTimes(1);expect(ports.tokenCalls).toBeGreaterThan(r.tokens);expect(ports.rpcCalls).toBe(0);
  expect(writePaths(r)).toEqual([...f.itemPaths,f.orderPath].sort());if(count>20)expect(ports.tokenCalls-r.tokens).toBeGreaterThan(1);
  observations.push({case:'필수 예약',readItems:count,reservedItems:count,observedItemUpdateCalls:writePaths(r).length-1,orderStageWrite:true,result:count<=20?'allowed':'permission-denied',planAttempts:r.plan.mock.calls.length});
 });
 it('25개를 읽어도 배열 없는 무소모24개는 쓰지 않아 한 품목 예약이 성공한다',async()=>{
  const f=await fixture(25),before=await readAll(f.selected),r=await reserve(f,1);await r.promise;
  assertSuccess(f,before,await readAll(f.selected),1);expect(r.plan).toHaveBeenCalledTimes(1);expect(ports.rpcCalls).toBe(0);
  expect(writePaths(r)).toEqual([f.itemPaths[0],f.orderPath].sort());
  observations.push({case:'배열 없는 무소모',readItems:25,reservedItems:1,observedItemUpdateCalls:writePaths(r).length-1,orderStageWrite:true,result:'allowed'});
 });
 it('같은 무소모24개에 빈 배열이 있어도 한 품목만 갱신하고 예약을 완료한다',async()=>{
  const f=await fixture(25,{emptyArrays:true}),before=await readAll(f.selected),r=await reserve(f,1);await r.promise;
  assertSuccess(f,before,await readAll(f.selected),1);expect(r.plan).toHaveBeenCalledTimes(1);expect(ports.rpcCalls).toBe(0);
  expect(writePaths(r)).toEqual([f.itemPaths[0],f.orderPath].sort());expect(ports.tokenCalls).toBeGreaterThan(r.tokens);
  observations.push({case:'기존 빈 배열 무소모',readItems:25,reservedItems:1,observedItemUpdateCalls:writePaths(r).length-1,orderStageWrite:true,result:'allowed',planAttempts:r.plan.mock.calls.length});
 });
 it('한도를 줄이려고 회사·UID·부족·퇴역 검사를 우회하지 않는다',async()=>{
  const foreign=await fixture(1,{companyAt:0}),foreignBefore=await readAll(foreign.selected);await expect((await reserve(foreign,1)).promise).rejects.toMatchObject({code:'permission-denied'});expect(await readAll(foreign.selected)).toEqual(foreignBefore);
  const changed=await fixture(1),changedBefore=await readAll(changed.selected);changed.setActor('다른 UID');await expect((await reserve(changed,1)).promise).rejects.toThrow('로그인 계정');expect(await readAll(changed.selected)).toEqual(changedBefore);
  const scarce=await fixture(1,{stock:0}),scarceBefore=await readAll(scarce.selected);await expect((await reserve(scarce,1)).promise).rejects.toThrow('재고가 부족');expect(await readAll(scarce.selected)).toEqual(scarceBefore);
  const retired=await fixture(1),tomb='inventoryWriterDeletions/taebaek__'+retired.ids[0];await put(tomb,{companyId:'taebaek',itemId:retired.ids[0],inventoryWriterProtocolVersion:1,lastDeletedItemRevision:1,beforeRevision:1,deletionRevision:1,mergedIntoItemId:prefix+'merged'});const retiredBefore=await readAll([...retired.selected,tomb]),r=await reserve(retired,1);await expect(r.promise).rejects.toMatchObject({code:'permission-denied'});expect(await readAll([...retired.selected,tomb])).toEqual(retiredBefore);expect(r.plan).toHaveBeenCalledTimes(1);
 });
});
