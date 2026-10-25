import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../test/emulatorTestPolicy';
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let buildBomIndex:typeof import('../bomIndex').buildBomIndex;
let buildPackIndex:typeof import('../packIndex').buildPackIndex;
let receiveUnitStockWithDb:typeof import('./firebaseService').receiveUnitStockWithDb;
const policy=createEmulatorTestPolicy(process.env,'receiveUnitStock',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeTestEnvironment}=await import('@firebase/rules-unit-testing'));
  ({doc,getDoc,setDoc}=await import('firebase/firestore'));
  ({buildBomIndex}=await import('../bomIndex'));
  ({buildPackIndex}=await import('../packIndex'));
  ({receiveUnitStockWithDb}=await import('./firebaseService'));
  policy.assertCurrentEnvironment(process.env);
}
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  await env.clearFirestore();
}
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
import type {Firestore} from 'firebase/firestore';


import type {Item} from '../types';
vi.mock('../firebase',()=>({db:null,functions:null,auth:{currentUser:null},authReady:Promise.resolve()}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>{throw new Error('이 시험은 callable 경로를 사용하지 않습니다.');}}));
let env:RulesTestEnvironment;
const item={id:'box',companyId:'taebaek',name:'포장',type:'product',spec:'1kg * 20',unit:'개',stock:0,minStock:0,image:'',lots:[]} as Item;
let inputs:{bom:ReturnType<typeof buildBomIndex>;pack:ReturnType<typeof buildPackIndex>};
const receipt={id:'receipt',companyId:'taebaek' as const,itemId:'box',itemName:'포장',quantity:2,partnerName:'공급자',date:'2026-07-31',createdAt:'2026-07-31T03:00:00Z'};
describe.skipIf(!policy.enabled)('단위 재고 입고 (Firestore Emulator)',()=>{
beforeAll(async()=>{
 await loadRuntime();
 inputs={bom:buildBomIndex([item,{id:'loose',name:'낱개',type:'product',spec:'1kg',unit:'개',stock:0,minStock:0,image:''} as Item],[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
 env=await initializeTestEnvironment({projectId:policy.projectId,firestore:{host:policy.host,port:policy.port,rules:readFileSync('firestore.rules','utf8')}});
 policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
 await clearOwned();
 await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'items','box'),item);});
},90_000);
afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup()]);});
const store=(companyId='taebaek')=>env.authenticatedContext(`admin-${companyId}`,{employeeId:'admin',companyId,isAdmin:true}).firestore() as unknown as Firestore;
it('실제 회사 규칙 아래 입고·로트를 함께 저장하고 같은 ID 재시도는 중복하지 않는다',async()=>{
 const db=store();
 expect(await receiveUnitStockWithDb(db,receipt,inputs)).toBe(true);
 expect(await receiveUnitStockWithDb(db,receipt,inputs)).toBe(false);
 const saved=(await getDoc(doc(db,'items','box'))).data()!;
 expect(saved.stock).toBe(2);
 expect(saved.lots).toHaveLength(1);
 expect(saved.lots[0]).toMatchObject({qtyRemaining:2,kgRemaining:40});
 expect((await getDoc(doc(db,'itemReceipts','receipt'))).data()).toMatchObject(receipt);
},20_000);
it('타회사 인증은 입고와 재고를 일부만 저장하지 않는다',async()=>{
 await expect(receiveUnitStockWithDb(store('punghoe'),{...receipt,id:'foreign'},inputs)).rejects.toThrow();
 await env.withSecurityRulesDisabled(async ctx=>{
  expect((await getDoc(doc(ctx.firestore(),'itemReceipts','foreign'))).exists()).toBe(false);
  expect((await getDoc(doc(ctx.firestore(),'items','box'))).data()?.stock).toBe(2);
 });
},20_000);

});
