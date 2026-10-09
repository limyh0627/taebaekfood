/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,within} from '@testing-library/react';
import AddOrderModal from './AddOrderModal';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from '../src/shared/packIndex';
import type {OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item,Partner,PartnerItem} from '../src/shared/types';
const original=getBomIndex();
const originalPack=getPackIndex();
afterEach(()=>{setBomIndex(original);setPackIndex(originalPack);});
const products=(companyId:'taebaek'|'punghoe')=>[
 {id:'oil',name:'기름',spec:'300ml',unit:'병',type:'product',stock:10,minStock:0,image:'',companyId},
 {id:'cap',name:companyId==='taebaek'?'태백 캡':'풍회 캡',unit:'개',type:'submaterial',stock:10,minStock:0,image:'',companyId},
] as Item[];
const inputs=(items:Item[]):OrderUnitInputs=>({bom:buildBomIndex(items,[{parent_id:'oil',child_id:'cap',quantity:1}]),pack:buildPackIndex([])});
const props=(items:Item[],orderUnitInputs?:OrderUnitInputs)=>({items,orderUnitInputs,orders:[],partners:[{id:'partner',name:'거래처',type:'일반',companyId:items[0].companyId} as Partner],partnerItems:[{id:'link',itemId:'oil',partnerId:'partner',Direction:'out',price:1000} as PartnerItem],palletStocks:[],onClose:vi.fn(),onSave:vi.fn(async()=>{})});
it('실제 두 주문 모달의 포장 chip은 각 회사 입력을 쓰며 상대 전역 변경에 간섭받지 않는다',()=>{
 const a=products('taebaek'),b=products('punghoe'),ai=inputs(a),bi=inputs(b);
 setBomIndex(bi.bom);
 const first=render(<AddOrderModal {...props(a,ai)}/>);
 fireEvent.click(within(first.container).getByRole('button',{name:/거래처/}));
 expect(within(first.container).getByText('태백 캡')).toBeInTheDocument();
 expect(within(first.container).queryByText('풍회 캡')).not.toBeInTheDocument();
 setBomIndex(ai.bom);
 const second=render(<AddOrderModal {...props(b,bi)}/>);
 fireEvent.click(within(second.container).getByRole('button',{name:/거래처/}));
 expect(within(second.container).getByText('풍회 캡')).toBeInTheDocument();
 expect(within(second.container).queryByText('태백 캡')).not.toBeInTheDocument();
 first.rerender(<AddOrderModal {...props(a,ai)}/>);
 expect(within(first.container).getByText('태백 캡')).toBeInTheDocument();
 expect(getBomIndex()).toBe(ai.bom);
});
it('명시 회사 입력을 생략한 기존 호출은 현재 전역 포장표시를 유지한다',()=>{
 const b=products('punghoe'),bi=inputs(b);setBomIndex(bi.bom);
 const view=render(<AddOrderModal {...props(b)}/>);
 fireEvent.click(within(view.container).getByRole('button',{name:/거래처/}));
 expect(within(view.container).getByText('풍회 캡')).toBeInTheDocument();
 expect(getBomIndex()).toBe(bi.bom);
});

const boxItems=()=>[products('taebaek')[0],{...products('taebaek')[0],id:'box',name:'별도 박스',unit:'박스'}];
const boxInputs=(items:Item[],count:number):OrderUnitInputs=>({bom:buildBomIndex(items,[{parent_id:'box',child_id:'oil',quantity:count}]),pack:buildPackIndex([])});
const boxProps=(items:Item[],input:OrderUnitInputs)=>({...props(items,input),partnerItems:[...props(items,input).partnerItems,{id:'box-link',itemId:'box',partnerId:'partner',Direction:'out',price:12000} as PartnerItem]});
it('카드의 박스 변형은 상대 회사 전역보다 화면 BOM의 개입수를 사용한다',()=>{
 const items=boxItems(),a=boxInputs(items,12),b=boxInputs(items,6);setBomIndex(b.bom);
 const view=render(<AddOrderModal {...boxProps(items,a)}/>);const ui=within(view.container);
 fireEvent.click(ui.getByRole('button',{name:/거래처/}));
 expect(ui.getByRole('button',{name:'12개입'})).toBeInTheDocument();
 expect(ui.queryByRole('button',{name:'6개입'})).not.toBeInTheDocument();
});
it('포장표만 있는 품목의 박스 토글과 저장 수량은 명시 회사 개입수로 계산한다',async()=>{
 const items=products('taebaek').slice(0,1),bom=buildBomIndex(items,[]);
 const a={bom,pack:buildPackIndex([{item_id:'oil',units_per_box:12}])};setBomIndex(bom);setPackIndex(buildPackIndex([{item_id:'oil',units_per_box:6}]));
 const p=boxProps(items,a),view=render(<AddOrderModal {...p}/>),ui=within(view.container);
 fireEvent.click(ui.getByRole('button',{name:/거래처/}));
 fireEvent.click(ui.getByRole('button',{name:'기름 수량 박스'}));fireEvent.change(ui.getByPlaceholderText('0'),{target:{value:'2'}});
 expect(ui.getByText('× 12개 = 24개')).toBeInTheDocument();
 await act(async()=>fireEvent.click(ui.getByRole('button',{name:'주문 생성 완료'})));
 expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({items:[expect.objectContaining({itemId:'oil',quantity:24,boxQuantity:2,unitsPerBox:12})]}));
});
it('같은 품목 배열에서 명시 BOM만 갱신돼도 카드 목록의 박스 숨김을 다시 계산한다',()=>{
 const items=boxItems(),a=boxInputs(items,12),none={bom:buildBomIndex(items,[]),pack:buildPackIndex([])};setBomIndex(a.bom);
 const p=boxProps(items,a),view=render(<AddOrderModal {...p}/>),ui=within(view.container);
 fireEvent.click(ui.getByRole('button',{name:/거래처/}));expect(ui.getAllByPlaceholderText('0')).toHaveLength(1);
 view.rerender(<AddOrderModal {...p} orderUnitInputs={none}/>);
 expect(ui.getAllByPlaceholderText('0')).toHaveLength(2);
});
