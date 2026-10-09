import {describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({calls:[] as any[],user:{uid:'admin',getIdTokenResult:async()=>({claims:{companyId:'taebaek',isAdmin:true}})} as any}));
vi.mock('../firebase',()=>({db:{},functions:{},authReady:Promise.resolve(),auth:{get currentUser(){return state.user;}}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),doc:()=>({}),getDoc:async()=>({data:()=>({status:'active',releaseId:'opening-test'})})}));
vi.mock('firebase/functions',()=>({httpsCallable:(_:unknown,name:string)=>async(body:unknown)=>{state.calls.push({name,body});return{data:'created'};}}));
import {createOpeningInventory} from './firebaseService';
describe('기초 재고 서버 호출',()=>{
 it('명시 BOM을 보내지 않고 수량과 평가액 원문만 전달한다',async()=>{
  expect(await createOpeningInventory('taebaek','2026-07-31','box',2,100,{bom:{} as any,pack:{} as any})).toBe('created');
  expect(state.calls).toEqual([{name:'createOpeningInventoryCommand',body:{companyId:'taebaek',date:'2026-07-31',itemId:'box',quantity:2,value:100,releaseId:'opening-test'}}]);
 });
 it('타 회사 claim은 송신 전에 거절한다',async()=>{
  state.user={uid:'admin',getIdTokenResult:async()=>({claims:{companyId:'punghoe',isAdmin:true}})};
  await expect(createOpeningInventory('taebaek','2026-07-31','box',2,100)).rejects.toThrow();expect(state.calls).toHaveLength(1);
 });
});
