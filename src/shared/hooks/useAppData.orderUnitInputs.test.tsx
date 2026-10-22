/** @vitest-environment jsdom */
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {buildBomIndex,getBomIndex,setBomIndex} from '../bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from '../packIndex';
import type {CompanyId,Item} from '../types';
const mocks=vi.hoisted(()=>({listeners:[] as {name:string;company:string;callback:(rows:unknown[])=>void}[]}));
vi.mock('../firebase',()=>({authReady:Promise.resolve(),auth:{currentUser:null},db:{}}));
vi.mock('firebase/firestore',()=>({where:(field:string,op:string,value:string)=>({field,op,value}),doc:vi.fn(),getDoc:vi.fn()}));
vi.mock('../services/firebaseService',()=>({
 subscribeToCollection:(name:string,callback:(rows:unknown[])=>void,clauses:{field:string;value:string}[])=>{mocks.listeners.push({name,callback,company:clauses.find(r=>r.field==='companyId')?.value??''});return()=>{};},
 subscribeToRecentCollection:()=>()=>{},subscribeToDocument:()=>()=>{},fetchDateRange:async()=>[],
 fetchCollection:async(name:string,clauses:{field:string;value:string}[])=>{
  const companyId=clauses.find(r=>r.field==='companyId')?.value,count=companyId==='taebaek'?12:6;
  return name==='item_bom'?[{parent_id:'box',child_id:'loose',quantity:count,companyId}]:name==='item_pack'?[{item_id:'loose',units_per_box:count+1,companyId}]:[];
 }
}));
vi.mock('./useCompanyInfoRead',()=>({useCompanyInfoRead:()=>({value:null,status:'idle',error:'',retry:()=>{},observationToken:{},isCurrent:()=>false})}));
import {useAppData} from './useAppData';
const originalBom=getBomIndex(),originalPack=getPackIndex();
afterEach(()=>{setBomIndex(originalBom);setPackIndex(originalPack);});beforeEach(()=>{mocks.listeners=[];});
const items=(companyId:CompanyId):Item[]=>[{id:'box',name:'박스',type:'product',unit:'박스',stock:0,minStock:0,image:'',companyId},{id:'loose',name:'낱개',type:'product',unit:'개',stock:0,minStock:0,image:'',companyId}];
it('두 회사의 실제 훅 입력은 서로 유지되며 전역 인덱스를 바꾸지 않는다',async()=>{
 const sentinelBom=buildBomIndex([],[]),sentinelPack=buildPackIndex([{item_id:'sentinel',units_per_box:99}]);setBomIndex(sentinelBom);setPackIndex(sentinelPack);
 const a=renderHook(()=>useAppData(true,'taebaek')),b=renderHook(()=>useAppData(true,'punghoe'));
 await waitFor(()=>expect(mocks.listeners.filter(r=>r.name==='items')).toHaveLength(2));
 act(()=>{for(const row of mocks.listeners.filter(r=>r.name==='items'))row.callback(items(row.company as CompanyId));});
 await waitFor(()=>{expect(a.result.current.orderUnitInputs?.bom.of('box')[0]?.qty).toBe(12);expect(b.result.current.orderUnitInputs?.bom.of('box')[0]?.qty).toBe(6);});
 expect(a.result.current.orderUnitInputs?.pack.of('loose')).toBe(13);expect(b.result.current.orderUnitInputs?.pack.of('loose')).toBe(7);
 expect(getBomIndex()).toBe(sentinelBom);expect(getPackIndex()).toBe(sentinelPack);
});
it('비활성 훅은 자체 빈 입력만 반환하며 기존 전역을 초기화하지 않는다',()=>{
 const sentinelBom=buildBomIndex(items('taebaek'),[{parent_id:'box',child_id:'loose',quantity:12}]),sentinelPack=buildPackIndex([{item_id:'loose',units_per_box:13}]);setBomIndex(sentinelBom);setPackIndex(sentinelPack);
 const disabled=renderHook(()=>useAppData(false,'punghoe'));
 expect(disabled.result.current.orderUnitInputs?.bom.of('box')).toEqual([]);expect(disabled.result.current.orderUnitInputs?.pack.of('loose')).toBe(0);
 expect(getBomIndex()).toBe(sentinelBom);expect(getPackIndex()).toBe(sentinelPack);
});
