/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { CompanyId, Item, PurchaseOrder } from '../src/shared/types';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn() }));
const noop=vi.fn();
const item: Item={id:'p1',name:'기름',companyId:'taebaek',type:'product',unit:'병',stock:10,minStock:0,image:''};
const po=(companyId:CompanyId):PurchaseOrder=>({id:`po-${companyId}`,companyId,itemId:item.id,itemName:item.name,quantity:2,status:'invoiced',partnerName:`공급업체-${companyId}`,createdAt:'2026-10-01',items:[{itemId:item.id,name:item.name,quantity:2,unit:'병'}]});
const props=(companyId:CompanyId):React.ComponentProps<typeof ItemList>=>({companyId,items:[{...item,companyId}],partners:[],orderRequests:[],confirmedOrders:[po(companyId)],inboundPartners:[],rawMaterialLedger:[],
 onUpdateItem:noop,onAddItem:noop,onAddOrderRequest:noop,onRemoveOrderRequest:noop,onUpdateOrderRequestQty:noop,onToggleConfirmRequestQty:noop,onConfirmRequest:noop,onConfirmRequests:noop,onBulkAddConfirmedOrders:noop,onConfirmAllRequests:noop,onFinishConfirmedOrder:noop,onUpdateConfirmedQty:noop,onRemoveConfirmedOrder:noop,onEditProduct:noop,onDeleteItem:noop,onAddAdjustmentRequest:noop,onAddRawMaterialEntry:noop,onDeleteRawMaterialEntry:noop});
const flow=()=>fireEvent.click(screen.getByRole('button',{name:'입고/반품'}));
const open=(companyId:CompanyId)=>fireEvent.click(screen.getByText(`공급업체-${companyId}`));
it('같은 회사 재조회는 편집 수량을 유지한다',()=>{
 const view=render(<ItemList {...props('taebaek')}/>); flow();open('taebaek');
 fireEvent.change(screen.getByLabelText('기름 수량'),{target:{value:'7'}});
 view.rerender(<ItemList {...props('taebaek')}/>);
 expect(screen.getByLabelText('기름 수량')).toHaveValue(7);
});
it('다른 회사에 다녀와도 이전 상세와 수량 초안이 다시 나타나지 않는다',()=>{
 const view=render(<ItemList {...props('taebaek')}/>);flow();open('taebaek');
 fireEvent.change(screen.getByLabelText('기름 수량'),{target:{value:'7'}});
 view.rerender(<ItemList {...props('punghoe')}/>);flow();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 view.rerender(<ItemList {...props('taebaek')}/>);flow();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 open('taebaek');expect(screen.getByLabelText('기름 수량')).toHaveValue(2);
});
it('이전 회사 저장의 늦은 완료가 새 회사 상세를 닫지 않는다',async()=>{
 let finish!:()=>void;
 const pending=new Promise<void>(resolve=>{finish=resolve;});
 const view=render(<ItemList {...props('taebaek')} onUpdatePendingFlowQty={()=>pending}/>);flow();open('taebaek');
 fireEvent.change(screen.getByLabelText('기름 수량'),{target:{value:'7'}});
 fireEvent.click(screen.getByRole('button',{name:'수량 저장'}));
 view.rerender(<ItemList {...props('punghoe')}/>);flow();open('punghoe');
 await act(async()=>{finish();await pending;});
 expect(screen.getByRole('dialog')).toBeInTheDocument();
 expect(screen.getByLabelText('기름 수량')).toHaveValue(2);
});
