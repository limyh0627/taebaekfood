/** @vitest-environment jsdom */
import {useMemo} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {buildBomIndex,getBomIndex,setBomIndex} from '../bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from '../packIndex';
import type {OrderUnitInputs} from '../orderUnits';
import type {CompanyId,Item} from '../types';
const mocks=vi.hoisted(()=>({listeners:[] as {name:string;company:string;callback:(rows:unknown[])=>void}[],staticRows:{} as Record<string,{bom:unknown[];pack:unknown[]}>}));
vi.mock('../firebase',()=>({authReady:Promise.resolve(),auth:{currentUser:{uid:'static-actor'}},db:{}}));
vi.mock('firebase/firestore',()=>({where:(field:string,op:string,value:string)=>({field,op,value}),doc:vi.fn(),getDoc:vi.fn()}));
vi.mock('../services/firebaseService',()=>({
 subscribeToCollection:(name:string,callback:(rows:unknown[])=>void,clauses:{field:string;value:string}[])=>{mocks.listeners.push({name,callback,company:clauses.find(r=>r.field==='companyId')?.value??''});return()=>{};},
 subscribeToRecentCollection:()=>()=>{},subscribeToDocument:()=>()=>{},fetchDateRange:async()=>[],
 fetchCollection:async(name:string,clauses:{field:string;value:string}[])=>{
  const companyId=clauses.find(r=>r.field==='companyId')?.value,count=companyId==='taebaek'?12:6;
  if(mocks.staticRows[companyId??''])return name==='item_bom'?mocks.staticRows[companyId??''].bom:name==='item_pack'?mocks.staticRows[companyId??''].pack:[];
  return name==='item_bom'?[{parent_id:'box',child_id:'loose',quantity:count,companyId}]:name==='item_pack'?[{item_id:'loose',units_per_box:count+1,companyId}]:[];
 }
}));
vi.mock('./useCompanyInfoRead',()=>({useCompanyInfoRead:()=>({value:null,status:'idle',error:'',retry:()=>{},observationToken:{},isCurrent:()=>false})}));
import {useAppData} from './useAppData';
const originalBom=getBomIndex(),originalPack=getPackIndex();
afterEach(()=>{setBomIndex(originalBom);setPackIndex(originalPack);});beforeEach(()=>{mocks.listeners=[];mocks.staticRows={};});
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

const derivedInput=(input:OrderUnitInputs|undefined)=>({bom:input?.bom.of('box')[0]?.qty??0,pack:input?.pack.of('loose')??0,child:input?.bom.of('box')[0]?.child?.name??''});
const consumerHook=(consume:(input:OrderUnitInputs|undefined)=>ReturnType<typeof derivedInput>)=>renderHook(({enabled,company}:{enabled:boolean;company:CompanyId})=>{
 const data=useAppData(enabled,company),derived=useMemo(()=>consume(data.orderUnitInputs),[data.orderUnitInputs]);return {data,derived};
},{initialProps:{enabled:true,company:'taebaek' as CompanyId}});
const itemsListener=(company:CompanyId)=>mocks.listeners.filter(row=>row.name==='items'&&row.company===company).at(-1)!;
const prepareConsumer=async(hook:ReturnType<typeof consumerHook>)=>{
 await waitFor(()=>expect(itemsListener('taebaek')).toBeDefined());act(()=>itemsListener('taebaek').callback(items('taebaek')));
 await waitFor(()=>{expect(hook.result.current.data.itemBoms[0]?.quantity).toBe(12);expect(hook.result.current.data.itemPacks[0]?.units_per_box).toBe(13);expect(hook.result.current.data.items).toHaveLength(2);});await act(async()=>{});
 expect(hook.result.current.derived).toEqual({bom:12,pack:13,child:'낱개'});
};
it('같은 props와 무관한 실제 공지 구독 갱신은 입력 소비 계산을 다시 하지 않는다',async()=>{
 const consume=vi.fn(derivedInput),hook=consumerHook(consume);await prepareConsumer(hook);
 const input=hook.result.current.data.orderUnitInputs,calls=consume.mock.calls.length;
 hook.rerender({enabled:true,company:'taebaek'});
 expect(consume).toHaveBeenCalledTimes(calls);expect(hook.result.current.data.orderUnitInputs).toBe(input);
 const notice=mocks.listeners.find(row=>row.name==='notices'&&row.company==='taebaek')!;expect(notice).toBeDefined();
 act(()=>notice.callback([{id:'memo-notice',companyId:'taebaek',title:'합성 공지'}]));
 await waitFor(()=>expect(hook.result.current.data.noticePosts[0]?.title).toBe('합성 공지'));
 expect(consume).toHaveBeenCalledTimes(calls);expect(hook.result.current.data.orderUnitInputs).toBe(input);
});
it('품목과 pack·BOM 실제 갱신 및 회사·활성 전환은 새 입력을 계산한다',async()=>{
 const bom=[{parent_id:'box',child_id:'loose',quantity:12,companyId:'taebaek'}],pack=[{item_id:'loose',units_per_box:13,companyId:'taebaek'}];mocks.staticRows.taebaek={bom,pack};
 const consume=vi.fn(derivedInput),hook=consumerHook(consume);await prepareConsumer(hook);
 let input=hook.result.current.data.orderUnitInputs;
 act(()=>itemsListener('taebaek').callback(items('taebaek').map(row=>row.id==='loose'?{...row,name:'새 낱개'}:row)));
 await waitFor(()=>expect(hook.result.current.derived).toEqual({bom:12,pack:13,child:'새 낱개'}));expect(hook.result.current.data.orderUnitInputs).not.toBe(input);input=hook.result.current.data.orderUnitInputs;
 // BOM 배열은 그대로 반환하여 packIndex만 바뀌는 갱신도 검증한다.
 mocks.staticRows.taebaek={bom,pack:[{item_id:'loose',units_per_box:17,companyId:'taebaek'}]};await act(async()=>{await hook.result.current.data.refreshStaticData();});
 await waitFor(()=>expect(hook.result.current.data.orderUnitInputs?.pack.of('loose')).toBe(17));expect(hook.result.current.derived).toEqual({bom:12,pack:17,child:'새 낱개'});expect(hook.result.current.data.orderUnitInputs).not.toBe(input);input=hook.result.current.data.orderUnitInputs;
 const samePack=mocks.staticRows.taebaek.pack;mocks.staticRows.taebaek={bom:[{parent_id:'box',child_id:'loose',quantity:20,companyId:'taebaek'}],pack:samePack};await act(async()=>{await hook.result.current.data.refreshStaticData();});
 await waitFor(()=>expect(hook.result.current.data.orderUnitInputs?.bom.of('box')[0]?.qty).toBe(20));expect(hook.result.current.derived).toEqual({bom:20,pack:17,child:'새 낱개'});expect(hook.result.current.data.orderUnitInputs).not.toBe(input);
 const oldItems=itemsListener('taebaek');hook.rerender({enabled:true,company:'punghoe'});expect(hook.result.current.derived).toEqual({bom:0,pack:0,child:''});
 await waitFor(()=>expect(itemsListener('punghoe')).toBeDefined());act(()=>itemsListener('punghoe').callback(items('punghoe')));
 await waitFor(()=>expect(hook.result.current.derived).toEqual({bom:6,pack:7,child:'낱개'}));input=hook.result.current.data.orderUnitInputs;const calls=consume.mock.calls.length;
 act(()=>oldItems.callback(items('taebaek')));expect(consume).toHaveBeenCalledTimes(calls);expect(hook.result.current.data.orderUnitInputs).toBe(input);
 hook.rerender({enabled:false,company:'punghoe'});expect(hook.result.current.derived).toEqual({bom:0,pack:0,child:''});expect(hook.result.current.data.orderUnitInputs).not.toBe(input);input=hook.result.current.data.orderUnitInputs;
 hook.rerender({enabled:true,company:'punghoe'});await waitFor(()=>expect(hook.result.current.derived).toEqual({bom:6,pack:7,child:'낱개'}));expect(hook.result.current.data.orderUnitInputs).not.toBe(input);
});

vi.mock('../services/staticReferenceRead',async()=>{const {fetchCollection,subscribeToCollection}=await import('../services/firebaseService');return {subscribeInventoryItems:(companyId:string,next:(snapshot:unknown)=>void,error:(reason:unknown)=>void)=>subscribeToCollection('items',(rows:unknown[])=>next({rows,metadata:{fromCache:false,hasPendingWrites:false}}),[{field:'companyId',value:companyId}] as never,error as never),readStaticReferenceCollection:async(name:string,companyId:string)=>({rows:await fetchCollection(name as never,[{field:'companyId',value:companyId}] as never),metadata:{fromCache:false,hasPendingWrites:false}}),staticReferenceServerRows:async(request:Promise<{rows:unknown[]}>)=>(await request).rows};});
