/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {useEffect,useRef} from 'react';
import {renderHook} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex} from '../src/shared/packIndex';
import {stockKg} from '../src/shared/orderUnits';
import {anchorLotsByQty} from '../src/shared/lotAnchor';
import type {Item,RawMaterialLot} from '../src/shared/types';
const source=readFileSync('components/ItemList.tsx','utf8');
const start=source.indexOf('        const commit = async',source.indexOf('const listed = groupLooseBoxRows'));
const end=source.indexOf('\n        return (',start);
if(start<0||end<start)throw new Error('수동 재고 추가 함수 경계를 찾지 못했습니다.');
const compiled=ts.transpileModule(`${source.slice(start,end)} return commit;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const make=new Function('picked','makeBusy','setMakeBusy','items','isRawHolder','adjustStockByQty','stockKg','setToast','setIsAddModalOpen','orderUnitInputs','getBomIndex','getPackIndex','unpackMounted = {current:true}',compiled);
const items=['box1','box2','loose'].map(id=>({id,name:id,type:'product',unit:'개',spec:id==='loose'?'1kg':'1kg * 20',companyId:'taebaek',stock:0,minStock:0,image:''} as Item));
const inputs={bom:buildBomIndex(items,[{parent_id:'box1',child_id:'loose',quantity:20},{parent_id:'box2',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const other=buildBomIndex(items,[]),original=getBomIndex();
afterEach(()=>setBomIndex(original));
const mountedHook=()=>{
 const begin=source.indexOf('  const unpackMounted ='),end=source.indexOf('  const inventoryItems',begin);
 const hook=new Function('useRef','useEffect',`${source.slice(begin,end)} return unpackMounted;`);
 return renderHook(()=>hook(useRef,useEffect));
};
it.each([true,false])('첫 저장 결과 ok=%s 뒤 실제 회사 cleanup은 다음 쓰기와 늦은 화면 변경을 시작하지 않는다',async ok=>{
 setBomIndex(inputs.bom);const view=mountedHook();
 let finish!:(result:{ok:boolean;message:string})=>void;
 const first=new Promise<{ok:boolean;message:string}>(resolve=>{finish=resolve;});
 const write=vi.fn().mockReturnValueOnce(first).mockResolvedValue({ok:true,message:''});
 const busy=vi.fn(),toast=vi.fn(),close=vi.fn();
 const pending=make([['box1','1'],['box2','1']],false,busy,items,()=>false,write,stockKg,toast,close,inputs,getBomIndex,getPackIndex,view.result.current)();
 expect(write).toHaveBeenCalledOnce();view.unmount();finish({ok,message:''});await pending;
 expect(write).toHaveBeenCalledOnce();expect(toast).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 expect(busy.mock.calls).toEqual([[true]]);
});
it('같은 회사 정상 완료는 다음 품목과 기존 완료 안내·닫기·busy 해제를 유지한다',async()=>{
 const view=mountedHook(),write=vi.fn().mockResolvedValue({ok:true,message:''});
 const busy=vi.fn(),toast=vi.fn(),close=vi.fn();
 await make([['box1','1'],['box2','2']],false,busy,items,()=>false,write,stockKg,toast,close,inputs,getBomIndex,getPackIndex,view.result.current)();
 expect(write).toHaveBeenCalledTimes(2);expect(busy.mock.calls).toEqual([[true],[false]]);
 expect(toast).toHaveBeenCalledExactlyOnceWith({message:'2개 품목 재고를 늘렸습니다'});
 expect(close).toHaveBeenCalledExactlyOnceWith(false);view.unmount();
});
it('이미 떠난 회사의 수동 추가 실행은 첫 쓰기도 시작하지 않는다',async()=>{
 const view=mountedHook();view.unmount();const write=vi.fn().mockResolvedValue({ok:true,message:''});
 await make([['box1','1']],false,vi.fn(),items,()=>false,write,stockKg,vi.fn(),vi.fn(),inputs,getBomIndex,getPackIndex,view.result.current)();
 expect(write).not.toHaveBeenCalled();
});
const call=(picked:string[][],write:ReturnType<typeof vi.fn>,provided?:typeof inputs,products=items)=>make(picked,false,vi.fn(),products,()=>false,write,stockKg,vi.fn(),vi.fn(),provided,getBomIndex,getPackIndex)();
it('회사 입력이 있는 수동 추가는 다른 전역 BOM에서도 새 로트1개20kg를 만든다',async()=>{
 setBomIndex(other);let saved:RawMaterialLot[]=[];
 const write=vi.fn(async(params:{deltaQty:number;unitKg:number})=>{
  saved=anchorLotsByQty({lots:[],targetQty:params.deltaQty,unitKg:params.unitKg,det:{id:'manual',createdAt:'2026-10-07',receivedDate:'2026-10-07'}}).lots;
  return{ok:true,message:''};
 });
 await call([['box1','1']],write,inputs);
 expect(saved[0]).toMatchObject({qtyRemaining:1,kgRemaining:20});expect(getBomIndex()).toBe(other);
});
it('입력 생략도 첫 품목 저장 대기 전 기준을 모든 다음 품목에 유지한다',async()=>{
 setBomIndex(inputs.bom);
 const write=vi.fn(async(_params:{unitKg:number;deltaQty:number})=>{setBomIndex(other);return{ok:true,message:''};});
 await call([['box1','1'],['box2','2']],write);
 expect(write.mock.calls.map(row=>row[0].unitKg)).toEqual([20,20]);
 expect(write.mock.calls.map(row=>row[0].deltaQty)).toEqual([1,2]);expect(getBomIndex()).toBe(other);
});
it('기존 로트 무게를 우선하고 수동 입력은 밀도나 개입수로 다시 곱하지 않는다',async()=>{
 setBomIndex(other);let saved:RawMaterialLot[]=[];
 const lot:RawMaterialLot={id:'old',supplierName:'공급자',qtyIn:1,qtyRemaining:1,unitKg:7,kgIn:7,kgRemaining:7,status:'active',receivedDate:'2026-10-01',createdAt:'2026-10-01'};
 const write=vi.fn(async(params:{deltaQty:number;unitKg:number})=>{
  saved=anchorLotsByQty({lots:[lot],targetQty:1+params.deltaQty,unitKg:lot.unitKg??params.unitKg,det:{id:'manual',createdAt:'2026-10-07',receivedDate:'2026-10-07'}}).lots;
  return{ok:true,message:''};
 });
 await call([['box1','1']],write,inputs,items.map(item=>({...item,density:1.2})));
 expect(write.mock.calls[0][0].deltaQty).toBe(1);
 expect(saved.reduce((sum,row)=>sum+(row.qtyRemaining??0),0)).toBe(2);
 expect(saved.reduce((sum,row)=>sum+row.kgRemaining,0)).toBe(14);
});
