/** @vitest-environment jsdom */
import React from 'react';
import {render,screen} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {afterEach,expect,it} from 'vitest';
import {buildBomIndex,getBomIndex,setBomIndex,bomOf} from '../src/shared/bomIndex';
import {unpackComponent,unitsPerBoxOf} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
const items=[{id:'oil',name:'참기름',type:'product',spec:'1kg',stock:1},{id:'box',name:'BOM 박스',type:'submaterial',category:'박스',stock:0},{id:'old',name:'옛 거래처 박스',type:'submaterial',category:'박스',stock:0}] as Item[];
const original=getBomIndex();afterEach(()=>setBomIndex(original));
const compile=(expression:string,deps:Record<string,unknown>)=>{
 const code=ts.transpileModule(`const result=${expression};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 return new Function(...Object.keys(deps),`${code};return result;`)(...Object.values(deps));
};
it('주문 부족분은 BOM 포장 수량만 세고 옛 거래처 포장을 더하지 않는다',()=>{
 setBomIndex(buildBomIndex(items,[{parent_id:'oil',child_id:'box',quantity:1}]));
 const source=readFileSync('components/AddOrderModal.tsx','utf8');const file=ts.createSourceFile('AddOrderModal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
 const find=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='shortages')expression=node.initializer;ts.forEachChild(node,find);};find(file);if(!expression)throw new Error('실제 부족분 계산 없음');
 const result=compile(expression.getText(file),{useMemo:(fn:()=>unknown)=>fn(),selectedItems:[{itemId:'oil',quantity:20,isBoxUnit:false,unitsPerBox:0}],selectedPartner:{id:'partner'},products:items,items,submaterials:items.filter(p=>p.type==='submaterial'),partnerOut:[{itemId:'oil',partnerId:'partner',boxTypeId:'old',qtyPerBox:10}],unitsPerBoxOf,unpackComponent,bomOf});
 expect(result).toEqual([{name:'BOM 박스',needed:20,stock:0}]);
});
it('복사 주문의 포장 표시도 BOM만 사용한다',()=>{
 setBomIndex(buildBomIndex(items,[{parent_id:'oil',child_id:'box',quantity:1}]));
 const source=readFileSync('components/PasteOrderModal.tsx','utf8');const start=source.indexOf('{matched && (() => {')+'{matched && (() => {'.length;const end=source.indexOf('                      return (',start);const body=source.slice(start,end);
 const code=ts.transpileModule(`${body}\nreturn subs;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const result=new Function('matched','items','partnerOut','selectedClient','bomOf',code)(items[0],items,[{itemId:'oil',partnerId:'partner',boxTypeId:'old',tapeTypeId:'old'}],{id:'partner'},bomOf);
 expect(result).toEqual(['BOM 박스']);
});
it('품목 중복 대조의 거래처 줄은 구형 박스·테이프 설정을 표시하지 않는다',()=>{
 const source=readFileSync('components/ItemManager.tsx','utf8');const file=ts.createSourceFile('ItemManager.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.CallExpression|undefined;
 const find=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='pcs.map')expression=node;ts.forEachChild(node,find);};find(file);if(!expression)throw new Error('실제 거래처 표시 없음');
 const result=compile(expression.getText(file),{React,pcs:[{id:'link',partnerId:'partner',boxTypeId:'old',tapeTypeId:'old',qtyPerBox:10}],partners:[{id:'partner',name:'현재 거래처'}],subMap:{old:'옛 거래처 박스'}});render(<>{result}</>);
 expect(screen.getByText('현재 거래처')).toBeInTheDocument();expect(screen.queryAllByText(/옛 거래처 박스|개\/박스|박스 없음|테이프 없음/)).toHaveLength(0);
});
