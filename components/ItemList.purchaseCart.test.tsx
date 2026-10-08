/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type {Item,Partner,PartnerItem} from '../src/shared/types';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({fetchCollection: vi.fn().mockResolvedValue([]),subscribeToCollection: vi.fn(() => () => {}),addItem:vi.fn()}));
it('담긴 품목의 매입 거래처를 바꾸면 선택한 거래처로 발주로 요청한다', async () => {
 const companyId='taebaek' as const;
 const item={id:'p1',companyId,name:'복수 매입 품목',type:'goods',unit:'개',stock:10,minStock:0} as Item;
 const inboundPartners=[{id:'s1',name:'첫 매입처'},{id:'s2',name:'두 번째 매입처'}] as Partner[];
 const partnerItems=inboundPartners.map(p=>({id:p.id,itemId:item.id,partnerId:p.id,Direction:'in'})) as PartnerItem[];
 const issue=vi.fn().mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof ItemList> = { companyId, items: [item], partners: [],
    orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onAddOrderRequest: vi.fn(), onRemoveOrderRequest: vi.fn(),
    onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: issue, onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: vi.fn(), onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };

 render(<ItemList {...props} partnerItems={partnerItems} inboundPartners={inboundPartners} isAdmin onRequestPurchaseInvoice={issue} />);
 fireEvent.click(screen.getByRole('button',{name:/상품/}));
 fireEvent.click(screen.getAllByText('복수 매입 품목')[0]);
 fireEvent.click(screen.getByRole('button',{name:'담기'}));
 fireEvent.click(screen.getByRole('button',{name:'담은 발주 품목 보기'}));
 fireEvent.change(screen.getByLabelText('복수 매입 품목 매입 거래처'),{target:{value:'s2'}});
 fireEvent.click(screen.getByRole('button',{name:'확정 (1건)'}));
 await waitFor(()=>expect(issue).toHaveBeenCalledWith([expect.objectContaining({id:'p1',partnerId:'s2'})]));
});
