/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {useEffect,useRef} from 'react';
import {renderHook} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex} from '../src/shared/packIndex';
import {itemKg,unpackComponent,type OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
import {unpackPlan} from '../src/shared/canUnpack';
const source=readFileSync('components/ItemList.tsx','utf8');
const start=source.indexOf('  const unpackBox = async');
const end=source.indexOf('\n  /**',start);
if(start<0||end<start)throw new Error('실제 개봉 함수 경계를 찾을 수 없습니다.');
const compiled=ts.transpileModule(`${source.slice(start,end)}\nreturn unpackBox;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const create=new Function('getBomIndex','getPackIndex','unpackComponent','items','runInventoryAttempt','companyId','auth','itemKg','orderUnitInputs',compiled);
function make(getBom:typeof getBomIndex,getPack:typeof getPackIndex,component:typeof unpackComponent,items:Item[],confirm:()=>Promise<boolean>,save:(...args:any[])=>any,toast:(...args:any[])=>any,alert:(...args:any[])=>any,mounted:{current:boolean},inputs?:OrderUnitInputs){
 return create(getBom,getPack,component,items,async(_kind:string,build:()=>any)=>{
  const request=build();if(!await confirm()||!mounted.current)return false;
  const result=await save(request);if(!mounted.current)return false;
  if(result.ok)toast({message:result.message});else alert(result.message);return result.ok;
 },'taebaek',{currentUser:{uid:'employee'}},itemKg,inputs);
}
const items=['box','unit','loose'].map(id=>({id,name:id,type:'product',companyId:'taebaek',unit:'개',spec:id==='unit'?'1kg * 20':'1kg',stock:id==='box'?2:0,minStock:0,image:''} as Item));
const a={bom:buildBomIndex(items,[{parent_id:'box',child_id:'unit',quantity:10},{parent_id:'unit',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const b=buildBomIndex(items,[]),original=getBomIndex();
afterEach(()=>setBomIndex(original));
it('목록·상세·미리보기·확정의 실제 네 개봉 계획 표현식은 회사 BOM을 사용한다',()=>{
 const can={...items[0],unpackable:true},bulk={...items[1],id:'bulk',subtype:'벌크',unit:'kg'},cap={...items[2],id:'cap',type:'submaterial'} as Item;
 const own={bom:buildBomIndex([can,bulk,cap],[{parent_id:can.id,child_id:'bulk',quantity:16.5},{parent_id:can.id,child_id:'cap',quantity:1}]),pack:buildPackIndex([])};
 setBomIndex(buildBomIndex([],[]));
 const calls=[...source.matchAll(/unpackPlan\([^;\n]+\)/g)].map(match=>match[0]);
 expect(calls).toHaveLength(4);
 for(const call of calls){
  const run=new Function('unpackPlan','item','product','unpackModal','orderUnitInputs',`return ${call};`);
  expect(run(unpackPlan,can,can,{item:can,count:'1'},own)).toMatchObject({ok:true,plan:{bulkQty:16.5,discarded:[{itemId:'cap',qty:1}]}});
 }
});
it('작업 시작부터 다른 전역 BOM이어도 회사 props 입력으로 개봉한다',async()=>{
 setBomIndex(b);const save=vi.fn().mockResolvedValue({ok:true,message:''});
 await make(getBomIndex,getPackIndex,unpackComponent,items,async()=>true,save,vi.fn(),vi.fn(),{current:true},a)(items[0]);
 expect(save).toHaveBeenCalledOnce();
 const [params]=save.mock.calls[0];
 expect(params.unitKg*params.count).toBe(200);expect(getBomIndex()).toBe(b);
});
it('실제 인스턴스 생명주기는 같은 회사에서 유지하고 회사 key 교체 시 종료한다',()=>{
 const hookStart=source.indexOf('  const unpackMounted =');
 const hookEnd=source.indexOf('  const inventoryItems',hookStart);
 const hook= new Function('useRef','useEffect',`${source.slice(hookStart,hookEnd)} return unpackMounted;`);
 const view=renderHook(()=>hook(useRef,useEffect));
 const mounted=view.result.current;
 expect(mounted.current).toBe(true);view.rerender();expect(view.result.current).toBe(mounted);
 view.unmount();expect(mounted.current).toBe(false);
});
it('실제 개봉 함수는 확인창 대기 이전 입력을 구성과 저장에 함께 사용한다',async()=>{
 setBomIndex(a.bom);
 let approve!:(yes:boolean)=>void;
 const confirmation=new Promise<boolean>(resolve=>{approve=resolve;});
 const save=vi.fn(async(params:{count:number;unitKg:number})=>{
  expect(params.unitKg*params.count).toBe(200);
  return{ok:true,message:''};
 });
 const run=make(getBomIndex,getPackIndex,unpackComponent,items,()=>confirmation,save,vi.fn(),vi.fn(),{current:true});
 const pending=run(items[0]);
 setBomIndex(b);approve(true);await pending;
 expect(save).toHaveBeenCalledOnce();
 expect(save.mock.calls[0][0].unitKg).toBe(20);
 expect(getBomIndex()).toBe(b);
});
it('확인을 취소하면 서비스 호출을 하지 않는다',async()=>{
 setBomIndex(a.bom);const save=vi.fn();
 await make(getBomIndex,getPackIndex,unpackComponent,items,async()=>false,save,vi.fn(),vi.fn(),{current:true})(items[0]);
 expect(save).not.toHaveBeenCalled();
});
it('회사 key 교체로 떠난 인스턴스의 늦은 확인은 쓰기를 시작하지 않는다',async()=>{
 setBomIndex(a.bom);let approve!:(yes:boolean)=>void;
 const confirmation=new Promise<boolean>(resolve=>{approve=resolve;});
 const save=vi.fn().mockResolvedValue({ok:true,message:''}), mounted={current:true};
 const pending=make(getBomIndex,getPackIndex,unpackComponent,items,()=>confirmation,save,vi.fn(),vi.fn(),mounted)(items[0]);
 mounted.current=false;approve(true);await pending;
 expect(save).not.toHaveBeenCalled();
});
it.each([true,false])('회사 전환 후 늦은 서비스 결과 ok=%s는 알림을 새 화면에 표시하지 않는다',async ok=>{
 setBomIndex(a.bom);let finish!:(value:{ok:boolean;message:string})=>void;
 const saved=new Promise<{ok:boolean;message:string}>(resolve=>{finish=resolve;});
 const save=vi.fn(()=>saved),toast=vi.fn(),alert=vi.fn(),mounted={current:true};
 const pending=make(getBomIndex,getPackIndex,unpackComponent,items,async()=>true,save,toast,alert,mounted)(items[0]);
 await Promise.resolve();expect(save).toHaveBeenCalledOnce();
 mounted.current=false;finish({ok,message:'이전 회사 결과'});await pending;
 expect(toast).not.toHaveBeenCalled();expect(alert).not.toHaveBeenCalled();
});
