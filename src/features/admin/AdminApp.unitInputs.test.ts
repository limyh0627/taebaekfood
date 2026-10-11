/** @vitest-environment jsdom */
import {afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBomIndex,bomOf,getBomIndex,setBomIndex} from '../../shared/bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from '../../shared/packIndex';
import {unpackComponent,stockUnits,unitsPerBoxOf,type OrderUnitInputs} from '../../shared/orderUnits';
import {docSaleLines} from '../../shared/docOil';
import {boxSpecUpdates} from '../../shared/boxSpec';
import type {Item} from '../../shared/types';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const parsed=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const box={id:'box',name:'상자',type:'product',unit:'박스',spec:'350ml * 10',품목:'참기름',stock:0,minStock:0,image:''} as Item;
const loose={...box,id:'loose',name:'낱개',unit:'병',spec:'350ml'};
const allItems=[box,loose];
const inputs=(count:number,pack:number):OrderUnitInputs=>({bom:buildBomIndex(allItems,[{parent_id:'box',child_id:'loose',quantity:count}]),pack:buildPackIndex([{item_id:'loose',units_per_box:pack}])});
const own=inputs(20,12),other=inputs(6,4),empty={bom:buildBomIndex([],[]),pack:buildPackIndex([])};
const originalBom=getBomIndex(),originalPack=getPackIndex();
afterEach(()=>{setBomIndex(originalBom);setPackIndex(originalPack);});
const names=['unpackComponent','stockUnits','unitsPerBoxOf','bomOf','docSaleLines','boxSpecUpdates'];
const calls=(name:string)=>{
 const found:string[]=[];
 const visit=(node:ts.Node)=>{
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===name){
   const selected=name==='bomOf'&&ts.isConditionalExpression(node.parent)?node.parent:node;
   found.push(selected.getText(parsed));
  }
  ts.forEachChild(node,visit);
 };visit(parsed);return found;
};
it.each(names)('실제 호스트 %s 호출은 회사 입력·빈 구성·fallback 계산을 보존한다',name=>{
 setBomIndex(other.bom);setPackIndex(other.pack);
 const rows=calls(name);expect(rows.length).toBeGreaterThan(0);
 for(const expression of rows){
  const p=name==='boxSpecUpdates'?loose:box;
  const scope={ds:{docPumokAt:undefined},id:'box',unpackComponent,stockUnits,unitsPerBoxOf,bomOf,docSaleLines,boxSpecUpdates,allItems,boxItem:box,product:box,p,품목:box,푸는품목:box,완료품목:box,it:{quantity:40,boxQuantity:2},item:{quantity:40,boxQuantity:2},완료줄:{quantity:40,boxQuantity:2}};
  const run=new Function(...Object.keys(scope),'appData',`return (${expression});`);
  const evaluate=(provided?:OrderUnitInputs)=>run(...Object.values(scope),{orderUnitInputs:provided});
  const expected=(count:number|undefined)=>name==='unpackComponent'?(count?{itemId:'loose',count}:null):name==='stockUnits'?(count?2:40):name==='unitsPerBoxOf'?(count??0):name==='bomOf'?(count?[{childId:'loose',qty:count,child:loose}]:[]):name==='boxSpecUpdates'?(count?[{id:'box',name:box.name,from:box.spec,spec:`350ml * ${count}`}]:[]):[{품목:'참기름',spec:count?'350ml':box.spec,qty:count?2*count:40}];
  expect(evaluate(own)).toEqual(expected(20));
  expect(evaluate(empty)).toEqual(expected(undefined));
  expect(evaluate()).toEqual(expected(6));
  if(name==='unitsPerBoxOf'){
   expect(run(...Object.values({...scope,product:loose}),{orderUnitInputs:own})).toBe(12);
   expect(run(...Object.values({...scope,product:loose}),{orderUnitInputs:empty})).toBe(0);
   expect(run(...Object.values({...scope,product:loose}),{orderUnitInputs:undefined})).toBe(4);
  }
  setBomIndex(empty.bom);setPackIndex(empty.pack);
  expect(evaluate(own)).toEqual(expected(20));
  setBomIndex(other.bom);setPackIndex(other.pack);
 }
 expect(getBomIndex()).toBe(other.bom);expect(getPackIndex()).toBe(other.pack);
});
import {shipQtyOfLine} from '../../shared/shipDeduction';
import {buildRollbackPlan} from './rollbackSummary';
import {OrderStatus} from '../../shared/types';
it.each(['shipQtyOfLine','buildRollbackPlan'])('실제 호스트 %s 되돌리기 경계도 회사 입력을 사용한다',name=>{
 setBomIndex(other.bom);setPackIndex(other.pack);
 const line={itemId:'box',quantity:40,boxQuantity:2,isBoxUnit:true};
 const current={items:[line],status:OrderStatus.SHIPPED,shippedOut:true};
 const scope={shipQtyOfLine,buildRollbackPlan,cur:current,allItems,status:OrderStatus.PROCESSING,줄:line,품목:box,푸는품목:box,normalizedOrder:current,itemIdx:0,줄상태:{producedUnits:[{itemId:'box',qty:2}],rawConsumedLots:[],autoBuilt:[],completedAt:'2026-10-09'},OrderStatus};
 for(const expression of calls(name)){
  const js=ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const run=new Function(...Object.keys(scope),'appData',js);
  const evaluate=(provided?:OrderUnitInputs)=>run(...Object.values(scope),{orderUnitInputs:provided});
  if(name==='shipQtyOfLine'){
   expect(evaluate(own)).toBe(2);expect(evaluate(empty)).toBe(40);expect(evaluate()).toBe(2);
  }else{
   const result=evaluate(own);
   if(expression.includes('cur,'))expect(result.adjustments[0].delta).toBe(2);
   else expect(result.adjustments.find((r:any)=>r.itemId==='loose')?.delta).toBe(40);
   const emptyResult=evaluate(empty);
   if(expression.includes('cur,'))expect(emptyResult.adjustments[0].delta).toBe(40);
   else expect(emptyResult.adjustments.some((r:any)=>r.itemId==='loose')).toBe(false);
  }
 }
});
import {useMemo} from 'react';
import {renderHook} from '@testing-library/react';
import {orderLinesUsingRaw} from '../../shared/rawUsers';
it('호스트 원료 사용 줄 memo는 회사 BOM 갱신을 반영한다',()=>{
 const raw={...loose,id:'raw',name:'깨분',subtype:'벌크'} as Item;
 const rawItems=[box,raw];
 const rawOwn={bom:buildBomIndex(rawItems,[{parent_id:'box',child_id:'raw',quantity:1}]),pack:own.pack};
 setBomIndex(empty.bom);
 const begin=source.indexOf('  const linesUsingRaw ='),finish=source.indexOf('// 재고평가',begin);
 const js=ts.transpileModule(`${source.slice(begin,finish)} return linesUsingRaw;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=new Function('useMemo','allItems','bomOf','buildFormulaBom','itemFormulas','baseRawName','orderLinesUsingRaw','appData',js);
 const formulas:any[]=[];
 const view=renderHook(({input})=>run(useMemo,rawItems,bomOf,()=>[],formulas,(name:string)=>name,orderLinesUsingRaw,{orderUnitInputs:input}),{initialProps:{input:rawOwn}});
 const order={items:[{itemId:'box'},{itemId:'unknown'}]};
 expect(view.result.current(order,'깨분')).toEqual([{itemId:'box'}]);
 view.rerender({input:empty});expect(view.result.current(order,'깨분')).toBeUndefined();
});
