/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
