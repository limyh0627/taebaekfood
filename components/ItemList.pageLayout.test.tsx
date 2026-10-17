/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ItemList from './ItemList';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn() }));
const fixture=vi.hoisted(()=>({history:false}));
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return {...actual,useState:(initial:unknown)=>{const [value,setValue]=actual.useState(fixture.history&&initial==='master'?'history':initial);return [value,(next:unknown)=>setValue(fixture.history&&initial==='master'&&next==='master'?'history':next)];}};});
afterEach(()=>{cleanup();fixture.history=false;});
function view(extra: Partial<React.ComponentProps<typeof ItemList>> = {}) {
 return render(<ItemList companyId="taebaek" items={[]} partners={[]} orderRequests={[]} confirmedOrders={[]} receivedOrders={[]} returnRequests={[]} inboundPartners={[]} rawMaterialLedger={[]}
 onUpdateItem={vi.fn()} onAddItem={vi.fn()} onAddOrderRequest={vi.fn()} onRemoveOrderRequest={vi.fn()} onUpdateOrderRequestQty={vi.fn()} onToggleConfirmRequestQty={vi.fn()} onConfirmRequest={vi.fn()} onConfirmRequests={vi.fn()} onBulkAddConfirmedOrders={vi.fn()} onConfirmAllRequests={vi.fn()} onFinishConfirmedOrder={vi.fn()} onUpdateConfirmedQty={vi.fn()} onRemoveConfirmedOrder={vi.fn()} onEditProduct={vi.fn()} onDeleteItem={vi.fn()} onAddAdjustmentRequest={vi.fn()} onAddRawMaterialEntry={vi.fn()} onDeleteRawMaterialEntry={vi.fn()} {...extra} />);
}
function slot(container: HTMLElement, name: string) { const node=container.querySelector(`[data-page-header-slot="${name}"]`); expect(node).not.toBeNull(); return node as HTMLElement; }
it('제목 다음 탭·행동·독립 복구를 두고 검색은 헤더 뒤에 둔다', () => {
 const {container}=view(); const tabs=slot(container,'tabs'), actions=slot(container,'actions'), recovery=slot(container,'recovery');
 expect(within(tabs).getByRole('button',{name:'재고 현황'})).toBeInTheDocument();
 expect(within(actions).getByRole('button',{name:'재고 현황'})).toBeInTheDocument();
 expect(within(recovery).getByRole('button',{name:'실패 0'})).toBeInTheDocument();
 const title=screen.getByRole('heading',{name:'재고 관리'}), search=screen.getByPlaceholderText('품목명 · 거래처 검색...');
 for(const [a,b] of [[title,tabs],[tabs,actions],[actions,recovery],[recovery,search]]) expect(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(title.parentElement).toHaveClass('hidden','md:block'); expect(search).toHaveClass('h-10');
 fireEvent.click(within(recovery).getByRole('button',{name:'실패 0'})); expect(screen.getByRole('dialog',{name:'재고 실패 작업 목록'})).toBeInTheDocument();
});
it('행동의 재고 현황 콜백은 실사 화면을 그대로 연다', () => {
 const {container}=view();fireEvent.click(within(slot(container,'actions')).getByRole('button',{name:'재고 현황'}));
 expect(screen.getByRole('button',{name:'품목추가'})).toBeInTheDocument();
});
it('입고 탭 전환은 행동만 교체하고 복구 영역을 유지한다', () => {
 const {container}=view();fireEvent.click(within(slot(container,'tabs')).getByRole('button',{name:'입고/반품'}));
 expect(within(slot(container,'actions')).getByRole('button',{name:'입고 처리'})).toBeInTheDocument();
 expect(within(slot(container,'actions')).queryByRole('button',{name:'재고 현황'})).not.toBeInTheDocument();
 expect(within(slot(container,'recovery')).getByRole('button',{name:'실패 0'})).toBeInTheDocument();
 fireEvent.click(within(slot(container,'actions')).getByRole('button',{name:'입고 처리'})); expect(screen.getByRole('dialog',{name:/입고/})).toBeInTheDocument();
});
it('생산 모드는 로트 탭을 같은 슬롯에 두고 이력 콜백을 유지한다', () => {
 const {container}=view({mode:'lots'}); const tabs=slot(container,'tabs');
 const history=within(tabs).getByRole('button',{name:'로트 이력'});fireEvent.click(history);expect(history).toHaveClass('text-indigo-600');
 expect(within(tabs).getByRole('button',{name:'로트'})).toBeInTheDocument();
 expect(screen.queryByPlaceholderText('품목명 · 거래처 검색...')).not.toBeInTheDocument();
});

it('검색조건의 라벨과 초기화는 기존 검색어만 비운다',()=>{
 view();const search=screen.getByLabelText('품목명 또는 거래처');
 expect(screen.getByRole('region',{name:'검색조건'})).toContainElement(search);
 fireEvent.change(search,{target:{value:'조회할 품목'}});expect(search).toHaveValue('조회할 품목');
 fireEvent.click(screen.getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');
 expect(screen.getByRole('button',{name:'입고/반품'})).toBeInTheDocument();
});
it('발주 확정 후 history 상태에서도 기존 재고현황 행동을 유지한다',()=>{
 // 현재 확정 대기 진입은 화면에서 연결되지 않아, 확정 콜백이 남기는 history 상태만 합성한다.
 fixture.history=true;const {container}=view();
 expect(screen.queryByPlaceholderText('품목명 · 거래처 검색...')).not.toBeInTheDocument();
 fireEvent.click(within(slot(container,'actions')).getByRole('button',{name:'재고 현황'}));
 expect(screen.getByRole('button',{name:'품목추가'})).toBeInTheDocument();
});
