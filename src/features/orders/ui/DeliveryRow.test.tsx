/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DeliveryRow from './DeliveryRow';
import OrdersList from '../../../../components/OrdersList';
import { OrderStatus, type Order, type Item } from '../../../shared/types';
import { today } from '../../../shared/day';
const order:Order={id:'delivery-leaf',companyId:'taebaek',partnerName:'합성택배',items:[],totalAmount:0,status:OrderStatus.PENDING,createdAt:today(),deliveryDate:today(),email:'',source:'택배',deliveryBoxes:[{itemId:'a',name:'작은 박스',quantity:2}]};
const items=[{id:'b',name:'큰 박스',type:'박스',freightType:'l'},{id:'bag',name:'비닐 박스',type:'박스'},{id:'sack',name:'자루',type:'박스'},{id:'raw',name:'원조박스',type:'박스'},{id:'product',name:'제품',type:'product'},{id:'a',name:'작은 박스',type:'박스'}] as Item[];
it('송장 체크는 원래 주문 ID와 다음 boolean을 전달한다',()=>{
 const toggle=vi.fn();const view=render(<DeliveryRow order={order} partnerName="합성택배" items={items} onToggleInvoicePrinted={toggle}/>);fireEvent.click(screen.getAllByRole('button')[0]);expect(toggle).toHaveBeenLastCalledWith(order.id,true);
 view.rerender(<DeliveryRow order={{...order,invoicePrinted:true}} partnerName="합성택배" items={items} onToggleInvoicePrinted={toggle}/>);fireEvent.click(screen.getAllByRole('button')[0]);expect(toggle).toHaveBeenLastCalledWith(order.id,false);
});
it('박스 초안은 취소하면 버리고 다음에 기존 수량으로 다시 연다',()=>{
 const update=vi.fn();render(<DeliveryRow order={order} partnerName="합성택배" items={items} onUpdateDeliveryBoxes={update}/>);fireEvent.click(screen.getByRole('button',{name:'추가'}));const fields=screen.getAllByRole('spinbutton');expect(fields).toHaveLength(2);expect(fields[1]).toHaveValue(2);fireEvent.change(fields[1],{target:{value:'7'}});fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(update).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'추가'}));expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(2);
});
it('완료는 허용 박스의 원래 품목 순서와 양수 정수만 보낸다',()=>{
 const update=vi.fn(),before=structuredClone(order);render(<DeliveryRow order={order} partnerName="합성택배" items={items} onUpdateDeliveryBoxes={update}/>);fireEvent.click(screen.getByRole('button',{name:'추가'}));const fields=screen.getAllByRole('spinbutton');fireEvent.change(fields[0],{target:{value:'3.8'}});fireEvent.change(fields[1],{target:{value:'-2'}});fireEvent.click(screen.getByRole('button',{name:'완료'}));expect(update).toHaveBeenCalledWith(order.id,[{itemId:'b',name:'큰 박스',quantity:3}]);expect(screen.queryByRole('spinbutton')).toBeNull();expect(order).toEqual(before);
});
it('허용 박스가 없으면 안내하고 callback 없는 완료도 기존대로 닫는다',()=>{
 render(<DeliveryRow order={{...order,deliveryBoxes:[]}} partnerName="합성택배" items={[]}/>);fireEvent.click(screen.getByRole('button',{name:'추가'}));expect(screen.getByText('등록된 박스 없음')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'완료'}));expect(screen.queryByText('등록된 박스 없음')).toBeNull();
});
it('부모의 기존 숨김 택배 구분에서 실제 배송행과 콜백 연결을 유지한다',()=>{
 const update=vi.fn(),toggle=vi.fn();render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status" allowedStatuses={[OrderStatus.PENDING]} orders={[order]} partners={[]} items={items} onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={vi.fn()} onAddClick={vi.fn()} onToggleInvoicePrinted={toggle} onUpdateDeliveryBoxes={update}/>);
 const legacy=screen.getAllByRole('button',{hidden:true}).find(button=>button.textContent==='택배');if(!legacy)throw Error('기존 숨김 택배 구분 없음');fireEvent.click(legacy);
 expect(screen.getByText('택배 주문 목록 (1)')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'추가'}));fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:'완료'}));expect(update).toHaveBeenCalledWith(order.id,[{itemId:'b',name:'큰 박스',quantity:4},{itemId:'a',name:'작은 박스',quantity:2}]);
});
