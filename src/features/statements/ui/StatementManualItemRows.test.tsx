/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import StatementManualItemRows from './StatementManualItemRows';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../../shared/bomIndex';
import type {Item} from '../../../shared/types';
const original=getBomIndex();afterEach(()=>setBomIndex(original));
it('수동 품목 검색은 같은 ID의 상대 회사 BOM을 섞지 않는다',()=>{
 const items=[{id:'oil',name:'참기름',type:'product'},{id:'cap',name:'태백 마개',type:'submaterial',category:'마개'}] as Item[];
 const rows=[{parent_id:'oil',child_id:'cap',quantity:1}],own=buildBomIndex(items,rows),other=buildBomIndex(items.map(i=>i.id==='cap'?{...i,name:'풍회 마개'}:i),rows);setBomIndex(other);
 const props={rows:[{name:'참기름',spec:'',qty:'1',price:'1000',isTaxExempt:false}],readOnly:false,selectedIndex:0,activeSearchIndex:0,statementType:'매출',accountCodes:[],formatAmount:String,searchResults:()=>[{pc:{id:'link'},product:items[0]}],onSelect:vi.fn(),onChange:vi.fn(),onSearchFocus:vi.fn(),onSearchBlur:vi.fn(),onChooseProduct:vi.fn(),onRemove:vi.fn()};
 const view=render(<table><tbody><StatementManualItemRows {...props} bomIndex={own}/></tbody></table>);
 expect(screen.getByText('태백 마개')).toBeInTheDocument();
 view.rerender(<table><tbody><StatementManualItemRows {...props} bomIndex={other}/></tbody></table>);
 expect(screen.getByText('풍회 마개')).toBeInTheDocument();
});

it('원료 매입은 한 단위 입력만 표시하고 기존 원가kg 줄은 렌더만으로 바꾸지 않는다',()=>{
 const onChange=vi.fn();const raw={id:'raw',type:'raw' as const,subtype:'벌크',unit:'포'};
 const props={rows:[{itemId:'raw',name:'원료20kg포',spec:'20kg',qty:'2',price:'22000',isTaxExempt:false,purchaseQuantityKg:'40'}],readOnly:false,selectedIndex:0,activeSearchIndex:null,statementType:'매입',items:[raw],accountCodes:[],formatAmount:String,searchResults:()=>[],onSelect:vi.fn(),onChange,onSearchFocus:vi.fn(),onSearchBlur:vi.fn(),onChooseProduct:vi.fn(),onRemove:vi.fn()};
 const view=render(<table><tbody><StatementManualItemRows {...props}/></tbody></table>);
 expect(screen.getByLabelText('1행 매입단위 숫자')).toHaveValue('1');expect(screen.getByLabelText('1행 매입단위 단위')).toHaveValue('legacy');expect(screen.queryByLabelText('1행 원가 기준 수량 kg')).not.toBeInTheDocument();expect(screen.queryByText('저장된 원가 기준 40kg')).not.toBeInTheDocument();expect(onChange).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('1행 매입단위 단위'),{target:{value:'kg'}});const next={...props.rows[0],...onChange.mock.calls[0][1]};view.rerender(<table><tbody><StatementManualItemRows {...props} rows={[next]}/></tbody></table>);fireEvent.change(screen.getByLabelText('1행 매입단위 숫자'),{target:{value:'20'}});expect(onChange).toHaveBeenLastCalledWith(0,{purchaseUnitId:'manual-kg',purchaseUnit:'20kg',purchaseQty:2,unitKg:20,inventoryQty:40,purchaseQuantityKg:undefined});expect({...props.rows[0],...onChange.mock.calls.at(-1)![1]}.purchaseQuantityKg).toBeUndefined();
 view.rerender(<table><tbody><StatementManualItemRows {...props} readOnly/></tbody></table>);expect(screen.queryByText('저장된 원가 기준 40kg')).not.toBeInTheDocument();expect(screen.queryByLabelText('1행 매입단위 숫자')).not.toBeInTheDocument();view.unmount();
});it('원료와 일반 품목을 함께 넣어도 설정행이 원료 바로 밑에만 붙는다',()=>{
 const p={rows:[{itemId:'raw',name:'참깨',spec:'벌크',qty:'100',price:'2200',isTaxExempt:true},{itemId:'product',name:'상품',spec:'1L',qty:'2',price:'1000',isTaxExempt:false}],items:[{id:'raw',type:'raw' as const,subtype:'벌크',unit:'kg'},{id:'product',type:'product' as const,unit:'개'}],readOnly:false,selectedIndex:null,activeSearchIndex:null,statementType:'매입',accountCodes:[],formatAmount:String,searchResults:()=>[],onSelect:vi.fn(),onChange:vi.fn(),onSearchFocus:vi.fn(),onSearchBlur:vi.fn(),onChooseProduct:vi.fn(),onRemove:vi.fn()};
 const view=render(<table><tbody><StatementManualItemRows {...p}/></tbody></table>);
 const tbody=view.container.querySelector('tbody')!;expect(tbody.children).toHaveLength(3);
 expect(screen.getByLabelText('1행 거래 수량').closest('tr')).toBe(tbody.children[0]);
 expect(screen.getByLabelText('1행 매입단위 숫자').closest('tr')).toBe(tbody.children[1]);
 expect(screen.getByLabelText('2행 거래 수량').closest('tr')).toBe(tbody.children[2]);
 expect(screen.queryByLabelText('2행 매입단위')).not.toBeInTheDocument();
 view.unmount();
});
