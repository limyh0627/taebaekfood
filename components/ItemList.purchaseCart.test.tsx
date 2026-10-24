/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type {Item,Partner,PartnerItem} from '../src/shared/types';
import { webcrypto } from 'node:crypto';
import * as batch from '../src/shared/services/purchaseOrderBatchService';
vi.mock('../src/shared/services/purchaseOrderBatchService',async importOriginal=>({...await importOriginal<typeof import('../src/shared/services/purchaseOrderBatchService')>(),applyPurchaseOrderBatch:vi.fn(),inspectPurchaseOrderBatch:vi.fn(),cancelPurchaseOrderBatch:vi.fn()}));
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});});
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {currentUser:{uid:'cart-qa'}}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({fetchCollection: vi.fn().mockResolvedValue([]),subscribeToCollection: vi.fn(() => () => {}),addItem:vi.fn()}));
it('담긴 품목의 매입 거래처를 바꾸면 선택한 거래처로 발주로 요청한다', async () => {
 const companyId='taebaek' as const;
 const item={id:'p1',companyId,name:'복수 매입 품목',type:'goods',unit:'개',stock:10,minStock:0} as Item;
 const inboundPartners=[{id:'s1',name:'첫 매입처'},{id:'s2',name:'두 번째 매입처'}] as Partner[];
 const partnerItems=inboundPartners.map(p=>({id:p.id,itemId:item.id,partnerId:p.id,Direction:'in'})) as PartnerItem[];
 const issue=vi.fn().mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof ItemList> = { companyId, items: [item], partners: [],
    orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
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
 const panel=screen.getByText('발주 내역').closest('.fixed') as HTMLElement;
 fireEvent.change(within(panel).getByRole('spinbutton'),{target:{value:'3'}});
 fireEvent.click(document.querySelector('.fixed.inset-0.z-40')!);
 expect(screen.getByText('발주 내역')).toBeInTheDocument();
 expect(screen.getByLabelText('복수 매입 품목 매입 거래처')).toHaveValue('s2');
 expect(within(panel).getByRole('spinbutton')).toHaveValue(3);expect(issue).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'발주 내역 닫기'}));expect(screen.queryByText('발주 내역')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'담은 발주 품목 보기'}));
 expect(screen.getByLabelText('복수 매입 품목 매입 거래처')).toHaveValue('s2');
 expect(within(screen.getByText('발주 내역').closest('.fixed') as HTMLElement).getByRole('spinbutton')).toHaveValue(3);
 fireEvent.click(screen.getByRole('button',{name:'확정 (1건)'}));
 await waitFor(()=>expect(issue).toHaveBeenCalledWith([expect.objectContaining({id:'p1',partnerId:'s2'})]));
});

it('확정 대기에는 수량과 닫기를 잠가 제출한 초안을 보존한다',async()=>{
 const companyId='taebaek' as const;
 const item={id:'p1',companyId,name:'복수 매입 품목',type:'goods',unit:'개',stock:10,minStock:0} as Item;
 const inboundPartners=[{id:'s1',name:'첫 매입처'},{id:'s2',name:'두 번째 매입처'}] as Partner[];
 const partnerItems=inboundPartners.map(p=>({id:p.id,itemId:item.id,partnerId:p.id,Direction:'in'})) as PartnerItem[];
 let finish!:(value:unknown)=>void;const issue=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const props: React.ComponentProps<typeof ItemList> = { companyId, items: [item], partners: [],
    orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: issue, onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: vi.fn(), onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };

 render(<ItemList {...props} partnerItems={partnerItems} inboundPartners={inboundPartners} isAdmin/>);fireEvent.click(screen.getByRole('button',{name:/상품/}));fireEvent.click(screen.getAllByText('복수 매입 품목')[0]);fireEvent.click(screen.getByRole('button',{name:'담기'}));fireEvent.click(screen.getByRole('button',{name:'담은 발주 품목 보기'}));fireEvent.click(screen.getByRole('button',{name:'확정 (1건)'}));const panel=screen.getByText('발주 내역').closest('.fixed') as HTMLElement;expect(within(panel).getByRole('spinbutton')).toBeDisabled();for(const select of within(panel).getAllByRole('combobox'))expect(select).toBeDisabled();expect(screen.getByRole('button',{name:'발주 내역 닫기'})).toBeDisabled();finish(undefined);await waitFor(()=>expect(screen.queryByText('발주 내역')).toBeNull());
});

it('확정 실패는 부분생성가능 이유와 원수량을 표시하고 자동재송신하지 않는다',async()=>{
 const companyId='taebaek' as const;
 const item={id:'p1',companyId,name:'복수 매입 품목',type:'goods',unit:'개',stock:10,minStock:0} as Item;
 const inboundPartners=[{id:'s1',name:'첫 매입처'},{id:'s2',name:'두 번째 매입처'}] as Partner[];
 const partnerItems=inboundPartners.map(p=>({id:p.id,itemId:item.id,partnerId:p.id,Direction:'in'})) as PartnerItem[];
 const issue=vi.fn().mockRejectedValueOnce(Error('일부그룹 거절')).mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof ItemList> = { companyId, items: [item], partners: [],
    orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: issue, onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: vi.fn(), onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };

 render(<ItemList {...props} partnerItems={partnerItems} inboundPartners={inboundPartners} isAdmin/>);fireEvent.click(screen.getByRole('button',{name:/상품/}));fireEvent.click(screen.getAllByText('복수 매입 품목')[0]);fireEvent.click(screen.getByRole('button',{name:'담기'}));fireEvent.click(screen.getByRole('button',{name:'담은 발주 품목 보기'}));const panel=screen.getByText('발주 내역').closest('.fixed') as HTMLElement;fireEvent.change(within(panel).getByRole('spinbutton'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'확정 (1건)'}));expect(await within(panel).findByRole('alert')).toHaveTextContent('일부 발주가 이미 생성되었을 수 있습니다');expect(within(panel).getByRole('spinbutton')).toHaveValue(3);expect(issue).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'발주 내역 닫기'})).toBeEnabled();
});
function durableFixture(){
 const companyId='taebaek' as const,item={id:'p1',companyId,name:'복구 상품',type:'goods',unit:'개',stock:10,minStock:0} as Item;
 const supplier={id:'s1',name:'합성 매입처'} as Partner;
 const request=batch.preparePurchaseOrderBatch({companyId,actorUid:'cart-qa',isCurrent:()=>true},[{id:'po-batch-ui-po',data:{companyId,createdAt:'2026-10-24T01:00:00.000Z',status:'pending',partnerName:supplier.name,items:[{itemId:item.id,name:item.name,quantity:1,unit:'개'}]}}],{operationId:'po-batch-ui',createdAt:'2026-10-24T01:00:00.000Z'});
 const props:React.ComponentProps<typeof ItemList>={companyId,items:[item],partners:[],orderRequests:[],confirmedOrders:[],inboundPartners:[supplier],partnerItems:[{id:'link',itemId:item.id,partnerId:supplier.id,Direction:'in'} as PartnerItem],rawMaterialLedger:[],onUpdateItem:vi.fn(),onAddItem:vi.fn(),onUpdateOrderRequestQty:vi.fn(),onToggleConfirmRequestQty:vi.fn(),onConfirmRequest:vi.fn(),onConfirmRequests:vi.fn(),onBulkAddConfirmedOrders:vi.fn(),onPreparePurchaseOrderBatch:vi.fn(()=>request),onConfirmAllRequests:vi.fn(),onFinishConfirmedOrder:vi.fn(),onUpdateConfirmedQty:vi.fn(),onRemoveConfirmedOrder:vi.fn(),onEditProduct:vi.fn(),onDeleteItem:vi.fn(),onAddAdjustmentRequest:vi.fn(),onAddRawMaterialEntry:vi.fn(),onDeleteRawMaterialEntry:vi.fn()};
 return {props,request};
}
async function enterDurableCart(){
 fireEvent.click(screen.getByRole('button',{name:/상품/}));fireEvent.click(screen.getAllByText('복구 상품')[0]);fireEvent.click(screen.getByRole('button',{name:'담기'}));fireEvent.click(screen.getByRole('button',{name:'담은 발주 품목 보기'}));
 await new Promise(resolve=>setTimeout(resolve,0));fireEvent.click(screen.getByRole('button',{name:'확정 (1건)'}));
}
it('실ItemList실패모달은사람원문을표시하고applied조회뒤자기카트만종결한다',async()=>{
 const {props,request}=durableFixture(),reference=await batch.purchaseOrderBatchReference(request);
 vi.mocked(batch.applyPurchaseOrderBatch).mockRejectedValueOnce(Error('저장 응답 유실'));
 vi.mocked(batch.inspectPurchaseOrderBatch).mockResolvedValue({reference,status:'applied'});
 render(<ItemList {...props}/>);await enterDurableCart();
 const dialog=await screen.findByRole('dialog',{name:'발주 처리 결과 확인'});
 expect(within(dialog).getByText('합성 매입처')).toBeInTheDocument();expect(within(dialog).getByText(/복구 상품 · 1 개/)).toBeInTheDocument();
 expect(within(dialog).queryByText(/^이전 저장 시도:/)).toBeNull();expect(within(dialog).getByRole('alert')).toHaveTextContent('저장 응답 유실');
 expect(within(dialog).getByText(/^작성:/)).toHaveTextContent('오전 10:00');expect(within(dialog).getByText(/^작성:/)).not.toHaveTextContent('T01:00');
 fireEvent.click(within(dialog).getByRole('button',{name:'처리 결과 조회'}));
 await waitFor(()=>expect(within(dialog).getByText(/이 요청의 발주 묶음은 처리되었습니다/)).toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'발주 처리 결과 확인 닫기'}));expect(screen.queryByText('발주 내역')).toBeNull();
 expect(batch.applyPurchaseOrderBatch).toHaveBeenCalledTimes(1);expect(props.onBulkAddConfirmedOrders).not.toHaveBeenCalled();
});
it('실ItemList과거applied조회는수정된새cart초안을종결하지않는다',async()=>{
 const {props,request}=durableFixture(),reference=await batch.purchaseOrderBatchReference(request);
 vi.mocked(batch.applyPurchaseOrderBatch).mockRejectedValueOnce(Error('저장 응답 유실'));vi.mocked(batch.inspectPurchaseOrderBatch).mockResolvedValue({reference,status:'applied'});
 render(<ItemList {...props}/>);await enterDurableCart();await screen.findByRole('dialog',{name:'발주 처리 결과 확인'});
 fireEvent.click(screen.getByRole('button',{name:'발주 처리 결과 확인 닫기'}));
 const panel=screen.getByText('발주 내역').closest('.fixed') as HTMLElement;fireEvent.change(within(panel).getByRole('spinbutton'),{target:{value:'9'}});
 fireEvent.click(screen.getByRole('button',{name:'발주 확인 필요 1'}));fireEvent.click(screen.getByRole('button',{name:'처리 결과 조회'}));
 await screen.findByText(/이 요청의 발주 묶음은 처리되었습니다/);fireEvent.click(screen.getByRole('button',{name:'발주 처리 결과 확인 닫기'}));
 expect(within(panel).getByRole('spinbutton')).toHaveValue(9);expect(batch.applyPurchaseOrderBatch).toHaveBeenCalledTimes(1);
});
