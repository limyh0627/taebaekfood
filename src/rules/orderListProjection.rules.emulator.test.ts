import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {cleanupOwnedResources} from '../test/emulatorTestPolicy';
import {deriveOrderListProjection} from '../shared/orderListProjection';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
const enabled=process.env.HACCP_EMULATOR_TEST==='true';
const projectId='demo-order-list-20261027';
const hostMatch=/^(127\.0\.0\.1|localhost):8287$/.exec(process.env.FIRESTORE_EMULATOR_HOST??'');
const snapshot={host:process.env.FIRESTORE_EMULATOR_HOST,project:process.env.ORDER_LIST_EMULATOR_PROJECT,optin:process.env.HACCP_EMULATOR_TEST};
function guard(){
 if(!enabled||!hostMatch||snapshot.project!==projectId||process.env.FIRESTORE_EMULATOR_HOST!==snapshot.host||process.env.ORDER_LIST_EMULATOR_PROJECT!==snapshot.project||process.env.HACCP_EMULATOR_TEST!==snapshot.optin)throw Error('root 소유 8287/demo-order-list-20261027 명시 격리 시험만 허용합니다.');
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==projectId)throw Error('외부 프로젝트 환경은 사용할 수 없습니다.');
 if(process.env.FIREBASE_CONFIG)throw Error('별도 Firebase 설정을 사용하지 않습니다.');
 if(env&&env.projectId!==projectId)throw Error('시험 환경의 프로젝트가 다릅니다.');
}
const prefix='order-list-'+randomUUID()+'-';let sequence=0;
let env:RulesTestEnvironment|undefined,runtime:typeof import('@firebase/rules-unit-testing'),sdk:typeof import('firebase/firestore');
if(enabled)guard();
const paths=new Set<string>();
const own=(path:string)=>{if(!path.startsWith('orders/'+prefix)||path.split('/').length!==2)throw Error('이번 실행 소유 문서가 아닙니다.');};
function path(){const value='orders/'+prefix+(++sequence);own(value);paths.add(value);return value;}
const time='2026-10-15T00:00:00.000Z';const base={companyId:'taebaek',status:'DELIVERED',deliveredAt:time,deliveryDate:time,createdAt:time,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1};
const context=(companyId='taebaek')=>{guard();return env!.authenticatedContext(prefix+'employee',{companyId,employeeId:prefix+'e',isAdmin:false}).firestore();};
async function seed(value:Record<string,unknown>){guard();const id=path();await env!.withSecurityRulesDisabled(async ctx=>{guard();await sdk.setDoc(sdk.doc(ctx.firestore(),id),value);guard();});guard();return id;}
describe.skipIf(!enabled)('주문 projection 실제 Rules/query SDK (root 소유 전용 opt-in)',()=>{
 beforeAll(async()=>{guard();runtime=await import('@firebase/rules-unit-testing');guard();sdk=await import('firebase/firestore');guard();try{env=await runtime.initializeTestEnvironment({projectId,firestore:{host:hostMatch![1],port:8287,rules:readFileSync('firestore.rules','utf8')}});guard();}catch(error){await cleanupOwnedResources([()=>env?.cleanup()],error);throw error;}});
 afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env){guard();await env.withSecurityRulesDisabled(async ctx=>{for(const id of paths){guard();own(id);await sdk.deleteDoc(sdk.doc(ctx.firestore(),id));guard();expect((await sdk.getDoc(sdk.doc(ctx.firestore(),id))).exists()).toBe(false);guard();}});}},()=>env?.cleanup()]);});
 it('상태/원날짜 없는 sentinel 생성은 허용하고 projection 누락 생성은 거절한다',async()=>{
  const db=context(),minimal={companyId:'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1};guard();await runtime.assertSucceeds(sdk.setDoc(sdk.doc(db,path()),{...minimal,orderListProjection:deriveOrderListProjection(minimal)}));guard();await runtime.assertFails(sdk.setDoc(sdk.doc(db,path()),minimal));guard();
 });
 it('legacy 무관 patch는 유지하고 dependency 변경에는 올바른 projection이 필요하다',async()=>{
  const id=await seed(base),db=context(),ref=sdk.doc(db,id);await runtime.assertSucceeds(sdk.updateDoc(ref,{note:'무관'}));guard();await runtime.assertFails(sdk.updateDoc(ref,{deliveredAt:'2026-10-16T00:00:00.000Z',inventoryWriteRevision:2}));guard();
  await runtime.assertSucceeds(sdk.updateDoc(ref,{deliveredAt:'2026-10-16T00:00:00.000Z',inventoryWriteRevision:2,orderListProjection:deriveOrderListProjection({...base,deliveredAt:'2026-10-16T00:00:00.000Z'})}));guard();
 });
 it('projection 삭제/위조/추가키/잘못된 버전과 타회사 쓰기를 거절한다',async()=>{
  const id=await seed({...base,orderListProjection:deriveOrderListProjection(base)}),db=context(),ref=sdk.doc(db,id);
  for(const value of [sdk.deleteField(),{version:2,candidateDay:'2026-10-15'},{version:1,candidateDay:'1900-01-01'},{version:1,candidateDay:'2026-10-15',extra:true},{version:'1',candidateDay:'2026-10-15'}]){guard();await runtime.assertFails(sdk.updateDoc(ref,{orderListProjection:value}));guard();}
  await runtime.assertSucceeds(sdk.updateDoc(ref,{note:'보존'}));guard();await runtime.assertFails(sdk.updateDoc(sdk.doc(context('punghoe'),id),{note:'다른회사'}));guard();
 });
 it('말일/잘못된날짜/newline은 TS sentinel과 Rules가 같고 canonical은 UTC일만 허용한다',async()=>{
  const db=context();for(const value of [time,'2026-01-29T00:00:00.000Z','2024-02-29T00:00:00.000Z','2026-02-30T00:00:00.000Z',time+'\n','2026-01-01T24:00:00.000Z']){const row={...base,deliveredAt:value};guard();await runtime.assertSucceeds(sdk.setDoc(sdk.doc(db,path()),{...row,orderListProjection:deriveOrderListProjection(row)}));guard();const correct=deriveOrderListProjection(row);await runtime.assertFails(sdk.setDoc(sdk.doc(db,path()),{...row,orderListProjection:{version:1,candidateDay:correct.candidateDay==='9999-12-31'?'2026-10-15':'9999-12-31'}}));guard();}
 });
 it('원날짜 없는 sentinel은 range 후보에 포함되지만 projection 없는 통제는 빠진다',async()=>{
  const missing={companyId:'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1};const included=await seed({...missing,orderListProjection:deriveOrderListProjection(missing)}),excluded=await seed(missing);guard();const result=await sdk.getDocs(sdk.query(sdk.collection(context(),'orders'),sdk.where('companyId','==','taebaek'),sdk.where('orderListProjection.candidateDay','>=','2026-10-13')));guard();const ids=result.docs.map(doc=>doc.ref.path);expect(ids).toContain(included);expect(ids).not.toContain(excluded);
 });
 it('조회 메타가 있는 주문의 구형 무관 patch는 메타와 기존 버전을 보존한다',async()=>{
  const original={...base,orderListProjection:deriveOrderListProjection(base)},id=await seed(original),ref=sdk.doc(context(),id);
  guard();await runtime.assertSucceeds(sdk.updateDoc(ref,{note:'구형 앱의 비고 수정'}));guard();
  expect((await sdk.getDoc(ref)).data()).toEqual({...original,note:'구형 앱의 비고 수정'});guard();
 });
 it('기대 조회일이 달라지는 구형 상태·완료일 patch는 거절하고 전체 원문을 보존한다',async()=>{
  const original={...base,orderListProjection:deriveOrderListProjection(base)},id=await seed(original),ref=sdk.doc(context(),id);
  for(const patch of [{status:'PROCESSING',inventoryWriteRevision:2},{deliveredAt:'2026-10-16T00:00:00.000Z',inventoryWriteRevision:2}]){
   guard();await runtime.assertFails(sdk.updateDoc(ref,patch));guard();expect((await sdk.getDoc(ref)).data()).toEqual(original);guard();
  }
 });
 it('상태·날짜가 바뀌어도 최종 조회 값이 정답인 구형 요청은 허용한다',async()=>{
  const complete={...base,orderListProjection:deriveOrderListProjection(base)},completeId=await seed(complete),completeRef=sdk.doc(context(),completeId);
  const datePatch={deliveryDate:'2026-10-16T00:00:00.000Z'};
  expect(deriveOrderListProjection({...complete,...datePatch})).toEqual(complete.orderListProjection);
  guard();await runtime.assertSucceeds(sdk.updateDoc(completeRef,datePatch));guard();expect((await sdk.getDoc(completeRef)).data()).toEqual({...complete,...datePatch});guard();
  const pending={...base,status:'PENDING',orderListProjection:deriveOrderListProjection({...base,status:'PENDING'})},pendingId=await seed(pending),pendingRef=sdk.doc(context(),pendingId);
  const statusPatch={status:'PROCESSING',inventoryWriteRevision:2};
  expect(deriveOrderListProjection({...pending,...statusPatch})).toEqual(pending.orderListProjection);
  guard();await runtime.assertSucceeds(sdk.updateDoc(pendingRef,statusPatch));guard();expect((await sdk.getDoc(pendingRef)).data()).toEqual({...pending,...statusPatch});guard();
 });
 it('구형 전체 생성·replace에서 조회 메타 누락은 거절하고 기존 주문을 보존한다',async()=>{
  const db=context(),created=path();guard();await runtime.assertFails(sdk.setDoc(sdk.doc(db,created),base));guard();expect((await sdk.getDoc(sdk.doc(db,created))).exists()).toBe(false);guard();
  const original={...base,orderListProjection:deriveOrderListProjection(base)},id=await seed(original),ref=sdk.doc(db,id);
  guard();await runtime.assertFails(sdk.setDoc(ref,base));guard();expect((await sdk.getDoc(ref)).data()).toEqual(original);guard();
 });
 it('새 writer의 상태·완료일 postimage 조회 메타 patch는 원문과 함께 저장한다',async()=>{
  for(const change of [{status:'PROCESSING'},{deliveredAt:'2026-10-16T00:00:00.000Z'}]){
   const original={...base,orderListProjection:deriveOrderListProjection(base)},id=await seed(original),ref=sdk.doc(context(),id),next={...original,...change,inventoryWriteRevision:2};
   const patch={...change,inventoryWriteRevision:2,orderListProjection:deriveOrderListProjection(next)};
   guard();await runtime.assertSucceeds(sdk.updateDoc(ref,patch));guard();expect((await sdk.getDoc(ref)).data()).toEqual({...original,...patch});guard();
  }
 });
 it('올바른 postimage 조회 메타도 원래 writer 버전·회사 권한을 우회하지 못한다',async()=>{
  const original={...base,orderListProjection:deriveOrderListProjection(base)},id=await seed(original),ref=sdk.doc(context(),id),change={deliveredAt:'2026-10-16T00:00:00.000Z'};
  const projection=deriveOrderListProjection({...original,...change});
  guard();await runtime.assertFails(sdk.updateDoc(ref,{...change,orderListProjection:projection}));guard();expect((await sdk.getDoc(ref)).data()).toEqual(original);guard();
  const correctPatch={...change,orderListProjection:projection,inventoryWriteRevision:2};
  guard();await runtime.assertFails(sdk.updateDoc(sdk.doc(context('punghoe'),id),correctPatch));guard();expect((await sdk.getDoc(ref)).data()).toEqual(original);guard();
  await runtime.assertSucceeds(sdk.updateDoc(ref,correctPatch));guard();expect((await sdk.getDoc(ref)).data()).toEqual({...original,...correctPatch});guard();
 });
});
