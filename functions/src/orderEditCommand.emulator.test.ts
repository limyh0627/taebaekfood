import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import * as admin from 'firebase-admin';
import {executeOrderEditCommand,orderEditReceiptId} from './orderEditCommand';
import {orderEditExpected,ORDER_EDIT_OPERATIONS,serializeOrderEditRequest,type OrderEditRequest,type OrderEditReference} from './shared/orderEditCommand';
const active=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8182';
const actor={uid:'edit-actor',token:{employeeId:'edit-employee',companyId:'taebaek',isAdmin:false}};
let app:admin.app.App,db:admin.firestore.Firestore;
const owned=new Set<string>();
const ref=(path:string)=>{owned.add(path);return db.doc(path);};
const reference=(r:OrderEditReference):OrderEditReference=>({companyId:r.companyId,planId:r.planId,targetId:r.targetId});
const receipt=(r:OrderEditReference)=>ref(ORDER_EDIT_OPERATIONS+'/'+orderEditReceiptId(r.companyId,actor.uid,r.planId));
const audit=(r:OrderEditReference)=>ref('orderItemEdits/order-edit-'+orderEditReceiptId(r.companyId,actor.uid,r.planId));
const apply=(request:OrderEditRequest,who=actor)=>executeOrderEditCommand(db,who,{mode:'apply',request});
async function fixture(patch:Record<string,unknown>={}){
 const id='edit-'+randomUUID(),itemId=id+'-item';
 const item={itemId,lineId:'line',name:'합성 품목',quantity:1,price:100,checked:false};
 const order={companyId:'taebaek',status:'PENDING',items:[item],deliveryDate:'2026-10-19T03:00:00Z',note:'원문',noteImportant:false,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4,...patch};
 const target=ref('orders/'+id);await target.set(order);await ref('items/'+itemId).set({companyId:'taebaek',name:'합성품목'});
 const request:OrderEditRequest={version:1,companyId:'taebaek',targetId:id,planId:'plan-'+randomUUID(),expected:orderEditExpected(order,{special:value=>value instanceof admin.firestore.Timestamp?['timestamp',value.seconds,value.nanoseconds]:undefined}),edit:{kind:'items',items:[{...item,quantity:2}]},confirmedAddedToDispatched:false};receipt(request);audit(request);
 return {id,item,itemId,order,target,request};
}
describe.skipIf(!active)('주문 수정 원자 명령 실제 SDK',()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-order-edit-'+randomUUID().slice(0,8)},'order-edit-'+randomUUID());db=admin.firestore(app);await ref('employees/'+actor.token.employeeId).set({companyId:'taebaek',name:'실제 담당자'});});
 afterAll(async()=>{if(!db)return;const paths=[...owned];for(let i=0;i<paths.length;i+=400){const batch=db.batch();for(const path of paths.slice(i,i+400))batch.delete(db.doc(path));await batch.commit();}await app.delete();},60000);
 it('주문 patch와 결정적 감사·receipt는 같이 저장되고 응답유실 조회·재시도는 어떤 원문도 다시 쓰지 않는다',async()=>{
  const f=await fixture();expect((await apply(f.request)).status).toBe('applied');
  expect((await f.target.get()).data()).toMatchObject({items:[{...f.item,quantity:2}],inventoryWriteRevision:5});
  expect((await audit(f.request).get()).data()).toMatchObject({orderId:f.id,by:'실제 담당자',changes:[expect.stringContaining('수량')]});
  const first=await f.target.get(),firstAudit=await audit(f.request).get();
  expect((await executeOrderEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).status).toBe('applied');
  expect((await apply(f.request)).status).toBe('duplicate');expect((await f.target.get()).updateTime!.isEqual(first.updateTime!)).toBe(true);expect((await audit(f.request).get()).updateTime!.isEqual(firstAudit.updateTime!)).toBe(true);
  await f.target.delete();await audit(f.request).delete();expect((await apply(f.request)).status).toBe('duplicate');expect((await f.target.get()).exists).toBe(false);expect((await audit(f.request).get()).exists).toBe(false);
 });
 it('동시 두 편집은 하나만 반영하며 stale 원문 거절은 나중에 원문이 돌아와도 적용하지 않는다',async()=>{
  const f=await fixture(),second={...f.request,planId:'second-'+randomUUID(),edit:{kind:'items' as const,items:[{...f.item,quantity:3}]}};receipt(second);audit(second);
  const results=await Promise.all([apply(f.request),apply(second)]);expect(results.map(r=>r.status).sort()).toEqual(['applied','rejected']);
  const loser=results[0].status==='rejected'?f.request:second;expect((await audit(loser).get()).exists).toBe(false);await f.target.set(f.order);expect((await apply(loser)).status).toBe('rejected');expect((await f.target.get()).get('items')[0].quantity).toBe(1);
 },60000);
 it('정상 재고 completion/index revision 증가는 CAS를 깨며 체크 완료 원문을 옛 배열로 덮지 않는다',async()=>{
  for(const patch of [{inventoryGenerationCompletion:{completedAt:'now'}},{productionRecordIndex:{line:{recordId:'record'}}},{itemInventory:{line:{applied:true}},items:undefined}]){
   const f=await fixture();const change={...patch,inventoryWriteRevision:5};delete (change as any).items;await f.target.update(change);
   expect((await apply(f.request)).status).toBe('rejected');expect((await audit(f.request).get()).exists).toBe(false);expect((await f.target.get()).get('inventoryWriteRevision')).toBe(5);
  }
 });
 it('processing·failed·퇴역미결 구성 변경은 막지만 같은 원문 메타데이터는 허용하고 revision·날짜시각을 보존한다',async()=>{
  for(const patch of [{inventoryOperation:{state:'processing',id:'active'}},{inventoryOperation:{state:'failed',id:'failed'}},{retirementClaimPending:true}]){
   const f=await fixture(patch);expect((await apply(f.request)).status).toBe('rejected');
   const metadata={...f.request,planId:'metadata-'+randomUUID(),edit:{kind:'draft' as const,draft:{deliveryDate:'2026-10-19T00:00:00Z',items:[f.item],note:'새 비고',noteImportant:true}}};receipt(metadata);audit(metadata);
   expect((await apply(metadata)).status).toBe('applied');expect((await f.target.get()).data()).toMatchObject({note:'새 비고',noteBy:'실제 담당자',inventoryWriteRevision:4,deliveryDate:'2026-10-19T03:00:00Z',...patch});expect((await audit(metadata).get()).exists).toBe(false);
  }
 });
 it('기존 완료줄 수량변경·체크위조는 차단하고 명시 동의 품목추가만 완료·재고원문을 보존한다',async()=>{
  const f=await fixture({status:'DISPATCHED',producedAt:'2026-10-18',itemInventory:{line:{applied:true}}});
  await f.target.update({items:[{...f.item,checked:true,checkedBy:'기존',checkedAt:'기존시각'}]});
  const current=(await f.target.get()).data()!;f.request.expected=orderEditExpected(current);
  expect((await apply(f.request)).status).toBe('rejected');
  const old=current.items[0],added={itemId:f.itemId,lineId:'new',name:'추가',quantity:1,price:0};
  const addition={...f.request,planId:'add-'+randomUUID(),edit:{kind:'items' as const,items:[old,added]}};receipt(addition);audit(addition);
  expect((await apply(addition)).status).toBe('rejected');
  const confirmed={...addition,planId:'confirmed-'+randomUUID(),confirmedAddedToDispatched:true};receipt(confirmed);audit(confirmed);expect((await apply(confirmed)).status).toBe('applied');expect((await f.target.get()).data()).toMatchObject({items:[old,added],status:'PROCESSING',itemInventory:current.itemInventory,producedAt:current.producedAt});
 });
 it('라벨·제조일 도장은 서버 실직원과 시각을 사용한다',async()=>{
  const f=await fixture();f.request.edit={kind:'items',items:[{...f.item,labelType:'부착',labelBy:'위조',mfgDate:'2026-10-18',mfgBy:'위조'}]};
  expect((await apply(f.request)).status).toBe('applied');expect((await f.target.get()).get('items')[0]).toMatchObject({labelBy:'실제 담당자',mfgBy:'실제 담당자',labelAt:expect.any(String),mfgAt:expect.any(String)});
 });
 it('카탈로그 epoch있을 때 보관·통합tomb·타회사품목을 거절하고 epoch없음 기존 정책을 유지한다',async()=>{
  const epoch=ref('catalogItemMergeState/taebaek');
  for(const kind of ['archived','merged','foreign','absent'] as const){
   const f=await fixture();if(kind==='absent')await epoch.delete();else await epoch.set({companyId:'taebaek',revision:1});
   if(kind==='archived'||kind==='absent')await ref('items/'+f.itemId).update({archived:true});
   if(kind==='foreign')await ref('items/'+f.itemId).update({companyId:'punghoe'});
   if(kind==='merged')await ref('inventoryWriterDeletions/taebaek__'+f.itemId).set({companyId:'taebaek',mergedIntoItemId:'keeper'});
   expect((await apply(f.request)).status).toBe(kind==='absent'?'applied':'rejected');expect((await audit(f.request).get()).exists).toBe(kind==='absent');
  }
 });
 it('부재 inspect는 unknown·쓰기0이며 중단 fence와 apply 경합은 둘 중 하나만 확정한다',async()=>{
  const f=await fixture();expect((await executeOrderEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).status).toBe('unknown');expect((await receipt(f.request).get()).exists).toBe(false);
  const results=await Promise.all([apply(f.request),executeOrderEditCommand(db,actor,{mode:'cancel',reference:reference(f.request)})]);
  const saved=(await receipt(f.request).get()).data()!;expect((await f.target.get()).get('items')[0].quantity).toBe(saved.status==='applied'?2:1);expect((await audit(f.request).get()).exists).toBe(saved.status==='applied');expect(results.every(result=>result.status===saved.status)).toBe(true);
  const other=await fixture();expect((await executeOrderEditCommand(db,actor,{mode:'cancel',reference:reference(other.request)})).status).toBe('cancelled');expect((await apply(other.request)).status).toBe('cancelled');expect((await other.target.get()).get('items')[0].quantity).toBe(1);
 },60000);
 it('대상 삭제·타회사·회사직원불일치·같은plan다른본문은 업무원문을 쓰지 않는다',async()=>{
  const f=await fixture();await f.target.delete();expect((await apply(f.request)).status).toBe('rejected');expect((await f.target.get()).exists).toBe(false);
  const good=await fixture();await apply(good.request);await expect(apply({...good.request,edit:{kind:'items',items:[good.item]}})).rejects.toMatchObject({code:'already-exists'});
  const missing=await fixture();const noEmployee={uid:'missing-actor',token:{...actor.token,employeeId:'missing'}};ref(ORDER_EDIT_OPERATIONS+'/'+orderEditReceiptId(missing.request.companyId,noEmployee.uid,missing.request.planId));expect((await apply(missing.request,noEmployee)).status).toBe('rejected');
  await expect(apply({...missing.request,companyId:'punghoe'})).rejects.toMatchObject({code:'permission-denied'});
 });
 it('진짜 Timestamp 원문은 동일codec으로비교하고 손상 receipt는 추가쓰기를 막는다',async()=>{
  const f=await fixture({noteAt:new admin.firestore.Timestamp(1,2)});
  f.request.expected=orderEditExpected((await f.target.get()).data()!,{special:value=>value instanceof admin.firestore.Timestamp?['timestamp',value.seconds,value.nanoseconds]:undefined});
  expect((await apply(f.request)).status).toBe('applied');
  await receipt(f.request).update({requestHash:'a'.repeat(64)});await expect(apply(f.request)).rejects.toMatchObject({code:'failed-precondition'});
  const text=serializeOrderEditRequest(f.request);expect(createHash('sha256').update(text).digest('hex')).not.toBe('a'.repeat(64));
 });
});
