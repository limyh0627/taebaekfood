/** @vitest-environment jsdom */
import React,{useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import ItemManager from '../../../../components/ItemManager';
import {ItemCostCalculator} from './ItemCostCalculator';
import {calcCost,type CostCalcResult} from '../../admin/costCalc';
import type {Item} from '../../../shared/types';
const services=vi.hoisted(()=>({fetchCollection:vi.fn(async()=>[]),addItem:vi.fn(),setDocument:vi.fn()}));
vi.mock('../../../shared/services/firebaseService',()=>services);
const items:Item[]=[{id:'raw',name:'참깨',spec:'1kg',unit:'kg',type:'raw',cost:100,stock:10,minStock:0,image:''}];
const writes={onAddItem:vi.fn(),onDeleteItem:vi.fn(),onLinkItem:vi.fn(),onUnlinkItem:vi.fn(),onEditProduct:vi.fn()};
const calculator=vi.fn((rows:Parameters<typeof calcCost>[0],opts:Parameters<typeof calcCost>[3])=>calcCost(rows,items,[],opts));
const props={companyId:'taebaek' as const,items,partners:[],...writes,onCalcCost:calculator};
afterEach(()=>{cleanup();vi.clearAllMocks();});
const open=()=>{fireEvent.click(screen.getByRole('button',{name:/^원가계산기$/}));return screen.getByRole('dialog',{name:'원가계산기'});};
it('실부모 구성품 선택·소수수량·과세·가공비·판매가를 공용 계산에 전달하고 저장하지 않는다',()=>{
 render(<ItemManager {...props}/>);const dialog=open(),ui=within(dialog);
 fireEvent.click(ui.getByRole('button',{name:'구성품 고르기'}));fireEvent.change(ui.getByPlaceholderText('품목명 검색...'),{target:{value:'ㅊㄲ'}});
 fireEvent.click(ui.getByRole('button',{name:/참깨/}));
 fireEvent.change(dialog.querySelector('input[inputmode="decimal"]')!,{target:{value:'2.5'}});
 fireEvent.click(ui.getByRole('button',{name:'면세'}));
 const amounts=ui.getAllByPlaceholderText('0');fireEvent.change(amounts[0],{target:{value:'25'}});fireEvent.change(amounts[1],{target:{value:'500'}});
 expect(calculator).toHaveBeenLastCalledWith([{itemId:'raw',qty:2.5}],{price:500,taxType:'면세',fee:25});
 expect(ui.getByText('275원')).toBeTruthy();expect(ui.getByText('225원')).toBeTruthy();
 for(const writer of Object.values(writes))expect(writer).not.toHaveBeenCalled();expect(services.addItem).not.toHaveBeenCalled();expect(services.setDocument).not.toHaveBeenCalled();
});
it('실부모 닫기·재열기는 구성과 금액·과세 초안을 유지하고 비우기는 과세를 유지한다',()=>{
 render(<ItemManager {...props}/>);let dialog=open(),ui=within(dialog);
 fireEvent.click(ui.getByRole('button',{name:'구성품 고르기'}));fireEvent.click(ui.getByRole('button',{name:/참깨/}));
 fireEvent.change(dialog.querySelector('input[inputmode="decimal"]')!,{target:{value:'3.25'}});fireEvent.click(ui.getByRole('button',{name:'면세'}));
 const amounts=ui.getAllByPlaceholderText('0');fireEvent.change(amounts[0],{target:{value:'45'}});fireEvent.change(amounts[1],{target:{value:'999'}});
 fireEvent.click(ui.getByRole('button',{name:/^닫기$/}));expect(screen.queryByRole('dialog')).toBeNull();
 dialog=open();ui=within(dialog);expect(ui.getByDisplayValue('3.25')).toBeTruthy();expect(ui.getByDisplayValue('45')).toBeTruthy();expect(ui.getByDisplayValue('999')).toBeTruthy();
 expect(calculator).toHaveBeenLastCalledWith([{itemId:'raw',qty:3.25}],{price:999,taxType:'면세',fee:45});
 fireEvent.click(ui.getByRole('button',{name:'비우기'}));expect(ui.getByDisplayValue('1')).toBeTruthy();
 expect(calculator).toHaveBeenLastCalledWith([{itemId:'',qty:1}],{price:0,taxType:'면세',fee:0});
});
it('공용 화면은 검색200개 제한과 비우기시 검색·선택열림을 유지한다',()=>{
 const many=Array.from({length:201},(_,i)=>({...items[0],id:'r'+i,name:'검색품'+i}));
 const result:CostCalcResult={lines:[],cost:0,fee:0,price:0,margin:0,marginRate:0,markupRate:0};
 function Harness(){const [calcRows,setCalcRows]=useState([{itemId:'',qty:'2.5'}]),[calcPrice,setCalcPrice]=useState('100'),[calcFee,setCalcFee]=useState('20'),[calcTax,setCalcTax]=useState<'과세'|'면세'>('면세'),[calcSearch,setCalcSearch]=useState('검색품'),[calcPickIdx,setCalcPickIdx]=useState<number|null>(0);return <ItemCostCalculator items={many} {...{calcRows,setCalcRows,calcPrice,setCalcPrice,calcFee,setCalcFee,calcTax,setCalcTax,calcSearch,setCalcSearch,calcPickIdx,setCalcPickIdx,calcResult:result}} onClose={vi.fn()}/>;}
 render(<Harness/>);expect(screen.getAllByRole('button',{name:/검색품/})).toHaveLength(200);
 fireEvent.click(screen.getByRole('button',{name:'비우기'}));expect(screen.getByPlaceholderText('품목명 검색...')).toHaveValue('검색품');expect(screen.getAllByRole('button',{name:/검색품/})).toHaveLength(200);expect(screen.getByDisplayValue('1')).toBeTruthy();
});
