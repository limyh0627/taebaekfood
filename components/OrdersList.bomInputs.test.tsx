/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,within} from '@testing-library/react';
import {OrderCard} from './OrdersList';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from '../src/shared/packIndex';
import {OrderStatus,type Item,type Order,type ItemBom} from '../src/shared/types';
const original=getBomIndex(),originalPack=getPackIndex();afterEach(()=>{setBomIndex(original);setPackIndex(originalPack);});
const items=[{id:'box',name:'상자',type:'product',unit:'박스',stock:1},{id:'loose',name:'낱개',type:'product',unit:'병',stock:1},{id:'cap',name:'태백 마개',type:'submaterial',category:'마개',unit:'개',stock:1}] as Item[];
const rows=[{parent_id:'box',child_id:'loose',quantity:12},{parent_id:'loose',child_id:'cap',quantity:1}] as ItemBom[];
const own={bom:buildBomIndex(items,rows),pack:buildPackIndex([])};
const other={bom:buildBomIndex(items.map(i=>i.id==='cap'?{...i,name:'풍회 마개'}:i),rows),pack:buildPackIndex([])};
const order={id:'order',partnerId:'partner',partnerName:'거래처',status:OrderStatus.PENDING,source:'일반',createdAt:'2026-10-09',deliveryDate:'2026-10-10',items:[{itemId:'box',name:'상자',quantity:1,price:0}],totalAmount:0} as Order;
const props={order,items,itemBoms:rows,partners:[],editingOrderId:null,setEditingOrderId:vi.fn(),showAddProductSelect:null,setShowAddProductSelect:vi.fn(),onUpdateDeliveryDate:vi.fn(),onUpdateStatus:vi.fn(),onDeleteOrder:vi.fn()};
it('실제 카드의 펼친 낱개 구성은 회사 명시 BOM을 쓰고 입력만 바뀌어도 갱신한다',()=>{
 setBomIndex(other.bom);const view=render(<OrderCard {...props} orderUnitInputs={own}/>),ui=within(view.container);
 fireEvent.click(ui.getByRole('button',{name:/구성/}));fireEvent.click(ui.getByRole('button',{name:/낱개/}));
 expect(ui.getByText('태백 마개')).toBeInTheDocument();expect(ui.queryByText('풍회 마개')).not.toBeInTheDocument();
 view.rerender(<OrderCard {...props} orderUnitInputs={other}/>);
 expect(ui.getByText('풍회 마개')).toBeInTheDocument();expect(ui.queryByText('태백 마개')).not.toBeInTheDocument();
});

it('편집 카드의 포장표 판정은 명시 입력을 쓰고 포장표만 갱신돼도 다시 그린다',()=>{
 const pack={bom:own.bom,pack:buildPackIndex([{item_id:'loose',units_per_box:12}])};
 setBomIndex(own.bom);setPackIndex(buildPackIndex([]));
 const looseOrder={...order,items:[{itemId:'loose',name:'낱개',quantity:24,price:0}]};
 const p={...props,order:looseOrder,editingOrderId:order.id};
 const view=render(<OrderCard {...p} orderUnitInputs={pack}/>);
 const before=view.container.querySelectorAll('input[type="date"]').length;
 view.rerender(<OrderCard {...p} orderUnitInputs={{...pack,pack:buildPackIndex([])}}/>);
 expect(view.container.querySelectorAll('input[type="date"]')).toHaveLength(before+1);
});
