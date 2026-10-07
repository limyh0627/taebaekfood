/** @vitest-environment jsdom */
import {afterEach,expect,it} from 'vitest';
import {useMemo} from 'react';
import {renderHook} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex,packUnitsOf} from '../src/shared/packIndex';
import {groupLooseBoxRows,unpackComponent,packBreakdown,type OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
const source=readFileSync('components/ItemList.tsx','utf8');
const items=['box','loose'].map(id=>({id,name:id,type:'product',companyId:'taebaek',unit:'개',spec:'1kg',stock:20,minStock:0,image:''} as Item));
const a:OrderUnitInputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex([{item_id:'loose',units_per_box:20}])};
const b:OrderUnitInputs={bom:buildBomIndex(items,[]),pack:buildPackIndex([{item_id:'loose',units_per_box:10}])};
const originalBom=getBomIndex(),originalPack=getPackIndex();
afterEach(()=>{setBomIndex(originalBom);setPackIndex(originalPack);});
const start=source.indexOf('  const groupedRows ='),end=source.indexOf('  const visibleRows =',start);
const compiled=ts.transpileModule(`${source.slice(start,end)} return groupedRows;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const grouped=new Function('useMemo','filteredProducts','topTab','unpackComponent','orderUnitInputs',compiled);
const expression=(name:string)=>{
 const match=source.match(new RegExp(`const ${name} = ([^;]+);`));
 if(!match)throw new Error(`실제 ${name} 표현식이 없습니다.`);
 return new Function('product','stock','unpackComponent','packBreakdown','packUnitsOf','orderUnitInputs',`return ${match[1]};`);
};
it('실제 회사별 묶음 memo는 다른 전역을 무시하고 같은 회사 입력 변경도 반영한다',()=>{
 setBomIndex(b.bom);
 const view=renderHook(({inputs})=>grouped(useMemo,items,'finished',unpackComponent,inputs),{initialProps:{inputs:a}});
 expect(view.result.current.map((r:{p:Item;isChild:boolean})=>[r.p.id,r.isChild])).toEqual([['loose',false],['box',true]]);
 const other=renderHook(()=>grouped(useMemo,items,'finished',unpackComponent,b));
 expect(other.result.current.every((r:{isChild:boolean})=>!r.isChild)).toBe(true);
 view.rerender({inputs:b});expect(view.result.current.every((r:{isChild:boolean})=>!r.isChild)).toBe(true);
 expect(getBomIndex()).toBe(b.bom);
});
it('공유 목록 묶음은 명시 입력과 기존 전역 fallback을 구분한다',()=>{
 setBomIndex(b.bom);
 const group=groupLooseBoxRows as (arr:Item[],inputs?:OrderUnitInputs)=>{p:Item;isChild:boolean}[];
 expect(group(items,a).map(r=>[r.p.id,r.isChild])).toEqual([['loose',false],['box',true]]);
 expect(group(items).every(r=>!r.isChild)).toBe(true);
});
it.each(['listedItems','baseClosingItems'])('실제 %s 목록 호출도 회사 입력을 전달한다',name=>{
 setBomIndex(b.bom);
 const call=source.match(new RegExp(`groupLooseBoxRows\\(${name}[^)]*\\)`));
 if(!call)throw new Error('실제 목록 묶음 호출이 없습니다.');
 const run=new Function('groupLooseBoxRows',name,'orderUnitInputs',`return ${call[0]};`);
 expect(run(groupLooseBoxRows,items,a).map((r:{p:Item;isChild:boolean})=>[r.p.id,r.isChild])).toEqual([['loose',false],['box',true]]);
});
it('상세 개봉 버튼의 실제 판정은 회사 박스 구성을 사용한다',()=>{
 setBomIndex(b.bom);
 expect(expression('directUnpack')(items[0],0,unpackComponent,packBreakdown,packUnitsOf,a)).toEqual({itemId:'loose',count:20});
 expect(expression('directUnpack')(items[0],0,unpackComponent,packBreakdown,packUnitsOf,b)).toBeNull();
});
it('포장 요약은 회사 포장표를 사용하며 박스 SKU를 재환산하지 않는다',()=>{
 setPackIndex(b.pack);const display=expression('txt');
 expect(display(items[1],20,unpackComponent,packBreakdown,packUnitsOf,a)).toBe(packBreakdown(20,20));
 expect(display(items[0],20,unpackComponent,packBreakdown,packUnitsOf,a)).toBe(packBreakdown(20,0));
 expect(display(items[1],20,unpackComponent,packBreakdown,packUnitsOf,undefined)).toBe(packBreakdown(20,10));
});
