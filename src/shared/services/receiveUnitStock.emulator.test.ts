import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,type Firestore} from 'firebase/firestore';
import {buildBomIndex} from '../bomIndex';
import {buildPackIndex} from '../packIndex';
import type {Item} from '../types';
vi.mock('../firebase',()=>({db:null,auth:{currentUser:null},authReady:Promise.resolve()}));
const {receiveUnitStockWithDb}=await import('./firebaseService');
let env:RulesTestEnvironment;
const item={id:'box',companyId:'taebaek',name:'포장',type:'product',spec:'1kg * 20',unit:'개',stock:0,minStock:0,image:'',lots:[]} as Item;
const inputs={bom:buildBomIndex([item,{id:'loose',name:'낱개',type:'product',spec:'1kg',unit:'개',stock:0,minStock:0,image:''} as Item],[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const receipt={id:'receipt',companyId:'taebaek' as const,itemId:'box',itemName:'포장',quantity:2,partnerName:'공급자',date:'2026-07-31',createdAt:'2026-07-31T03:00:00Z'};
beforeAll(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-unit-stock-inputs',firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'items','box'),item);});
},90_000);
afterAll(async()=>{await env?.cleanup();});
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
