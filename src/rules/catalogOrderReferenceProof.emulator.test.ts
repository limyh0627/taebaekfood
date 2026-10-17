import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, writeBatch, runTransaction } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082';
describe.skipIf(!enabled)('주문 품목 참조 Rules',()=>{
 let env:RulesTestEnvironment;const run='rule-'+randomUUID(),projectId='demo-proof-'+randomUUID().slice(0,8),co='taebaek',uid='employee';
 const order=(items=[{itemId:'keeper'}])=>({companyId:co,status:'PENDING',items,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});});
 afterAll(async()=>{await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const [collection,id] of [['orders',run],['purchaseOrders',run],['catalogItemMergeState',co],['catalogOrderReferenceProofs','proof'],['catalogOrderReferenceProofs','po-proof'],['items','donor'],['inventoryWriterDeletions',co+'__donor']])await import('firebase/firestore').then(({deleteDoc})=>deleteDoc(doc(db,collection,id)));});await env.cleanup();});
 const client=()=>env.authenticatedContext(uid,{companyId:co,employeeId:'e'}).firestore();
 it('epoch 없음은 기존 신규 주문을 허용하고 epoch 이후는 proof를 요구한다',async()=>{const db=client();await assertSucceeds(setDoc(doc(db,'orders',run),order()));await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'catalogItemMergeState',co),{companyId:co,revision:1});});await assertFails(updateDoc(doc(db,'orders',run),{items:[{itemId:'other'}],inventoryWriteRevision:2}));});
 it('native items·actor·현재 revision과 epoch가 맞는 증거만 쓰고 과거 표시 메모는 그대로 허용한다',async()=>{const db=client(),items=[{itemId:'other',detail:{seconds:1,nanoseconds:2}}];await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'catalogOrderReferenceProofs','proof'),{companyId:co,actorUid:uid,orderId:run,orderExists:true,beforeRevision:1,catalogRevision:1,status:'PENDING',items});});await assertSucceeds(updateDoc(doc(db,'orders',run),{items,catalogReferenceProofId:'proof',inventoryWriteRevision:2}));await assertSucceeds(updateDoc(doc(db,'orders',run),{memo:'설명'}));expect((await getDoc(doc(db,'orders',run))).get('items')).toEqual(items);});
 it('epoch 증가 뒤 옛 proof·proof 위조·다른 회사·통합 donor 재생성은 거절한다',async()=>{const db=client();await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'catalogItemMergeState',co),{companyId:co,revision:2});await setDoc(doc(c.firestore(),'inventoryWriterDeletions',co+'__donor'),{companyId:co,itemId:'donor',inventoryWriterProtocolVersion:1,deletionRevision:1,beforeRevision:0,lastDeletedItemRevision:0,mergedIntoItemId:'keeper',mergeOperationId:'merge'});});await assertFails(updateDoc(doc(db,'orders',run),{items:[{itemId:'donor'}],catalogReferenceProofId:'proof',inventoryWriteRevision:3}));await assertFails(setDoc(doc(db,'catalogOrderReferenceProofs','forged'),{companyId:co,actorUid:uid}));await assertFails(setDoc(doc(db,'items','donor'),{companyId:co,stock:0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1}));await assertFails(setDoc(doc(db,'catalogItemMergeState',co),{companyId:co,revision:0}));await assertFails(updateDoc(doc(env.authenticatedContext('foreign',{companyId:'punghoe',employeeId:'p'}).firestore(),'orders',run),{memo:'다름'}));});
 it('같은 품목·현재 주문 revision이라도 옛 epoch 또는 다른 작성자 증거는 거절한다',async()=>{
  const db=client(),items=[{itemId:'keeper',quantity:3}];
  const proof={companyId:co,actorUid:uid,orderId:run,orderExists:true,beforeRevision:2,catalogRevision:1,status:'PENDING',items};
  const seed=async(data:object)=>env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'catalogOrderReferenceProofs','proof'),data));
  const save=()=>updateDoc(doc(db,'orders',run),{items,catalogReferenceProofId:'proof',inventoryWriteRevision:3});
  await seed(proof);await assertFails(save());
  await seed({...proof,catalogRevision:2,actorUid:'someone-else'});await assertFails(save());
  await seed({...proof,catalogRevision:2});await assertSucceeds(save());
 });
 it('발주는 최종·이전 projection 누락까지 맞아야 하고 직접 donor 변경은 거절한다',async()=>{
  const db=client(),next={status:'pending',itemId:'keeper',items:[{itemId:'keeper'}]};
  await assertFails(setDoc(doc(db,'purchaseOrders',run),{companyId:co,...next}));
  const proof={collection:'purchaseOrders',companyId:co,actorUid:uid,orderId:run,orderExists:false,catalogRevision:2,beforeProjection:{},nextProjection:next};
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'catalogOrderReferenceProofs','po-proof'),proof));
  await assertSucceeds(setDoc(doc(db,'purchaseOrders',run),{companyId:co,...next,catalogReferenceProofId:'po-proof'}));
  await assertSucceeds(updateDoc(doc(db,'purchaseOrders',run),{memo:'표시 수정'}));
  const changed={...next,itemId:'other'};
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'catalogOrderReferenceProofs','po-proof'),{...proof,orderExists:true,beforeProjection:{...next,oemSent:null},nextProjection:changed}));
  await assertFails(updateDoc(doc(db,'purchaseOrders',run),{itemId:'other'}));
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'catalogOrderReferenceProofs','po-proof'),{...proof,orderExists:true,beforeProjection:next,nextProjection:changed}));
  await assertSucceeds(updateDoc(doc(db,'purchaseOrders',run),{itemId:'other'}));
  await assertFails(updateDoc(doc(db,'purchaseOrders',run),{itemId:'donor'}));
 });
});

describe.skipIf(!enabled)('통합 뒤 품목 연결의 최종 문서 참조',()=>{
 let env:RulesTestEnvironment;const projectId='demo-links-'+randomUUID().slice(0,8),paths=new Set<string>();
 const ref=(db:any,c:string,id:string)=>{paths.add(c+'/'+id);return doc(db,c,id);};
 const employee=()=>env.authenticatedContext('employee',{companyId:'taebaek',employeeId:'e'}).firestore();
 const admin=()=>env.authenticatedContext('admin',{companyId:'taebaek',employeeId:'admin-employee',isAdmin:true}).firestore();
 const seed=async(c:string,id:string,data:object)=>env.withSecurityRulesDisabled(async context=>setDoc(ref(context.firestore(),c,id),data));
 const item=(companyId='taebaek')=>({companyId,subtype:'벌크',stock:0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});
 const tomb=(itemId:string)=>({companyId:'taebaek',itemId,inventoryWriterProtocolVersion:1,beforeRevision:1,lastDeletedItemRevision:1,deletionRevision:1});
 const links=[['partner_item','itemId'],['item_pack','item_id'],['item_bom','child_id']] as const;
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});});
 afterAll(async()=>{await env.withSecurityRulesDisabled(async context=>{for(const path of paths)await deleteDoc(doc(context.firestore(),path));});await env.cleanup();});
 it('epoch 전 기존 고아 연결은 허용하고 이후 신규·변경 donor와 타회사 참조는 거절하되 기존 단가 수정·삭제는 유지한다',async()=>{
  const db=employee();for(const[c,field]of links)await assertSucceeds(setDoc(ref(db,c,'legacy'),{companyId:'taebaek',[field]:'orphan',parent_id:'orphan',price:1}));
  await seed('catalogItemMergeState','taebaek',{companyId:'taebaek',revision:1});await seed('items','keeper',item());await seed('items','foreign',item('punghoe'));
  await seed('inventoryWriterDeletions','taebaek__donor',{companyId:'taebaek',mergedIntoItemId:'keeper',mergeOperationId:'m'});
  for(const[c,field]of links){for(const id of ['donor','foreign'])await assertFails(setDoc(ref(db,c,'new-'+id),{companyId:'taebaek',[field]:id,parent_id:'keeper'}));await assertSucceeds(updateDoc(ref(db,c,'legacy'),{price:2}));await assertFails(updateDoc(ref(db,c,'legacy'),{[field]:'donor'}));await assertSucceeds(deleteDoc(ref(db,c,'legacy')));}
  await assertFails(setDoc(ref(db,'item_bom','bad-parent'),{companyId:'taebaek',parent_id:'donor',child_id:'keeper'}));
 });
 it('같은 원자 쓰기에서 품목을 만들고 연결할 수 있고 같은 쓰기에서 지운 품목에는 연결할 수 없다',async()=>{
  const db=employee(),batch=writeBatch(db);batch.set(ref(db,'items','new-item'),item());
  for(const[c,field]of links)batch.set(ref(db,c,'atomic'),{companyId:'taebaek',[field]:'new-item',parent_id:'new-item'});await assertSucceeds(batch.commit());
  await seed('items','to-delete',item());const removal=writeBatch(db);removal.delete(ref(db,'items','to-delete'));removal.set(ref(db,'inventoryWriterDeletions','taebaek__to-delete'),tomb('to-delete'));removal.set(ref(db,'partner_item','after-delete'),{companyId:'taebaek',itemId:'to-delete'});await assertFails(removal.commit());
  const control=writeBatch(db);control.delete(ref(db,'items','to-delete'));control.set(ref(db,'inventoryWriterDeletions','taebaek__to-delete'),tomb('to-delete'));await assertSucceeds(control.commit());
 });
 it('관리자 매입 단위도 동일 TX 생성은 허용하고 삭제 후 연결은 거절한다',async()=>{
  const db=admin(),row=(id:string,itemId:string)=>({id,companyId:'taebaek',itemId,purchaseUnit:'상자',unitKg:20,isDefault:false,active:true,createdAt:'2026-10-18',updatedAt:'2026-10-18'});
  const create=writeBatch(db);create.set(ref(db,'items','unit-new'),item());create.set(ref(db,'item_purchase_unit','unit'),row('unit','unit-new'));await assertSucceeds(create.commit());
  const removal=writeBatch(db);removal.delete(ref(db,'items','unit-new'));removal.set(ref(db,'inventoryWriterDeletions','taebaek__unit-new'),tomb('unit-new'));removal.set(ref(db,'item_purchase_unit','unit-deleted'),row('unit-deleted','unit-new'));await assertFails(removal.commit());
  const control=writeBatch(db);control.delete(ref(db,'items','unit-new'));control.set(ref(db,'inventoryWriterDeletions','taebaek__unit-new'),tomb('unit-new'));await assertSucceeds(control.commit());
 });
 it('최초 epoch가 없는 읽기 뒤 통합이 먼저 확정되면 늦은 donor 연결은 재시도해도 저장되지 않는다',async()=>{
  await env.withSecurityRulesDisabled(async context=>{await deleteDoc(ref(context.firestore(),'catalogItemMergeState','taebaek'));await setDoc(ref(context.firestore(),'items','race-donor'),item());});
  let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r;}),resume=new Promise<void>(r=>{release=r;});let attempts=0;const db=employee();
  const pending=runTransaction(db,async tx=>{await tx.get(ref(db,'catalogItemMergeState','taebaek'));if(++attempts===1){entered();await resume;}tx.set(ref(db,'partner_item','race'),{companyId:'taebaek',itemId:'race-donor'});});
  await arrived;await env.withSecurityRulesDisabled(async context=>{const batch=writeBatch(context.firestore());batch.set(ref(context.firestore(),'catalogItemMergeState','taebaek'),{companyId:'taebaek',revision:2});batch.delete(ref(context.firestore(),'items','race-donor'));await batch.commit();});release();await assertFails(pending);expect((await getDoc(ref(db,'partner_item','race'))).exists()).toBe(false);
 });
});
