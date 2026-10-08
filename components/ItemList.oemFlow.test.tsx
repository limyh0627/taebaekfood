/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { Item, PurchaseOrder } from '../src/shared/types';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({fetchCollection: vi.fn().mockResolvedValue([]),subscribeToCollection: vi.fn(() => () => {}),addItem:vi.fn()}));
const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: confirm }));
function view(status: 'invoiced' | 'received', patch: Partial<PurchaseOrder> = {}, cancel = vi.fn<(_po: PurchaseOrder) => Promise<unknown>>().mockResolvedValue(undefined)) {
 const companyId='taebaek' as const;
 const item={id:'oem-product',companyId,name:'볶음참깨',type:'product',procureType:'임가공',unit:'개',spec:'1kg',stock:0,minStock:0} as Item;
 const po={id:'fumi-po',companyId,poType:'oem',partnerId:'fumi',partnerName:'푸미푸드',status,createdAt:'2026-10-01',invoicedAt:'2026-10-02',receivedAt:'2026-10-03',itemId:'',itemName:'',quantity:0,items:[],oemSent:[{material:'참깨',kg:1200}],...patch} as PurchaseOrder;
 const generic=vi.fn(),receive=vi.fn().mockResolvedValue(undefined),fee=vi.fn().mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof ItemList> = { companyId, items: [item], partners: [],
    orderRequests: [], confirmedOrders: status === 'invoiced' ? [po] : [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onAddOrderRequest: vi.fn(), onRemoveOrderRequest: vi.fn(),
    onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: vi.fn(), onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: generic, onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };
 const rendered=render(<ItemList {...props} receivedOrders={status==='received'?[po]:[]} oemEnabled rawStockKg={()=>1200} onOemIssue={vi.fn()} onOemReceive={receive} onOemIssueFee={fee} onOemCancel={cancel} isAdmin />);
 fireEvent.click(screen.getByRole('button',{name:'입고/반품'}));
 return {generic,receive,fee,cancel,...rendered};
}
it('OEM 원료만 보낸 문서는 품목미지정0 대신 송부 원료와 입고 미기록을 표시한다',()=>{
 view('invoiced');
 expect(screen.getByText(/송부 원료: 참깨/)).toBeInTheDocument();
 expect(screen.getByText(/송부 1,200 kg.*입고 미기록/)).toBeInTheDocument();
 expect(screen.queryByText('품목 미지정')).toBeNull();
 expect(screen.queryByText('0개 품목')).toBeNull();
});
it('OEM 가공입고 버튼은 기존 OEM 모달로 연결하며 일반 입고 callback을 호출하지 않는다',async ()=>{
 const {generic,receive}=view('invoiced');
 fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 expect(screen.getByRole('heading',{name:'가공입고'})).toBeInTheDocument();
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'20'}});
 fireEvent.click(screen.getAllByRole('button',{name:'가공입고'}).at(-1)!);
 await waitFor(()=>expect(receive).toHaveBeenCalledOnce());
 expect(receive.mock.calls[0][0]).toMatchObject({po:{id:'fumi-po',companyId:'taebaek'},returns:[{itemId:'oem-product',qty:20}],bulk:[]});
 expect(generic).not.toHaveBeenCalled();
});
it('받은수량없는 완료문서는 미기록이며 가공비 창으로 연결한다',()=>{
 view('received');
 fireEvent.click(screen.getByRole('button',{name:'이력'}));
 expect(screen.getByText(/입고 미기록/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'가공비 발행'}));
 expect(screen.getByRole('heading',{name:'가공비 전표 발행'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'전표 발행'})).toBeDisabled();
});
it('실제 제품·벌크·총회수 기록을 송부량과 구분해서 표시한다',async ()=>{
 const {fee}=view('received',{items:[{itemId:'oem-product',name:'볶음참깨',quantity:20,unit:'개'}],oemReceivedBulk:[{material:'참깨',kg:30}],oemReceivedKg:50});
 fireEvent.click(screen.getByRole('button',{name:'이력'}));
 expect(screen.getByText(/입고 제품: 볶음참깨/)).toBeInTheDocument();
 expect(screen.getByText(/입고 제품 20 개.*벌크 참깨 30 kg.*총회수 50 kg/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'가공비 발행'}));
 fireEvent.click(screen.getByRole('button',{name:'전표 발행'}));
 await waitFor(()=>expect(fee).toHaveBeenCalledOnce());
 expect(fee.mock.calls[0][0]).toMatchObject({po:{id:'fumi-po',oemReceivedKg:50}});
});

it('원료-only OEM 상세에도 일반 발주 fallback 품목미지정0 행을 표시하지 않는다',()=>{
 view('invoiced');
 fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 expect(screen.getByRole('heading',{name:'입고 상세'})).toBeInTheDocument();
 expect(screen.queryByText('품목 미지정')).toBeNull();
 expect(screen.queryByText('0 개')).toBeNull();
 expect(screen.getAllByText(/송부 원료: 참깨/).length).toBeGreaterThan(1);
 expect(screen.getAllByText(/입고 미기록/).length).toBeGreaterThan(1);
});

it('외주 취소는 완료를 기다리며 중복 클릭을 막고 원문을 전달한다',async()=>{
 let finish!:()=>void;
 const cancel=vi.fn((_po: PurchaseOrder)=>new Promise<void>(resolve=>{finish=resolve;}));
 view('invoiced',{},cancel);
 fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 expect(screen.queryByRole('button',{name:/^삭제$/})).toBeNull();
 expect(screen.getByText('취소하면 보낸 원료를 재고로 복원하고 발주 기록을 남깁니다.')).toBeInTheDocument();
 const button=screen.getByRole('button',{name:'외주 발주 취소'});
 fireEvent.click(button);fireEvent.click(button);
 await waitFor(()=>expect(cancel).toHaveBeenCalledOnce());
 expect(cancel.mock.calls[0][0]).toMatchObject({id:'fumi-po',oemSent:[{material:'참깨',kg:1200}]});
 expect(screen.getByRole('heading',{name:'입고 상세'})).toBeInTheDocument();
 finish();await waitFor(()=>expect(screen.queryByRole('heading',{name:'입고 상세'})).toBeNull());
});
it('외주 취소 실패는 상세 원문과 재시도를 보존한다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});
 const cancel=vi.fn().mockRejectedValue(new Error('응답 유실'));
 view('invoiced',{},cancel);fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 fireEvent.click(screen.getByRole('button',{name:'외주 발주 취소'}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalled());
 expect(screen.getByRole('heading',{name:'입고 상세'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'외주 발주 취소'})).toBeEnabled();
 vi.restoreAllMocks();
});
it('취소 원문은 이력에 남고 입고와 가공비 실행을 제공하지 않는다',()=>{
 view('invoiced',{oemCancelledAt:'2026-10-08',oemCancelOperationId:'oem-cancel:fumi-po'});
 expect(screen.queryByText('푸미푸드')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'이력'}));
 expect(screen.getAllByText('취소')).toHaveLength(2);
 fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 expect(screen.queryByRole('button',{name:'가공입고'})).toBeNull();
 expect(screen.queryByRole('button',{name:'가공비 발행'})).toBeNull();
 expect(screen.queryByRole('button',{name:'외주 발주 취소'})).toBeNull();
});

it('취소 확인 뒤 화면이 종료되면 원료 취소 쓰기를 시작하지 않는다',async()=>{
 let approve!:(value:boolean)=>void;
 confirm.mockImplementationOnce(()=>new Promise<boolean>(resolve=>{approve=resolve;}));
 const {cancel,unmount}=view('invoiced');fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 fireEvent.click(screen.getByRole('button',{name:'외주 발주 취소'}));unmount();approve(true);
 await Promise.resolve();await Promise.resolve();expect(cancel).not.toHaveBeenCalled();
});
it('외주 취소 확인을 취소하면 원문을 유지하고 쓰지 않는다',async()=>{
 confirm.mockResolvedValueOnce(false);
 const {cancel}=view('invoiced');fireEvent.click(screen.getByText('푸미푸드').closest('tr')!);
 fireEvent.click(screen.getByRole('button',{name:'외주 발주 취소'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'외주 발주 취소'})).toBeEnabled());
 expect(cancel).not.toHaveBeenCalled();expect(screen.getByRole('heading',{name:'입고 상세'})).toBeInTheDocument();
});
