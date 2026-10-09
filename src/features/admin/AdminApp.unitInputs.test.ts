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
  const scope={unpackComponent,stockUnits,unitsPerBoxOf,bomOf,docSaleLines,boxSpecUpdates,allItems,boxItem:box,product:box,p,품목:box,푸는품목:box,완료품목:box,it:{quantity:40,boxQuantity:2},item:{quantity:40,boxQuantity:2},완료줄:{quantity:40,boxQuantity:2}};
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
