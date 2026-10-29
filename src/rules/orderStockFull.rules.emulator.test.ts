import {randomUUID, createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,Timestamp,deleteField} from 'firebase/firestore';
import {advanceInventoryWriterProtocol} from '../../functions/src/shared/inventoryWriterProtocol';

const enabled=process.env.ORDER_FULL_AUTHORITY_RULES==='true',projectId='demo-order-stock-admin-guards-20261029',prefix='full-authority-'+randomUUID()+'-';
const owned=new Set<string>(),observations:unknown[]=[];let env:RulesTestEnvironment;
function guard(){if(!enabled||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8288'||process.env.ORDER_FULL_AUTHORITY_PROJECT!==projectId||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_CONFIG)throw Error('명시된 독립 데모만 허용');for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==projectId)throw Error('외부 프로젝트 금지');if(env&&env.projectId!==projectId)throw Error('프로젝트 불일치');}
function path(collectionName:string,label:string){guard();if(!['items','orders','orderStockFullAttemptsV1','inventoryWriterDeletions','orderStatusAudits','rawMaterialLedger','rawInventoryReversalGuards','productionRecords'].includes(collectionName))throw Error('범위 밖');const p=collectionName+'/'+(collectionName==='inventoryWriterDeletions'?'taebaek__':'')+prefix+label;owned.add(p);return p;}
const context=(company='taebaek',admin=false)=>{guard();return env.authenticatedContext(prefix+'user',{employeeId:prefix+'employee',companyId:company,isAdmin:admin}).firestore();};
async function seed(p:string,data:Record<string,unknown>){guard();if(!owned.has(p))throw Error('비소유');await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),p),data));}
const row={operationId:'full-op',orderId:'full-order',reservationAttemptId:'nonce',qty:3,createdAt:'2026-10-29T00:00:00Z',state:'processing',serverProtocol:'full-v1',unknown:'원문',native:new Timestamp(100,1000)};
const item=(extra:Record<string,unknown>={})=>({companyId:'taebaek',stock:10,lots:[],inventoryReservations:[row],fullReservationRows:[row],inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,...extra});
const patch=(value:Record<string,unknown>,before:Record<string,unknown>=item())=>advanceInventoryWriterProtocol(before,value);
describe.skipIf(!enabled)('full 예약 보호 실제 Web SDK Rules',()=>{
 it.each(['rawMaterialLedger','rawInventoryReversalGuards','productionRecords'])('PBE-RULES01 %s 원효과표식존재문서는관리자도변경/삭제/위조생성0·legacy정상갱신',async collectionName=>{const authority={version:1,protocol:'full-v1',companyId:'taebaek',orderId:prefix+'order',ownerUid:prefix+'user',attemptId:'a'.repeat(64)},base={companyId:'taebaek',id:prefix+'effect',quantity:3,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1},marked={...base,fullEffectAuthority:authority},p=path(collectionName,'effect-'+collectionName);await seed(p,marked);for(const admin of [false,true]){const db=context('taebaek',admin),ref=doc(db,p);await assertFails(updateDoc(ref,advanceInventoryWriterProtocol(marked,{quantity:4})));await assertFails(updateDoc(ref,advanceInventoryWriterProtocol(marked,{fullEffectAuthority:deleteField()})));await assertFails(deleteDoc(ref));for(const value of [authority,null,'invalid']){const fresh=path(collectionName,'forged-'+collectionName+'-'+admin+'-'+String(value));await assertFails(setDoc(doc(db,fresh),{...base,fullEffectAuthority:value}));}expect((await getDoc(ref)).data()).toEqual(marked);}const legacy=path(collectionName,'legacy-'+collectionName);await seed(legacy,base);await assertSucceeds(updateDoc(doc(context(),legacy),advanceInventoryWriterProtocol(base,{quantity:4})));expect((await getDoc(doc(context(),legacy))).get('quantity')).toBe(4);const fresh=path(collectionName,'normal-create-'+collectionName);await assertSucceeds(setDoc(doc(context(),fresh),base));if(collectionName==='productionRecords')await assertSucceeds(deleteDoc(doc(context(),fresh)));observations.push({collectionName,flaggedWritesDenied:true,legacyUpdateAllowed:true});});
 beforeAll(async()=>{guard();env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8288,rules:readFileSync('firestore.rules','utf8')}});guard();});
 afterAll(async()=>{let cleaned=false;try{if(env){await env.withSecurityRulesDisabled(async ctx=>{for(const p of owned){guard();await deleteDoc(doc(ctx.firestore(),p));expect((await getDoc(doc(ctx.firestore(),p))).exists()).toBe(false);}});cleaned=true;}}finally{if(env)await env.cleanup();writeFileSync('work/performance-orders-full-authority-rules-'+randomUUID()+'.json',JSON.stringify({projectId,prefix,rulesSha256:createHash('sha256').update(readFileSync('firestore.rules')).digest('hex'),ownedPaths:[...owned],cleanupConfirmed:cleaned,observations,transport:'Web SDK + synthetic claims; disabled Rules synthetic seed',globalClear:false,operatingAccess:0},null,2),{flag:'wx'});}});
 it('보호행 값 변형·삭제·중복과 서버 목록 변조를 거절한다',async()=>{
  const p=path('items','protected');await seed(p,item());const ref=doc(context(),p);
  for(const changed of [{...row,qty:4},{...row,reservationAttemptId:'other'},{...row,state:'allocated'},{...row,createdAt:'2026-10-28T00:00:00Z'},{...row,unknown:'변경'},{...row,native:new Timestamp(100,2000)}])await assertFails(updateDoc(ref,patch({inventoryReservations:[changed]})));
  for(const rows of [[],[row,row]])await assertFails(updateDoc(ref,patch({inventoryReservations:rows})));
  await assertFails(updateDoc(ref,{fullReservationRows:deleteField()}));await assertFails(updateDoc(ref,{fullReservationRows:[]}));
  expect((await getDoc(ref)).data()).toEqual(item());await assertFails(getDoc(doc(context('punghoe'),p)));await assertFails(updateDoc(doc(context('punghoe'),p),{note:'타회사'}));observations.push('exact protected mutations denied and company boundary retained');
 });
 it('같은 예약값 재쓰기는 기존 revision을 유지한다',async()=>{const p=path('items','same-reservations');await seed(p,item());const ref=doc(context(),p);await assertSucceeds(updateDoc(ref,{inventoryReservations:[row]}));expect((await getDoc(ref)).get('inventoryWriteRevision')).toBe(1);});
 it('map 순서 변경·타주문 예약과 해제·실사는 보호행 보존시 허용한다',async()=>{
  const p=path('items','normal'),base=item();await seed(p,base);const ref=doc(context(),p);
  const reordered={native:row.native,unknown:row.unknown,serverProtocol:row.serverProtocol,state:row.state,createdAt:row.createdAt,qty:row.qty,reservationAttemptId:row.reservationAttemptId,orderId:row.orderId,operationId:row.operationId};
  const other={operationId:'other',orderId:'other',qty:1,createdAt:row.createdAt,state:'processing'};
  await assertSucceeds(updateDoc(ref,patch({inventoryReservations:[reordered,other]})));
  let before=(await getDoc(ref)).data()!;await assertSucceeds(updateDoc(ref,patch({inventoryReservations:[row]},before)));
  before=(await getDoc(ref)).data()!;await assertSucceeds(updateDoc(ref,patch({stock:4,lots:[{id:'counted',qtyRemaining:4}]},before)));
  expect((await getDoc(ref)).get('stock')).toBe(4);observations.push('other order reserve/release and stocktake allowed');
 });
 it('비보호 중복과 유사 추가행은 기존 정책이며 보호목록 빈 문서도 목록은 변경하지 못한다',async()=>{
  const p=path('items','nonfull'),other={operationId:'other',orderId:'other',qty:1};await seed(p,item());const ref=doc(context(),p);
  await assertSucceeds(updateDoc(ref,patch({inventoryReservations:[row,other,other,{...row,unknown:'유사'}]})));
  const empty=path('items','empty');await seed(empty,item({inventoryReservations:[],fullReservationRows:[]}));await assertFails(updateDoc(doc(context(),empty),{fullReservationRows:deleteField()}));
  const legacy=path('items','legacy');await seed(legacy,{companyId:'taebaek',stock:10,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});await assertSucceeds(updateDoc(doc(context(),legacy),patch({inventoryReservations:[other,other]})));
 });
 it('웹 품목 생성 위조·보호 품목 삭제를 막고 보호없는 정상 삭제는 허용한다',async()=>{
  const bad=path('items','create-bad');await assertFails(setDoc(doc(context(),bad),item({inventoryWriteRevision:1})));
  const good=path('items','create-good');await assertSucceeds(setDoc(doc(context(),good),{companyId:'taebaek',stock:1,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));
  for(const [label,protectedRow] of [['delete-protected',true],['delete-ordinary',false]] as const){const p=path('items',label),t=path('inventoryWriterDeletions',label);await seed(p,protectedRow?item():item({inventoryReservations:[],fullReservationRows:[]}));const db=context(),batch=writeBatch(db);batch.delete(doc(db,p));batch.set(doc(db,t),{companyId:'taebaek',itemId:p.split('/')[1],inventoryWriterProtocolVersion:1,beforeRevision:1,lastDeletedItemRevision:1,deletionRevision:1});if(protectedRow)await assertFails(batch.commit());else await assertSucceeds(batch.commit());}
 });
 it('주문 표식의 생성·변경·삭제와 민감변경을 막되 비고를 허용한다',async()=>{
  const create=path('orders','create'),db=context();await assertFails(setDoc(doc(db,create),{companyId:'taebaek',inventoryExecutionProtocol:'full-v1',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,orderListProjection:{version:1,candidateDay:'9999-12-31'}}));
  const p=path('orders','marked');await seed(p,{companyId:'taebaek',status:'PENDING',inventoryExecutionProtocol:'full-v1',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});const ref=doc(db,p);
  for(const change of [{inventoryExecutionProtocol:deleteField()},{inventoryExecutionProtocol:'other'},{status:'DISPATCHED',inventoryWriteRevision:2},{producedUnits:[],inventoryWriteRevision:2},{rawLotsDeducted:true,inventoryWriteRevision:2},{autoBuilt:[],inventoryWriteRevision:2}])await assertFails(updateDoc(ref,change));
  await assertSucceeds(updateDoc(ref,{note:'현재 비고'}));await assertFails(deleteDoc(ref));
  const unmarked=path('orders','unmarked');await seed(unmarked,{companyId:'taebaek',status:'PENDING',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});await assertFails(updateDoc(doc(db,unmarked),{inventoryExecutionProtocol:'full-v1'}));
 });
 it('정상 삭제 audit가 있어도 서버표식 주문은 삭제할 수 없다',async()=>{
  for(const marked of [true,false]){const label=marked?'marked-delete':'ordinary-delete',order=path('orders',label),audit=path('orderStatusAudits',label),id=audit.split('/')[1];await seed(order,{companyId:'taebaek',status:'PENDING',inventoryOperation:{id},inventoryWriterProtocolVersion:1,inventoryWriteRevision:1,...(marked?{inventoryExecutionProtocol:'full-v1'}:{})});const db=context(),batch=writeBatch(db);batch.delete(doc(db,order));batch.set(doc(db,audit),{id,companyId:'taebaek',orderId:order.split('/')[1],state:'completed',beforeOrderWriteRevision:1,cancellation:{action:'delete',deleted:true},inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});if(marked)await assertFails(batch.commit());else await assertSucceeds(batch.commit());}
 });
 it('저장되는 1마이크로초 차이는 거절하고 저장시 절삭된 ns는 별도로 관찰한다',async()=>{
  const p=path('items','timestamp'),native=new Timestamp(100,123),value={...row,native};await seed(p,item({inventoryReservations:[value],fullReservationRows:[value]}));const ref=doc(context(),p),before=(await getDoc(ref)).data()!,stored=before.fullReservationRows[0].native as Timestamp;
  expect(stored.nanoseconds).toBe(0);await assertFails(updateDoc(ref,patch({inventoryReservations:[{...value,native:new Timestamp(100,1000)}]},before)));await assertSucceeds(updateDoc(ref,patch({stock:9,inventoryReservations:[{...value,native:stored}]},before)));const other=path('items','timestamp-124');await seed(other,item({inventoryReservations:[{...row,native:new Timestamp(100,124)}],fullReservationRows:[{...row,native:new Timestamp(100,124)}]}));const otherRef=doc(context(),other),otherBefore=(await getDoc(otherRef)).data()!,storedOther=otherBefore.fullReservationRows[0].native as Timestamp;expect(storedOther.nanoseconds).toBe(0);let raw124Result='allowed';try{await updateDoc(otherRef,patch({stock:9,inventoryReservations:[{...row,native:new Timestamp(100,124)}]},otherBefore));}catch{raw124Result='denied';}observations.push({kind:'timestamp',storedNanos:[stored.nanoseconds,storedOther.nanoseconds],microsecondChangeDenied:true,sameStoredValueAllowed:true,submicrosecondTruncated:true,raw124WithStockChange:raw124Result});
 });
 it('비공개 full attempt는 직원과 관리자에게 모든 접근을 거절한다',async()=>{
  const p=path('orderStockFullAttemptsV1','private');await seed(p,{companyId:'taebaek',secret:'합성'});
  for(const admin of [false,true]){const db=context('taebaek',admin),ref=doc(db,p);await assertFails(getDoc(ref));await assertFails(getDocs(collection(db,'orderStockFullAttemptsV1')));await assertFails(setDoc(ref,{companyId:'taebaek'}));await assertFails(updateDoc(ref,{secret:'변경'}));await assertFails(deleteDoc(ref));}
 });
 it.each([null,'unknown',''] as const)('표식 키 %s는 민감수정·정상 audit 삭제를 차단하고 비고는 허용한다',async marker=>{
  const label='marker-'+String(marker),order=path('orders',label),audit=path('orderStatusAudits',label),id=audit.split('/')[1];await seed(order,{companyId:'taebaek',status:'PENDING',inventoryOperation:{id},inventoryExecutionProtocol:marker,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});const db=context(),ref=doc(db,order);await assertFails(updateDoc(ref,{items:[{itemId:'x'}],inventoryWriteRevision:2}));await assertSucceeds(updateDoc(ref,{note:'비고'}));const batch=writeBatch(db);batch.delete(ref);batch.set(doc(db,audit),{id,companyId:'taebaek',orderId:order.split('/')[1],state:'completed',beforeOrderWriteRevision:1,cancellation:{action:'delete',deleted:true},inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});await assertFails(batch.commit());
 });
});
