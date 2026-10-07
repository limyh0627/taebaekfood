/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {useEffect,useRef} from 'react';
import {renderHook} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {getPackIndex} from '../src/shared/packIndex';
import {stockKg,stocktakeStoredQuantity} from '../src/shared/orderUnits';
import {anchorLotsByQty} from '../src/shared/lotAnchor';
import type {Item,RawMaterialLot} from '../src/shared/types';
const source=readFileSync('components/ItemList.tsx','utf8');
const commitStart=source.indexOf('  const commitStockEdit =');
const commitEnd=source.indexOf('  // 박스 개봉',commitStart);
const zeroTitle=source.indexOf('title="재고 0으로"');
const zeroStart=source.lastIndexOf('onClick={async () => {',zeroTitle)+'onClick={async () => {'.length;
const zeroEnd=source.lastIndexOf('}}',zeroTitle);
const code=ts.transpileModule(`${source.slice(commitStart,commitEnd)} return async () => {${source.slice(zeroStart,zeroEnd)}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const make=new Function('product','items','appConfirm','stocktakeByQty','stocktakeStoredQuantity','stockKg','getBomIndex','getPackIndex','isRawHolder','setToast','stockEdit','disp','cur','unpackMounted = {current:true}',code);
const items=['box','loose'].map(id=>({id,name:id,type:'product',companyId:'taebaek',unit:'개',spec:id==='box'?'1kg * 20':'1kg',stock:2,minStock:0,image:''} as Item));
const a=buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),b=buildBomIndex(items,[]),original=getBomIndex();
afterEach(()=>setBomIndex(original));
it.each([[false,false],[true,false],[false,true],[true,true]])('재고0 기존로트=%s BOM교체=%s에서 작업완료2개와 무게를 보존한다',async(existing,swap)=>{
 setBomIndex(a);let approve!:(value:boolean)=>void;
 const confirm=new Promise<boolean>(resolve=>{approve=resolve;});
 const lots:RawMaterialLot[]=existing?[{id:'existing',material:'box',supplierName:'기존 공급자',qtyIn:2,qtyRemaining:2,unitKg:7,kgIn:14,kgRemaining:14,status:'active',receivedDate:'2026-10-01',createdAt:'2026-10-01'}]:[];
 let savedKg:number|undefined;
 const write=vi.fn(async(params:{targetQty:number;unitKg:number})=>{
  const result=anchorLotsByQty({lots,targetQty:params.targetQty,unitKg:lots.find(lot=>lot.unitKg)?.unitKg??params.unitKg,det:{id:'anchor',createdAt:'2026-10-07',receivedDate:'2026-10-07'}});
  savedKg=result.lots.reduce((sum,lot)=>sum+(lot.kgRemaining??0),0);
  return{ok:true,message:''};
 });
 const pending=make(items[0],items,()=>confirm,write,stocktakeStoredQuantity,stockKg,getBomIndex,getPackIndex,()=>false,vi.fn(),true,2,2)();
 if(swap)setBomIndex(b);approve(true);await pending;await Promise.resolve();
 expect(write).toHaveBeenCalledOnce();expect(write.mock.calls[0][0].targetQty).toBe(2);
 expect(savedKg).toBe(existing?14:40);expect(getBomIndex()).toBe(swap?b:a);
});
it('재고0 확인 취소는 실사 서비스를 호출하지 않는다',async()=>{
 setBomIndex(a);const write=vi.fn();
 await make(items[0],items,async()=>false,write,stocktakeStoredQuantity,stockKg,getBomIndex,getPackIndex,()=>false,vi.fn(),true,2,2)();
 expect(write).not.toHaveBeenCalled();
});
it('실제 회사 인스턴스 cleanup 뒤 늦은 재고0 확인은 쓰기를 시작하지 않는다',async()=>{
 setBomIndex(a);
 const hookStart=source.indexOf('  const unpackMounted ='),hookEnd=source.indexOf('  const inventoryItems',hookStart);
 const hook=new Function('useRef','useEffect',`${source.slice(hookStart,hookEnd)} return unpackMounted;`);
 const view=renderHook(()=>hook(useRef,useEffect));
 let approve!:(yes:boolean)=>void;const confirm=new Promise<boolean>(resolve=>{approve=resolve;});
 const write=vi.fn().mockResolvedValue({ok:true,message:''});
 const pending=make(items[0],items,()=>confirm,write,stocktakeStoredQuantity,stockKg,getBomIndex,getPackIndex,()=>false,vi.fn(),true,2,2,view.result.current)();
 view.unmount();approve(true);await pending;
 expect(write).not.toHaveBeenCalled();
});
