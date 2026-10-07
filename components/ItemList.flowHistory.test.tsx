/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { Item } from '../src/shared/types';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn() }));
const item = { id:'p1', companyId:'taebaek', name:'기름', type:'product', unit:'병', stock:10, minStock:0 } as Item;
const po = { id:'po1',companyId:'taebaek',partnerName:'공급업체',createdAt:'2026-10-01T01:00:00Z', items:[{itemId:'p1',name:'기름',quantity:2,unit:'병'}] };
function view(extra: Partial<React.ComponentProps<typeof ItemList>>, history = false) {
 render(<ItemList companyId="taebaek" items={[item]} partners={[]} orderRequests={[]} confirmedOrders={[]} inboundPartners={[]} rawMaterialLedger={[]}
 onUpdateItem={vi.fn()} onAddItem={vi.fn()} onAddOrderRequest={vi.fn()} onRemoveOrderRequest={vi.fn()} onUpdateOrderRequestQty={vi.fn()} onToggleConfirmRequestQty={vi.fn()} onConfirmRequest={vi.fn()} onConfirmRequests={vi.fn()} onBulkAddConfirmedOrders={vi.fn()} onConfirmAllRequests={vi.fn()} onFinishConfirmedOrder={vi.fn()} onUpdateConfirmedQty={vi.fn()} onRemoveConfirmedOrder={vi.fn()} onEditProduct={vi.fn()} onDeleteItem={vi.fn()} onAddAdjustmentRequest={vi.fn()} onAddRawMaterialEntry={vi.fn()} onDeleteRawMaterialEntry={vi.fn()} {...extra} />);
 fireEvent.click(screen.getByRole('button',{name:'입고/반품'}));
 if (history) fireEvent.click(screen.getByRole('button',{name:/^이력$/}));
 return within(screen.getByText('공급업체').closest('tr')!);
}
it('발주확정 날짜는 생성일이 아닌 실제 확정 시각이다',()=>{
 const row=view({confirmedOrders:[{...po,status:'invoiced',invoicedAt:'2026-10-03T16:20:00Z'} as any]});
 expect(row.getByText('발주확정')).toBeInTheDocument();
 expect(row.getByText('2026-10-04')).toBeInTheDocument();
 expect(row.getByText('01:20:00')).toBeInTheDocument();
 expect(row.queryByText('2026-10-01')).not.toBeInTheDocument();
});
it.each(['입고','반품'])('%s 완료 시각이 없으면 생성일로 대신 표시하지 않는다',type=>{
 const row=view(type==='입고' ? {receivedOrders:[{...po,status:'received'} as any]} : {returnRequests:[{id:'r1',companyId:'taebaek',partnerName:'공급업체',createdAt:po.createdAt,status:'processed',items:[{itemId:'p1',name:'기름',quantity:2}]} as any]}, true);
 expect(row.getByText('미기록')).toBeInTheDocument();
 expect(row.queryByText('2026-10-01')).not.toBeInTheDocument();
});
it('복수 반품은 다른 단위를 개수로 합하지 않고 품목 수와 첫 품목 요약을 보인다',()=>{
 const row=view({returnRequests:[{id:'r1',companyId:'taebaek',partnerName:'공급업체',createdAt:po.createdAt,status:'pending',items:[{itemId:'p1',name:'기름',quantity:2},{itemId:'p2',name:'원료',quantity:25}]} as any],items:[item,{...item,id:'p2',name:'원료',unit:'kg'}]});
 expect(row.getByText('2개 품목')).toBeInTheDocument();
 expect(row.getByText('기름 외 1개')).toBeInTheDocument();
 expect(row.queryByText('27개')).not.toBeInTheDocument();
});
