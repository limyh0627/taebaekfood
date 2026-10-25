/** @vitest-environment jsdom */
import {afterEach,expect,it} from 'vitest';
import {useMemo} from 'react';
import {renderHook} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,getBomIndex,setBomIndex,bomOf,packingSubmaterials} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex,packUnitsOf} from '../src/shared/packIndex';
import {groupLooseBoxRows,unpackComponent,packBreakdown,unitsPerBoxOf,itemKg,unpackQty,type OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
const source=readFileSync('components/ItemList.tsx','utf8');
const items=['box','loose'].map(id=>({id,name:id,type:'product',companyId:'taebaek',unit:'개',spec:'1kg',stock:20,minStock:0,image:''} as Item));
const a:OrderUnitInputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex([{item_id:'loose',units_per_box:20}])};
const b:OrderUnitInputs={bom:buildBomIndex(items,[]),pack:buildPackIndex([{item_id:'loose',units_per_box:10}])};
const originalBom=getBomIndex(),originalPack=getPackIndex();
afterEach(()=>{setBomIndex(originalBom);setPackIndex(originalPack);});
it.each(['unitsPerBoxOf','itemKg','unpackQty'])('실제 %s 잔여 호출은 명시 입력·빈 구성·기존 fallback을 구분한다',name=>{
 const parsed=ts.createSourceFile('ItemList.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const calls:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===name)calls.push(node.getText(parsed));ts.forEachChild(node,visit);};
 visit(parsed);expect(calls.length).toBeGreaterThan(0);

 setBomIndex(b.bom);setPackIndex(b.pack);
 const empty={bom:buildBomIndex([],[]),pack:buildPackIndex([])};
 for(const call of calls){
  const run=new Function('unitsPerBoxOf','itemKg','unpackQty','items','product','item','c','orderUnitInputs','target','inputs',`return ${call};`);
  const evaluate=(inputs?:OrderUnitInputs)=>run(unitsPerBoxOf,itemKg,unpackQty,items,items[0],{...items[0],spec:'1kg * 20',itemId:'box',qty:2},{id:'box'},inputs,{...items[0],spec:'1kg * 20'},inputs ?? {bom:getBomIndex(),pack:getPackIndex()});
  const expected=name==='unitsPerBoxOf'?20:name==='itemKg'?20:40;
  expect(evaluate(a)).toBe(expected);
  expect(evaluate(empty)).toBe(name==='unitsPerBoxOf'?0:name==='itemKg'?1:2);
  expect(evaluate()).toBe(name==='unitsPerBoxOf'?0:name==='itemKg'?1:2);
 }
 for(const expression of calls){const call=ts.createSourceFile('call.ts',expression,ts.ScriptTarget.Latest,true).statements[0] as ts.ExpressionStatement;expect(ts.isCallExpression(call.expression)).toBe(true);const args=(call.expression as ts.CallExpression).arguments;const input=args[name==='unpackQty'?3:1];expect(input).toBeDefined();expect(['orderUnitInputs','inputs']).toContain(input.getText());}
 expect(getBomIndex()).toBe(b.bom);expect(getPackIndex()).toBe(b.pack);
});
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

const packagingItems=[{id:'made',name:'완제품',type:'product'},{id:'cap-a',name:'태백 캡',type:'submaterial'},{id:'cap-b',name:'풍회 캡',type:'submaterial'},{id:'bulk',name:'벌크',type:'submaterial',subtype:'bulk'},{id:'phantom',name:'배합',type:'submaterial',phantom:true}] as Item[];
const packagingA:OrderUnitInputs={bom:buildBomIndex(packagingItems,[{parent_id:'made',child_id:'cap-a',quantity:1},{parent_id:'made',child_id:'bulk',quantity:1},{parent_id:'made',child_id:'phantom',quantity:1}]),pack:a.pack};
const packagingB:OrderUnitInputs={bom:buildBomIndex(packagingItems,[{parent_id:'made',child_id:'cap-b',quantity:1}]),pack:b.pack};
const displayParts=(name:string,provided?:OrderUnitInputs)=>{
 const matches=[...source.matchAll(new RegExp(`const ${name} = ([^;]+);`,'g'))];
 const match=matches.find(row=>name==='subs'?row[1].includes('p.id'):row[1].includes('product?.id'));
 if(!match)throw new Error('실제 구성 표시 표현식이 없습니다.');
 const code=ts.transpileModule(`return ${match[1]};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('p','product','bomOf','packingSubmaterials','isBulkItem','orderUnitInputs',code)(packagingItems[0],packagingItems[0],bomOf,packingSubmaterials,(item:Item)=>item.subtype==='bulk',provided) as Array<Item|{childId:string}>;
};
it('재고 만들기 실제 구성 표시는 다른 회사 전역과 독립적이고 기존 fallback을 보존한다',()=>{
 setBomIndex(packagingB.bom);
 expect(displayParts('subs',packagingA).map(row=>(row as {childId:string}).childId)).toEqual(['cap-a','bulk','phantom']);
 expect(displayParts('subs',packagingB).map(row=>(row as {childId:string}).childId)).toEqual(['cap-b']);
 expect(displayParts('subs').map(row=>(row as {childId:string}).childId)).toEqual(['cap-b']);
 expect(getBomIndex()).toBe(packagingB.bom);
});
it('상세 실제 포장 chip은 회사 입력을 쓰며 벌크·배합 제외와 fallback을 보존한다',()=>{
 setBomIndex(packagingB.bom);
 expect(displayParts('chips',packagingA).map(row=>(row as Item).id)).toEqual(['cap-a']);
 expect(displayParts('chips',packagingB).map(row=>(row as Item).id)).toEqual(['cap-b']);
 expect(displayParts('chips').map(row=>(row as Item).id)).toEqual(['cap-b']);
 expect(getBomIndex()).toBe(packagingB.bom);
});
import {shipDeductions,shipQtyOfLine} from '../src/shared/shipDeduction';
import {OrderStatus} from '../src/shared/types';
import {isStockProduction} from '../src/shared/orderPurpose';
const shippingItems=[...items,{...items[1],id:'goods',procureType:'완사입'}] as Item[];
const shippingA={...a,pack:buildPackIndex([{item_id:'goods',units_per_box:12}])};
const shippingB={bom:b.bom,pack:buildPackIndex([{item_id:'goods',units_per_box:4}])};
const shippingLines=[{itemId:'box',quantity:40,isBoxUnit:true,boxQuantity:2,checked:true},{itemId:'goods',quantity:2,isBoxUnit:true,boxQuantity:2,checked:true},{itemId:'goods',quantity:1,isBoxUnit:true,boxQuantity:1,checked:true}];
const shippingOrder={items:shippingLines};
it('출고 확인 실제 호출은 회사 구성으로 여러 품목 수량과 표 단위를 함께 계산한다',()=>{
 setBomIndex(shippingB.bom);setPackIndex(shippingB.pack);
 const orderSource=readFileSync('components/OrdersList.tsx','utf8');
 const call=orderSource.match(/shipDeductions\(order, items[^)]*\)/)?.[0];
 expect(call).toBeTruthy();
 const run=new Function('shipDeductions','order','items','orderUnitInputs',`return ${call};`);
 const evaluate=(input?:OrderUnitInputs)=>run(shipDeductions,shippingOrder,shippingItems,input).map((row:any)=>[row.itemId,row.qty,row.unit]);
 expect(evaluate(shippingA)).toEqual([['box',2,'박스'],['goods',36,'개']]);
 expect(evaluate({bom:buildBomIndex([],[]),pack:buildPackIndex([])})).toEqual([['box',40,'개'],['goods',3,'개']]);
 expect(evaluate()).toEqual([['box',40,'개'],['goods',12,'개']]);
 expect(getBomIndex()).toBe(shippingB.bom);expect(getPackIndex()).toBe(shippingB.pack);
});
it('실제 출고예정 합계 memo는 회사 입력 변경을 반영하고 제외 상태·미완료·재고생산을 보존한다',()=>{
 setBomIndex(shippingB.bom);setPackIndex(shippingB.pack);
 const begin=source.indexOf('  const scheduledOutboundQty ='),finish=source.indexOf('  // 품목 → 매출처',begin);
 const js=ts.transpileModule(`${source.slice(begin,finish)} return scheduledOutboundQty;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=new Function('useMemo','orders','items','OrderStatus','isStockProduction','shipQtyOfLine','orderUnitInputs',js);
 const orders=[{status:OrderStatus.PENDING,items:shippingLines},{status:OrderStatus.PROCESSING,items:[{...shippingLines[1],boxQuantity:1}]},{status:OrderStatus.DELIVERED,items:shippingLines},{status:OrderStatus.DISPATCHED,purpose:'stock-production',items:shippingLines},{status:OrderStatus.PENDING,items:[{...shippingLines[1],checked:false}]}];
 const view=renderHook(({input})=>run(useMemo,orders,shippingItems,OrderStatus,isStockProduction,shipQtyOfLine,input),{initialProps:{input:shippingA}});
 expect([...view.result.current]).toEqual([['box',2],['goods',48]]);
 view.rerender({input:shippingB});expect([...view.result.current]).toEqual([['box',40],['goods',16]]);
 expect(getBomIndex()).toBe(shippingB.bom);expect(getPackIndex()).toBe(shippingB.pack);
});
