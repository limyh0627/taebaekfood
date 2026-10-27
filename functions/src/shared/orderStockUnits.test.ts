import {describe,expect,it,vi} from 'vitest';
import {unpackComponent,isBoxStockItem,stockUnits,unitsPerBoxOf,type OrderStockUnitInputs} from './orderStockUnits';
import type {StockComponent} from './stockUnitMeasure';

const component=(qty:number):StockComponent=>Object.freeze({childId:'loose',qty,child:Object.freeze({type:'product'})});
const inputs=(lines:readonly StockComponent[],per:number):OrderStockUnitInputs=>({bom:{of:()=>lines},pack:{of:()=>per}});

describe('서버 경계의 명시 주문 수량 입력',()=>{
 it('동일 품목을 회사별 BOM·포장표로 독립 계산하고 원문을 바꾸지 않는다',()=>{
  const product=Object.freeze({id:'box'}),line=Object.freeze({quantity:100,isBoxUnit:false,boxQuantity:5}),aLines=Object.freeze([component(20)]),bLines=Object.freeze([component(10)]);
  const a=inputs(aLines,99),b=inputs(bLines,88),before=JSON.stringify({product,line,aLines,bLines});
  expect(unpackComponent(product,a)).toEqual({itemId:'loose',count:20});expect(unpackComponent(product,b)).toEqual({itemId:'loose',count:10});
  expect(isBoxStockItem(product,a)).toBe(true);expect(stockUnits(line,product,a)).toBe(5);expect(stockUnits(line,product,b)).toBe(5);
  expect(unitsPerBoxOf(product,a)).toBe(20);expect(unitsPerBoxOf(product,b)).toBe(10);expect(JSON.stringify({product,line,aLines,bLines})).toBe(before);
 });
 it('품목이 없으면 기준정보를 읽지 않고 원래 빈 값과 주문 수량을 유지한다',()=>{
  const bom=vi.fn(()=>[]),pack=vi.fn(()=>99),i={bom:{of:bom},pack:{of:pack}};
  expect(unpackComponent(undefined,i)).toBeNull();expect(isBoxStockItem(undefined,i)).toBe(false);expect(stockUnits({quantity:7,isBoxUnit:true,boxQuantity:2},undefined,i)).toBe(7);expect(unitsPerBoxOf(undefined,i)).toBe(0);
  expect(bom).not.toHaveBeenCalled();expect(pack).not.toHaveBeenCalled();
 });
 it('포장표는 BOM 박스가 아닐 때만 사용하고 여러 완제품 자식은 박스로 간주하지 않는다',()=>{
  const p={id:'p'},pack=vi.fn(()=>12),single={bom:{of:()=>[component(3)]},pack:{of:pack}},multiple={bom:{of:()=>[component(3),{...component(4),childId:'another'}]},pack:{of:pack}};
  expect(unitsPerBoxOf(p,single)).toBe(3);expect(pack).not.toHaveBeenCalled();expect(unpackComponent(p,multiple)).toBeNull();expect(unitsPerBoxOf(p,multiple)).toBe(12);expect(pack).toHaveBeenCalledTimes(1);
 });
 it('명시 박스 수량 0과 누락은 기존 공용 boxCountOf 계약대로 구분한다',()=>{
  const i=inputs([component(10)],0),p={id:'p'};
  expect(stockUnits({quantity:30,isBoxUnit:false,boxQuantity:0},p,i)).toBe(0);expect(stockUnits({quantity:3,isBoxUnit:false},p,i)).toBe(3);
 });
});
