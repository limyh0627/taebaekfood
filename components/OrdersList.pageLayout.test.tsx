/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrdersList from './OrdersList';
import { OrderStatus, type Order } from '../types';
import { today } from '../src/shared/day';

const fixture = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'uid-a' } as { uid: string } | null },
  authCallbacks: [] as Array<(user: { uid: string } | null) => void>,
  subscriptions: [] as Array<{ id: string; callback: (doc: { names: string[] } | null) => void; stop: ReturnType<typeof vi.fn> }>,
  fetch: vi.fn(), write: vi.fn(),
}));
vi.mock('../src/shared/firebase', () => ({ auth: fixture.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
  fixture.authCallbacks.push(callback);
  return () => { fixture.authCallbacks = fixture.authCallbacks.filter(item => item !== callback); };
} }));
vi.mock('../src/shared/services/firebaseService', () => ({
  subscribeToDocument: (_collection: string, id: string, callback: (doc: { names: string[] } | null) => void) => {
    const stop = vi.fn(); fixture.subscriptions.push({ id, callback, stop }); return stop;
  }, setDocument: (...args: unknown[]) => fixture.write(...args), fetchWhere: (...args: unknown[]) => fixture.fetch(...args),
}));
vi.mock('../src/shared/deliveryTimeSlot', () => ({ subscribeDeliveryOrdering: () => () => {}, saveDeliveryTimeSlot: vi.fn() }));
vi.mock('./OrderActivityLogModal', () => ({ default: ({ rows, onClose }: { rows: Array<{ what: string }>; onClose: () => void }) =>
  <section aria-label="검수 주문 로그">{rows.map((row, index) => <p key={index}>{row.what}</p>)}<button onClick={onClose}>로그 닫기</button></section> }));

const order = (id = 'order-a'): Order => ({ id, companyId: 'taebaek', partnerName: '검수거래처', items: [], totalAmount: 0,
  status: OrderStatus.PENDING, createdAt: today(), deliveryDate: today(), email: '', source: '일반' });
const props = () => ({ companyId: 'taebaek' as const, title: '주문', subtitle: '', groupBy: 'status' as const,
  allowedStatuses: [OrderStatus.PENDING], orders: [order()], partners: [], items: [], onUpdateStatus: vi.fn(),
  onUpdateDeliveryDate: vi.fn(), onDeleteOrder: vi.fn(), onAddClick: vi.fn() });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const scroll = vi.fn();
beforeEach(() => {
  fixture.auth.currentUser = { uid: 'uid-a' }; fixture.authCallbacks = []; fixture.subscriptions = [];
  fixture.fetch.mockReset().mockResolvedValue([]); fixture.write.mockReset(); scroll.mockReset();
  HTMLElement.prototype.scrollIntoView = scroll;
});
afterEach(() => vi.useRealTimers());
it('제목·보기·행동·검색 순서로 표시하고 보기 변경 중 생성 콜백은 한 번만 호출한다',()=>{const p=props();render(<OrdersList {...p}/>);const heading=screen.getByRole('heading',{name:'주문'}),board=screen.getByRole('button',{name:'보드'}),create=screen.getByRole('button',{name:'주문 생성'}),search=screen.getByPlaceholderText('거래처, 품목, 제조, 라벨, 포장, 팔레트 검색');expect(heading.compareDocumentPosition(board)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(board.compareDocumentPosition(create)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();fireEvent.click(create);expect(p.onAddClick).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'배송 캘린더'}));expect(screen.queryByRole('button',{name:'주문 생성'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'리스트'}));expect(screen.getAllByRole('button',{name:'주문 생성'})).toHaveLength(1);});
it('저장 주문 이동은 이력·검색 필터를 풀어 기존 카드를 보여주며 재생성하지 않는다',()=>{vi.useFakeTimers();const p=props(),view=render(<OrdersList {...p}/>);fireEvent.change(screen.getByPlaceholderText('거래처, 품목, 제조, 라벨, 포장, 팔레트 검색'),{target:{value:'없는 검색'}});fireEvent.click(screen.getAllByRole('button',{name:'이력'}).find(button=>button.hasAttribute('aria-pressed'))!);view.rerender(<OrdersList {...p} newOrderId="order-a"/>);tick(150);expect(screen.getByRole('button',{name:'보드'})).toHaveAttribute('aria-pressed','true');expect(document.getElementById('order-card-order-a')).toBeTruthy();expect(p.onAddClick).not.toHaveBeenCalled();expect(fixture.write).not.toHaveBeenCalled();});
it('저장된 주문이 목록에 없으면 확인 안내만 표시하고 생성하지 않는다',()=>{vi.useFakeTimers();const p=props();render(<OrdersList {...p} newOrderId="missing"/>);tick(150);expect(screen.getByText(/저장된 주문을 현재 목록에서 찾지 못했습니다/)).toBeTruthy();expect(p.onAddClick).not.toHaveBeenCalled();expect(fixture.write).not.toHaveBeenCalled();});
it('내장 목록은 제목·탭·생성 행동을 추가하지 않는다',()=>{render(<OrdersList {...props()} embeddedListOnly/>);expect(screen.queryByRole('heading',{name:'주문'})).toBeNull();expect(screen.queryByRole('button',{name:'주문 생성'})).toBeNull();});

it('주문 상태 필터는 헤더 보기에서 분리하여 검색 뒤 본문에 원래 건수로 표시한다',()=>{
 render(<OrdersList {...props()}/>);const board=screen.getByRole('button',{name:'보드'}),tabs=board.closest<HTMLElement>('[data-page-header-slot="tabs"]')!,status=screen.getByLabelText('주문 상태 선택'),query=screen.getByRole('region',{name:'검색조건'}),work=screen.getByRole('heading',{name:/금일 작업순서/});
 expect(tabs).not.toContainElement(status);expect(query.compareDocumentPosition(status)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(status.compareDocumentPosition(work)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(status).toHaveClass('overflow-x-auto');
 expect(within(status).getByRole('button',{name:/^전체\s*1$/})).toBeInTheDocument();const pending=within(status).getByRole('button',{name:/^대기중\s*1$/});fireEvent.click(pending);expect(pending).toHaveClass('border-indigo-600');expect(document.getElementById('order-card-order-a')).toBeTruthy();expect(fixture.write).not.toHaveBeenCalled();
});
it('상태 필터는 캘린더에서 유지하고 이력과 내장 목록에서는 추가하지 않는다',()=>{
 const p=props(),view=render(<OrdersList {...p}/>);const tabs=screen.getByRole('button',{name:'보드'}).closest<HTMLElement>('[data-page-header-slot="tabs"]')!;
 fireEvent.click(within(tabs).getByRole('button',{name:'배송 캘린더'}));expect(screen.getByLabelText('주문 상태 선택')).toBeInTheDocument();
 fireEvent.click(within(tabs).getByRole('button',{name:'이력'}));expect(screen.queryByLabelText('주문 상태 선택')).toBeNull();
 view.rerender(<OrdersList {...p} embeddedListOnly/>);expect(screen.queryByLabelText('주문 상태 선택')).toBeNull();expect(fixture.write).not.toHaveBeenCalled();
});

it('주문 이력 날짜는 수동 값이 빠른기간과 같아져도 기존 값동치 활성 표시를 유지한다',()=>{render(<OrdersList {...props()}/>);const tabs=screen.getByRole('button',{name:'보드'}).closest<HTMLElement>('[data-page-header-slot="tabs"]')!;fireEvent.click(within(tabs).getByRole('button',{name:'이력'}));const from=screen.getByLabelText('완료일 시작'),to=screen.getByLabelText('완료일 종료'),quick=within(screen.getByRole('region',{name:'검색조건'})).getByRole('button',{name:'오늘'});fireEvent.change(from,{target:{value:today()}});fireEvent.change(to,{target:{value:today()}});expect(quick).toHaveClass('bg-slate-900');expect(from).toHaveClass('date-narrow','h-10');expect(to.compareDocumentPosition(quick)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(fixture.write).not.toHaveBeenCalled();});

it('진행 주문의 빠른기간은 같은 서울 날짜를 쓰고 전체는 기존 빈 범위로 복원한다',()=>{render(<OrdersList {...props()}/>);const query=screen.getByRole('region',{name:'검색조건'}),from=screen.getByLabelText('진행 주문일 시작'),to=screen.getByLabelText('진행 주문일 종료');fireEvent.click(within(query).getByRole('button',{name:'오늘'}));expect(from).toHaveValue(today());expect(to).toHaveValue(today());const all=within(query).getByRole('button',{name:'기간 전체'});expect(all).toHaveTextContent('전체');fireEvent.click(all);expect(from).toHaveValue('');expect(to).toHaveValue('');expect(from).not.toHaveAttribute('max');expect(to).not.toHaveAttribute('min');fireEvent.click(within(query).getByRole('button',{name:'오늘'}));fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(from).toHaveValue('');expect(to).toHaveValue('');expect(all).toHaveClass('bg-slate-900');expect(fixture.write).not.toHaveBeenCalled();});
