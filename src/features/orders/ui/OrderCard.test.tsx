/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderCard } from './OrderCard';
import { OrderStatus, type Order, type Item } from '../../../../types';
import { today } from '../../../shared/day';
const item={id:'p',name:'합성참기름',type:'product',unit:'병',spec:'300ml',stock:10} as Item;
const order:Order={id:'card-leaf',companyId:'taebaek',partnerName:'합성거래처',items:[{itemId:'p',name:'합성참기름',quantity:2,price:0}],totalAmount:0,status:OrderStatus.PENDING,createdAt:today(),deliveryDate:today(),email:'',source:'일반'};
const base=()=>({order,partners:[],items:[item],editingOrderId:null,setEditingOrderId:vi.fn(),showAddProductSelect:null,setShowAddProductSelect:vi.fn(),onUpdateStatus:vi.fn(),onUpdateDeliveryDate:vi.fn(),onDeleteOrder:vi.fn(),onUpdateItems:vi.fn()});
it('거래처 수정은 원래 주문 ID를 전달하고 readonly에서는 진입을 숨긴다',()=>{
 const p=base(),edit=vi.fn();const view=render(<OrderCard {...p} onEditOrder={edit}/>);fireEvent.click(screen.getByRole('button',{name:'합성거래처 주문 수정'}));expect(edit).toHaveBeenCalledExactlyOnceWith(order.id);view.rerender(<OrderCard {...p} readOnly onEditOrder={edit}/>);expect(screen.queryByRole('button',{name:'합성거래처 주문 수정'})).toBeNull();expect(p.onUpdateStatus).not.toHaveBeenCalled();
});
it('실패 원문 주문은 복구 슬롯에 그대로 전달하고 readonly에서는 콜백도 호출하지 않는다',()=>{
 const source={...order,inventoryOperation:{id:'op',state:'failed' as const,targetStatus:OrderStatus.PROCESSING,startedAt:today(),actor:'u',error:'합성실패'}};const recovery=vi.fn((row:Order)=><button>복구 {row.id}</button>),p=base();const view=render(<OrderCard {...p} order={source} renderOrderRecovery={recovery}/>);expect(recovery.mock.calls[0][0]).toBe(source);expect(screen.getByText('합성실패')).toBeInTheDocument();recovery.mockClear();view.rerender(<OrderCard {...p} order={source} readOnly renderOrderRecovery={recovery}/>);expect(recovery).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/복구 card-leaf/})).toBeNull();
});
it('카드 날짜 입력 동안 카드 끌기를 끄고 pointerup 뒤 복원한다',()=>{
 const p=base();const view=render(<div draggable="true" data-testid="drag"><OrderCard {...p}/></div>);const input=screen.getByLabelText('합성참기름 소비기한 수정용 제조일');const host=screen.getByTestId('drag');fireEvent.pointerDown(input);expect(host).toHaveAttribute('draggable','false');fireEvent.pointerUp(window);expect(host).toHaveAttribute('draggable','true');expect(p.onUpdateItems).not.toHaveBeenCalled();view.unmount();
});
