/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ItemList from './ItemList';
import type {Item,RawMaterialLot} from '../src/shared/types';
const authState=vi.hoisted(()=>({currentUser:{uid:'uid'}}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},auth:authState,authReady:Promise.resolve()}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
function props(onAdd=vi.fn().mockResolvedValue({ok:false,reason:'압착 실패'})):React.ComponentProps<typeof ItemList>{
 const noop=vi.fn(),lot={id:'lot',status:'active',kgRemaining:200} as RawMaterialLot,item={id:'raw',name:'참깨',companyId:'taebaek',type:'raw',subtype:'벌크',stock:200,lots:[lot],spec:'',unit:'kg'} as Item;
 return {companyId:'taebaek',mode:'lots',items:[item],partners:[],orderRequests:[],confirmedOrders:[],inboundPartners:[],rawMaterialLedger:[],onUpdateItem:noop,onAddItem:noop,onUpdateOrderRequestQty:noop,onToggleConfirmRequestQty:noop,onConfirmRequest:noop,onConfirmRequests:noop,onBulkAddConfirmedOrders:noop,onConfirmAllRequests:noop,onFinishConfirmedOrder:noop,onUpdateConfirmedQty:noop,onRemoveConfirmedOrder:noop,onEditProduct:noop,onDeleteItem:noop,onAddAdjustmentRequest:noop,onAddRawMaterialEntry:onAdd,onDeleteRawMaterialEntry:noop,isAdmin:true,rawYieldRules:{참깨:{product:'통깨참기름',rate:0.48}}};
}
function openAndFill(){fireEvent.click(screen.getByRole('button',{name:'사용 기록'}));fireEvent.change(screen.getByLabelText('원료'),{target:{value:'참깨'}});fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});}
beforeEach(()=>{authState.currentUser={uid:'uid'};});afterEach(()=>localStorage.clear());
it('실제 ItemList 실패 결과는 모달을 닫거나 성공으로 바꾸지 않는다',async()=>{
 const add=vi.fn().mockResolvedValue({ok:false,reason:'파생 입고 실패'});render(<ItemList {...props(add)}/>);openAndFill();expect(screen.getByText(/자동 입고됩니다/)).toHaveTextContent('48kg');fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(add).toHaveBeenCalledTimes(1);expect(screen.getByRole('heading',{name:'원료 사용 기록'})).toBeInTheDocument();expect(screen.getByText('파생 입고 실패')).toBeInTheDocument();expect(screen.getByRole('button',{name:'착유 실패 작업 0'})).toBeEnabled();expect(screen.queryByText(/기록이 저장되었습니다/)).toBeNull();
});
it('확정 쓰기0 거절은 실패 표시와 입력 수정·새 요청 저장을 허용한다',async()=>{
 const add=vi.fn().mockResolvedValueOnce({ok:false,reason:'원료 부족',canEditRetry:true}).mockResolvedValueOnce({ok:true,appliedKg:-20});render(<ItemList {...props(add)}/>);openAndFill();fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(screen.getByLabelText('사용량')).toBeEnabled();fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(add.mock.calls[1][0].used).toBe(20);expect(add.mock.calls[1][0].id).not.toBe(add.mock.calls[0][0].id);expect(screen.queryByRole('heading',{name:'원료 사용 기록'})).toBeNull();
});
it('처리 중 UID가 바뀌면 기존 결과의 성공 토스트와 닫기를 적용하지 않는다',async()=>{
 let finish!:(v:any)=>void;const add=vi.fn().mockReturnValue(new Promise(resolve=>finish=resolve));render(<ItemList {...props(add)}/>);openAndFill();fireEvent.click(screen.getByRole('button',{name:'저장'}));authState.currentUser={uid:'other'};await act(async()=>finish({ok:true,appliedKg:-100}));expect(screen.queryByText(/기록이 저장되었습니다/)).toBeNull();expect(screen.getByRole('heading',{name:'원료 사용 기록'})).toBeInTheDocument();
});
it('다른 회사 홀더 로트는 사용 로트 선택에 섞지 않는다',()=>{
 const p=props();p.items=[{...p.items[0],id:'foreign',companyId:'punghoe',lots:[{id:'foreign-lot',status:'active',kgRemaining:200} as RawMaterialLot]},...p.items];render(<ItemList {...p}/>);openAndFill();expect(screen.getByLabelText('사용 로트')).toHaveValue('lot');
});
