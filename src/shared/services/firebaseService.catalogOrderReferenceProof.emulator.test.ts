import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type * as Admin from 'firebase-admin';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const admin: typeof Admin = createRequire(resolve('functions/package.json'))('firebase-admin');
import { executeCatalogOrderReferenceProof } from '../../../functions/src/catalogOrderReferenceProof';
const state=vi.hoisted(()=>({db:null as any,admin:null as any,calls:0,uid:'gateway-user'}));
vi.mock('../firebase',()=>({get db(){return state.db;},authReady:Promise.resolve(),functions:{},auth:{get currentUser(){return{uid:state.uid,getIdTokenResult:async()=>({claims:{companyId:'taebaek',employeeId:'e'}})};}}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>async(input:unknown)=>{state.calls++;return{data:await executeCatalogOrderReferenceProof(state.admin,{uid:state.uid,token:{companyId:'taebaek',employeeId:'e'}},input)};}}));
import {setDocument,commitCompanyWrites,updateItem,addItem} from './firebaseService';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082';
describe.skipIf(!enabled)('실제 공용 주문 gateway와 catalog proof SDK',()=>{
 const projectId='demo-gateway-'+randomUUID().slice(0,8),id='gateway-order';let env:RulesTestEnvironment,app:Admin.app.App;
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});app=admin.initializeApp({projectId},projectId);state.admin=admin.firestore(app);state.db=env.authenticatedContext(state.uid,{companyId:'taebaek',employeeId:'e'}).firestore();await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'catalogItemMergeState','taebaek'),{companyId:'taebaek',revision:1});for(const itemId of ['keeper','other'])await setDoc(doc(c.firestore(),'items',itemId),{companyId:'taebaek',stock:0});});});
 afterAll(async()=>{for(const collection of ['orders','purchaseOrders','items','catalogOrderReferenceProofs','catalogItemMergeState'])for(const row of (await state.admin.collection(collection).get()).docs)await row.ref.delete();await app.delete();await env.cleanup();});
 it('단건과 배치 최종 payload에만 proof를 붙이고 표시 수정은 추가 RPC가 없다',async()=>{const input={companyId:'taebaek',status:'PENDING',items:[{itemId:'keeper',quantity:1,at:new Date('2026-10-18T00:00:00Z')}]};await setDocument('orders',id,input);const saved=await getDoc(doc(state.db,'orders',id));expect(saved.get('catalogReferenceProofId')).toBeTruthy();expect(input).not.toHaveProperty('catalogReferenceProofId');const calls=state.calls;await updateItem('orders',id,{memo:'설명'});expect(state.calls).toBe(calls);await commitCompanyWrites([{kind:'set',collection:'orders',id,data:{...input,items:[{itemId:'other',quantity:2}]},merge:true}]);expect((await getDoc(doc(state.db,'orders',id))).get('items')[0].itemId).toBe('other');expect(state.calls).toBe(calls+1);});
 it('발주 신규·변경·배치는 native projection으로 확인하고 메모·완료 이력은 RPC 없이 저장한다',async()=>{
  const input={companyId:'taebaek',status:'pending',itemId:'keeper',items:[{itemId:'keeper',quantity:1}]};
  const poId=await addItem('purchaseOrders',input as any);
  const first=await getDoc(doc(state.db,'purchaseOrders',poId));expect(first.get('catalogReferenceProofId')).toBeTruthy();expect(first.data()).not.toHaveProperty('inventoryWriteRevision');
  let calls=state.calls;await updateItem('purchaseOrders',poId,{memo:'설명'});expect(state.calls).toBe(calls);
  await updateItem('purchaseOrders',poId,{itemId:'other',items:[{itemId:'other',quantity:2}]});expect(state.calls).toBe(calls+1);
  await commitCompanyWrites([{kind:'set',collection:'purchaseOrders',id:poId,data:{itemId:'keeper',items:[{itemId:'keeper',quantity:3}]},merge:true}]);
  expect((await getDoc(doc(state.db,'purchaseOrders',poId))).get('items')[0].quantity).toBe(3);
  await updateItem('purchaseOrders',poId,{status:'received'});calls=state.calls;
  await updateItem('purchaseOrders',poId,{memo:'과거 이력'});expect(state.calls).toBe(calls);
  await updateItem('purchaseOrders',poId,{status:'pending'});expect(state.calls).toBe(calls+1);
 });
 it('epoch 없는 기존 회사의 발주는 새 proof나 revision을 강요하지 않는다',async()=>{
  await state.admin.doc('catalogItemMergeState/taebaek').delete();
  try { const calls=state.calls;await setDocument('purchaseOrders','legacy-po',{companyId:'taebaek',status:'pending',itemId:'keeper'});
   const saved=await getDoc(doc(state.db,'purchaseOrders','legacy-po'));expect(saved.data()).not.toHaveProperty('catalogReferenceProofId');expect(saved.data()).not.toHaveProperty('inventoryWriteRevision');expect(state.calls).toBe(calls);
  } finally { await state.admin.doc('catalogItemMergeState/taebaek').set({companyId:'taebaek',revision:1}); }
 });
});
