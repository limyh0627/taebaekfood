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
HTMLElement.prototype.scrollIntoView=vi.fn();
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
it('생산 로트의 행동과 검색·결과보기를 분리하고 상태 전환을 보존한다',()=>{
 const {container}=view({mode:'lots'});const actions=slot(container,'actions'),query=screen.getByRole('region',{name:'검색조건'}),viewOptions=screen.getByRole('group',{name:'로트 보기'});
 expect(within(actions).getByRole('button',{name:'사용 기록'})).toHaveClass('h-9');expect(within(actions).getByRole('button',{name:'입출고 기록'})).toBeInTheDocument();expect(within(actions).queryByRole('button',{name:'외주 발주'})).toBeNull();
 const search=within(query).getByLabelText('품목명 또는 규격');expect(search).toHaveClass('h-10','bg-slate-50');fireEvent.change(search,{target:{value:'조회할 품목'}});expect(search).toHaveValue('조회할 품목');
 expect(query).not.toContainElement(viewOptions);expect(query.compareDocumentPosition(viewOptions)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(within(query).getByRole('button',{name:'로트 상태'}));fireEvent.click(screen.getByRole('option',{name:'완료'}));expect(within(slot(container,'tabs')).getByRole('button',{name:'로트 이력'})).toHaveClass('text-indigo-600');expect(search).toHaveValue('조회할 품목');
 fireEvent.click(within(viewOptions).getByRole('button',{name:'보드'}));expect(within(viewOptions).getByRole('button',{name:'보드'})).toHaveClass('text-indigo-700');
 fireEvent.click(within(viewOptions).getByRole('button',{name:'리스트'}));expect(screen.getByRole('table')).toBeInTheDocument();fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(within(query).getByRole('button',{name:'로트 종류'})).toHaveTextContent('전체');expect(within(query).getByRole('button',{name:'로트 상태'})).toHaveTextContent('전체');expect(within(viewOptions).getByRole('button',{name:'리스트'})).toHaveClass('text-indigo-700');
});
it('생산 사용 기록과 입출고 기록은 기존 모달을 열며 외주 콜백 없이 쓰지 않는다',()=>{
 const {container}=view({mode:'lots'});fireEvent.click(within(slot(container,'actions')).getByRole('button',{name:'사용 기록'}));
 let dialog=screen.getByRole('dialog');expect(dialog).toBeInTheDocument();fireEvent.click(within(dialog).getAllByRole('button').find(button=>button.getAttribute('aria-label')?.endsWith('닫기'))!);
 fireEvent.click(within(slot(container,'actions')).getByRole('button',{name:'입출고 기록'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('OEM 복구는 0건도 같은 조건으로 독립 영역에 남고 직계 버튼만 규격화한다',()=>{
 const issue=vi.fn(),receive=vi.fn(),fee=vi.fn();const {container}=view({mode:'lots',oemEnabled:true,onOemIssue:issue,onOemReceive:receive,onOemIssueFee:fee,rawStockKg:()=>0});
 expect(within(slot(container,'actions')).getByRole('button',{name:'외주 발주'})).toBeInTheDocument();
 const recovery=screen.getByLabelText('OEM 복구');expect(recovery).toHaveClass('flex-wrap','[&>button]:h-9','[&>button]:w-auto');const button=within(recovery).getByRole('button',{name:'OEM 실패 작업 0'});fireEvent.click(button);
 expect(screen.getByRole('dialog',{name:'OEM 실패 작업 목록'})).toBeInTheDocument();expect(issue).not.toHaveBeenCalled();expect(receive).not.toHaveBeenCalled();expect(fee).not.toHaveBeenCalled();
});
it('OEM 복구는 일반 실패와 같은 줄에 있고 로트 전환과 부모 갱신에도 열린 목록을 보존한다',()=>{
 const issue=vi.fn(),receive=vi.fn(),fee=vi.fn();const extra={mode:'lots' as const,oemEnabled:true,onOemIssue:issue,onOemReceive:receive,onOemIssueFee:fee,rawStockKg:()=>0};
 const rendered=view(extra);const recovery=slot(rendered.container,'recovery'),oem=screen.getByLabelText('OEM 복구');expect(recovery).toContainElement(oem);expect(oem).not.toHaveClass('border-t','pt-2');
 fireEvent.click(within(oem).getByRole('button',{name:'OEM 실패 작업 0'}));const original=screen.getByRole('dialog',{name:'OEM 실패 작업 목록'});
 fireEvent.click(within(slot(rendered.container,'tabs')).getByRole('button',{name:'로트 이력'}));expect(screen.getByRole('dialog',{name:'OEM 실패 작업 목록'})).toBe(original);
 fireEvent.change(screen.getByPlaceholderText('품목명·규격 검색'),{target:{value:'부모 갱신'}});expect(screen.getByRole('dialog',{name:'OEM 실패 작업 목록'})).toBe(original);
 fireEvent.click(within(slot(rendered.container,'tabs')).getByRole('button',{name:'로트'}));expect(screen.getByRole('dialog',{name:'OEM 실패 작업 목록'})).toBe(original);
 expect(issue).not.toHaveBeenCalled();expect(receive).not.toHaveBeenCalled();expect(fee).not.toHaveBeenCalled();
});

it('재고 검색과 복수선택 필터는 하나의 주문형 패널이며 초기화로 함께 복원한다',()=>{view();const query=screen.getByRole('region',{name:'검색조건'});expect(screen.getAllByRole('region',{name:'검색조건'})).toHaveLength(1);const search=screen.getByPlaceholderText('품목명 · 거래처 검색...');expect(query).toContainElement(search);const stock=within(query).getByRole('button',{name:'재고'});fireEvent.click(stock);fireEvent.click(screen.getByRole('button',{name:'재고 있음'}));expect(stock).toHaveTextContent('재고 있음');fireEvent.change(search,{target:{value:'보존조건'}});fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(stock).toHaveTextContent('전체');});
