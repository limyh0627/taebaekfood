/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,within} from '@testing-library/react';
import ItemManager from './ItemManager';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
const original=getBomIndex();
afterEach(()=>setBomIndex(original));
const items=(companyId:'taebaek'|'punghoe')=>[
 {id:'oil',name:'기름',spec:'300ml',unit:'병',type:'product',stock:0,minStock:0,image:'',companyId},
 {id:'other',name:'기름',spec:'300ml',unit:'병',type:'product',stock:0,minStock:0,image:'',companyId},
 {id:'cap',name:companyId==='taebaek'?'태백 캡':'풍회 캡',unit:'개',type:'submaterial',stock:0,minStock:0,image:'',companyId},
] as Item[];
const inputs=(rows:Item[],same=true):OrderUnitInputs=>({bom:buildBomIndex(rows,[{parent_id:'oil',child_id:'cap',quantity:1},{parent_id:'other',child_id:'cap',quantity:same?1:2}]),pack:buildPackIndex([])});
const props=(rows:Item[],orderUnitInputs?:OrderUnitInputs)=>({companyId:rows[0].companyId!,items:rows,orderUnitInputs,partners:[],onEditProduct:vi.fn(),onAddItem:vi.fn(),onDeleteItem:vi.fn(),onLinkItem:vi.fn(),onUnlinkItem:vi.fn()});
it('두 회사 품목 표시와 중복 그룹은 명시 BOM을 쓰고 전역 교체에도 유지된다',()=>{
 const a=items('taebaek'),b=items('punghoe'),ai=inputs(a),bi=inputs(b,false);
 setBomIndex(bi.bom);
 const first=render(<ItemManager {...props(a,ai)}/>);
 expect(within(first.container).getAllByText('태백 캡').length).toBeGreaterThan(0);
 expect(within(first.container).queryByText('풍회 캡')).toBeNull();
 fireEvent.click(within(first.container).getByRole('button',{name:/중복 품목/}));
 expect(within(first.container).getByText('이름+BOM 같은 것 1그룹')).toBeInTheDocument();
 setBomIndex(ai.bom);
 const second=render(<ItemManager {...props(b,bi)}/>);
 expect(within(second.container).getAllByText('풍회 캡').length).toBeGreaterThan(0);
 fireEvent.click(within(second.container).getByRole('button',{name:/중복 품목/}));
 expect(within(second.container).getByText('이름+BOM 같은 것 0그룹')).toBeInTheDocument();
 first.rerender(<ItemManager {...props(a,inputs(a,false))}/>);
 expect(within(first.container).getByText('이름+BOM 같은 것 0그룹')).toBeInTheDocument();
 expect(getBomIndex()).toBe(ai.bom);
});
it('명시 입력 없는 기존 호출은 전역 BOM 표시를 유지한다',()=>{
 const b=items('punghoe'),bi=inputs(b);setBomIndex(bi.bom);
 const view=render(<ItemManager {...props(b)}/>);
 expect(within(view.container).getAllByText('풍회 캡').length).toBeGreaterThan(0);
 expect(getBomIndex()).toBe(bi.bom);
});
it('박스 판정과 묶음도 같은 명시 입력을 사용하고 입력 변경을 반영한다',()=>{
 const rows=items('taebaek');
 const boxed:OrderUnitInputs={bom:buildBomIndex(rows,[{parent_id:'other',child_id:'oil',quantity:10}]),pack:buildPackIndex([])};
 const loose:OrderUnitInputs={bom:buildBomIndex(rows,[]),pack:buildPackIndex([])};
 setBomIndex(loose.bom);
 const view=render(<ItemManager {...props(rows,boxed)} onCreateBoxItem={vi.fn()}/>);
 expect(within(view.container).getAllByTitle('이 낱개로 박스 품목 만들기')).toHaveLength(1);
 setBomIndex(boxed.bom);
 view.rerender(<ItemManager {...props(rows,loose)} onCreateBoxItem={vi.fn()}/>);
 expect(within(view.container).getAllByTitle('이 낱개로 박스 품목 만들기')).toHaveLength(2);
 expect(getBomIndex()).toBe(boxed.bom);
});
