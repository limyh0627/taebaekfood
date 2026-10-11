/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import StatementManualItemRows from './StatementManualItemRows';
import type { ItemPurchaseUnit } from '../../../shared/types';
afterEach(cleanup);
const unit: ItemPurchaseUnit={id:'u',companyId:'taebaek',itemId:'raw',purchaseUnit:'포대',unitKg:22.5,isDefault:true,active:true,createdAt:'a',updatedAt:'a'};
const props = () => ({rows:[{itemId:'raw',name:'들깨',spec:'',qty:'2',price:'44000',isTaxExempt:true,purchaseQuantityKg:'40'}],readOnly:false,selectedIndex:null,activeSearchIndex:null,statementType:'매입',accountCodes:[],items:[{id:'raw',type:'raw' as const,subtype:'벌크',unit:'kg'}],purchaseUnits:[unit],formatAmount:String,searchResults:()=>[],onSelect:vi.fn(),onChange:vi.fn(),onSearchFocus:vi.fn(),onSearchBlur:vi.fn(),onChooseProduct:vi.fn(),onRemove:vi.fn()});
it('기본 표시가 있어도 자동 선택하지 않고 직접 선택한 중량만 저장한다',()=>{const p=props();render(<table><tbody><StatementManualItemRows {...p}/></tbody></table>);expect(screen.getByLabelText('1행 매입단위')).toHaveValue('');expect(p.onChange).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('1행 매입단위'),{target:{value:'u'}});expect(p.onChange).toHaveBeenCalledWith(0,{purchaseUnitId:'u',purchaseUnit:'포대',purchaseQty:2,unitKg:22.5,inventoryQty:45,purchaseQuantityKg:undefined});});
it('등록표가 바뀌어도 전표 상세는 저장된 포장 중량을 보여준다',()=>{const p=props();render(<table><tbody><StatementManualItemRows {...p} readOnly rows={[{...p.rows[0],purchaseUnitId:'u',purchaseUnit:'포대',purchaseQty:2,unitKg:20,inventoryQty:40}]}/></tbody></table>);expect(screen.getByText('매입단위: 포대 · 단위당 20kg · 입고 40kg')).toBeInTheDocument();expect(screen.queryByLabelText('1행 원가 기준 수량 kg')).not.toBeInTheDocument();});
it('빈 수량에 임의로 한 포대를 넣지 않는다',()=>{const p=props();render(<table><tbody><StatementManualItemRows {...p} rows={[{...p.rows[0],qty:''}]}/></tbody></table>);expect(screen.getByLabelText('1행 매입단위')).toBeDisabled();expect(p.onChange).not.toHaveBeenCalled();});

function ProductSelection({units}:{units:ItemPurchaseUnit[]}) {
 const p=props(); const [rows,setRows]=React.useState(p.rows); const [search,setSearch]=React.useState(true);
 return <table><tbody><StatementManualItemRows {...p} companyId="taebaek" selectedPartnerId="supplier" rows={rows} purchaseUnits={units} activeSearchIndex={search?0:null} searchResults={()=>[{pc:{id:'p'},product:{id:'raw',name:'등록들깨',type:'raw',subtype:'벌크',unit:'kg'} as any}]} onChooseProduct={(index,result,fields)=>{setRows(current=>current.map((row,i)=>i===index?{...row,name:result.product.name,purchaseQuantityKg:'',...fields}:row));setSearch(false);}} onChange={(index,patch)=>setRows(current=>current.map((row,i)=>i===index?{...row,...patch}:row))}/></tbody></table>;
}
it('실제 새 품목 선택 시 등록 기본 단위를 한 번만 적용한다',()=>{const view=render(<ProductSelection units={[unit]}/>);fireEvent.mouseDown(screen.getByText('등록들깨'));expect(screen.getByLabelText('1행 매입단위')).toHaveValue('u');expect(screen.getByText(/입고 45kg/)).toBeInTheDocument();view.rerender(<ProductSelection units={[{...unit,unitKg:25}]}/>);expect(screen.getByText(/입고 45kg/)).toBeInTheDocument();fireEvent.change(screen.getByLabelText('1행 매입단위'),{target:{value:''}});view.rerender(<ProductSelection units={[unit]}/>);expect(screen.getByLabelText('1행 매입단위')).toHaveValue('');});
it('실제 품목 선택 시 기본이 중복되면 경고하고 자동 선택하지 않는다',()=>{render(<ProductSelection units={[unit,{...unit,id:'another'}]}/>);fireEvent.mouseDown(screen.getByText('등록들깨'));expect(screen.getByLabelText('1행 매입단위')).toHaveValue('');expect(screen.getByText(/기본 매입단위가 여러 개/)).toBeInTheDocument();});

it('입고된 원포대 수량은 보호하고 미입고 수량 입력은 허용한다',()=>{
 const p=props();const rows=[{...p.rows[0],purchaseUnitId:'u',purchaseUnit:'포대',purchaseQty:2,unitKg:22.5,inventoryQty:45}];
 const view=render(<table><tbody><StatementManualItemRows {...p} rows={rows} lockedPurchaseUnitItemIds={new Set(['raw'])}/></tbody></table>);
 expect(screen.getByLabelText('1행 거래 수량')).toBeDisabled();expect(screen.getByLabelText('1행 매입단위')).toBeDisabled();
 view.rerender(<table><tbody><StatementManualItemRows {...p} rows={rows} lockedPurchaseUnitItemIds={new Set()}/></tbody></table>);
 expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});expect(p.onChange).toHaveBeenLastCalledWith(0,{qty:'3',purchaseUnitId:'u',purchaseUnit:'포대',purchaseQty:3,unitKg:22.5,inventoryQty:67.5});
});
it('기존 포대 줄 앞을 삭제해 원전표 위치가 바뀌는 것을 막는다',()=>{
 const p=props();render(<table><tbody><StatementManualItemRows {...p} rows={[p.rows[0],{...p.rows[0],purchaseUnitId:'u',purchaseUnit:'포대',purchaseQty:2,unitKg:22.5,inventoryQty:45},p.rows[0]]} preservedPurchaseUnitLineIndices={[1]}/></tbody></table>);
 expect(screen.queryByLabelText('1행 삭제')).not.toBeInTheDocument();expect(screen.queryByLabelText('2행 삭제')).not.toBeInTheDocument();expect(screen.getByLabelText('3행 삭제')).toBeInTheDocument();
});
