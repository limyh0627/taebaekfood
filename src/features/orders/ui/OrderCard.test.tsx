/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
 const source={...order,inventoryOperation:{id:'op',state:'failed' as const,targetStatus:OrderStatus.PROCESSING,startedAt:today(),actor:'u',error:'합성실패'}};const recovery=vi.fn((row:Order)=><button>복구 {row.id}</button>),p=base();const view=render(<OrderCard {...p} order={source} renderOrderRecovery={recovery}/>);expect(recovery.mock.calls[0][0]).toBe(source);expect(screen.queryByText('합성실패')).toBeNull();expect(screen.getByTestId('order-number-header')).toContainElement(screen.getByRole('button',{name:/복구 card-leaf/}));recovery.mockClear();view.rerender(<OrderCard {...p} order={source} readOnly renderOrderRecovery={recovery}/>);expect(recovery).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/복구 card-leaf/})).toBeNull();
});
it('카드 날짜 입력 동안 카드 끌기를 끄고 pointerup 뒤 복원한다',()=>{
 const p=base();const view=render(<div draggable="true" data-testid="drag"><OrderCard {...p}/></div>);const input=screen.getByLabelText('합성참기름 소비기한 수정용 제조일');const host=screen.getByTestId('drag');fireEvent.pointerDown(input);expect(host).toHaveAttribute('draggable','false');fireEvent.pointerUp(window);expect(host).toHaveAttribute('draggable','true');expect(p.onUpdateItems).not.toHaveBeenCalled();view.unmount();
});

it('인라인 제조일은 현재 표시 원문 전체를 전달하고 다른 품목을 바꾸지 않는다',()=>{const p=base();render(<OrderCard {...p}/>);fireEvent.change(screen.getByLabelText('합성참기름 소비기한 수정용 제조일'),{target:{value:'2025-02-03'}});expect(p.onUpdateItems).toHaveBeenCalledExactlyOnceWith(order,[{...order.items[0],mfgDate:'2025-02-03'}]);});
it('품목 삭제 확인은 ACK 전 닫히지 않고 미확정 뒤에도 복구 안내를 유지한다',async()=>{let finish!:(v:{committed:boolean;cancelled:boolean})=>void;const update=vi.fn(()=>new Promise<{committed:boolean;cancelled:boolean}>(resolve=>finish=resolve)),p=base();render(<OrderCard {...p} editingOrderId={order.id} onUpdateItems={update} renderOrderEditRecovery={()=><p>미확정은 결과 확인 또는 요청 중단</p>}/>);fireEvent.click(screen.getByRole('button',{name:'합성참기름 품목 삭제'}));let dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'삭제'}));fireEvent.click(within(dialog).getByRole('button',{name:'취소'}));expect(dialog).toBeInTheDocument();expect(within(dialog).getByRole('button',{name:'삭제'})).toBeDisabled();expect(update).toHaveBeenCalledExactlyOnceWith(order,[]);await act(async()=>finish({committed:false,cancelled:false}));expect(screen.getByRole('dialog')).toBe(dialog);expect(within(dialog).getByText('미확정은 결과 확인 또는 요청 중단')).toBeInTheDocument();});
it.each(['failed','processing'] as const)('%s 카드header에는 긴경고 없이 단일자물쇠→이유모달을 표시한다',state=>{render(<OrderCard {...base()} order={{...order,inventoryOperation:{id:'op',startedAt:'2026-01-01',actor:'u',state,targetStatus:OrderStatus.DISPATCHED,error:state==='failed'?'Missing or insufficient permissions.':undefined}}}/>);const lock=screen.getByRole('button',{name:'잠금 이유 및 복구'});expect(screen.getByTestId('order-number-header')).toContainElement(lock);expect(screen.queryByText(/권한 확인에서/)).toBeNull();fireEvent.click(lock);expect(screen.getByRole('dialog',{name:'주문 재고 작업 확인'})).toHaveTextContent(state==='failed'?'권한 확인에서 요청이 거절':'처리 중');expect(base().onUpdateStatus).not.toHaveBeenCalled();});
