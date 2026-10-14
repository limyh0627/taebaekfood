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

it.each([100, 250])('하이라이트 %ims 뒤 닫으면 스크롤·해제 타이머가 남지 않는다', ms => {
  vi.useFakeTimers(); const clear = vi.fn();
  const view = render(<OrdersList {...props()} highlightOrderId="order-a" onHighlightClear={clear} />);
  tick(ms); view.unmount(); tick(5000);
  expect(clear).not.toHaveBeenCalled(); expect(scroll).toHaveBeenCalledTimes(ms < 200 ? 0 : 1);
});
it('새 하이라이트가 오면 이전 해제가 새 표시를 지우지 않고 최신 callback을 한 번 부른다', () => {
  vi.useFakeTimers(); const old = vi.fn(), latest = vi.fn(), p = props();
  const view = render(<OrdersList {...p} orders={[order(), order('order-b')]} highlightOrderId="order-a" onHighlightClear={old} />);
  tick(200); tick(1000);
  view.rerender(<OrdersList {...p} orders={[order(), order('order-b')]} highlightOrderId="order-b" onHighlightClear={old} />);
  tick(200); tick(1000);
  view.rerender(<OrdersList {...p} orders={[order(), order('order-b')]} highlightOrderId="order-b" onHighlightClear={latest} />);
  tick(1999); expect(old).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
  tick(1); expect(latest).toHaveBeenCalledTimes(1); expect(scroll).toHaveBeenCalledTimes(2);
});

it.each([null, { names: [] }])('다른 회사의 그룹 문서가 없거나 비면 기본값을 쓰고 늦은 이전 회사 응답은 버린다', doc => {
  const p = { ...props(), orders: [{ ...order(), items: [{ itemId: 'oil', name: '검수기름', quantity: 1, price: 0 }] }],
    workOrderItems: [{ key: 'order-a-oil', orderId: 'order-a', itemId: 'oil', itemName: '검수기름', partnerName: '검수거래처', qty: 1, category: '기름' }] };
  const view = render(<OrdersList {...p} />);
  fireEvent.click(screen.getByRole('button', { name: /금일 작업순서/ }));
  const first = fixture.subscriptions[0]; act(() => first.callback({ names: ['회사A전용'] }));
  expect(screen.getByRole('region', { name: '회사A전용 작업순서' })).toBeTruthy();
  view.rerender(<OrdersList {...p} companyId="punghoe" />);
  expect(first.stop).toHaveBeenCalledTimes(1);
  act(() => fixture.subscriptions[1].callback(doc)); act(() => first.callback({ names: ['늦은회사A'] }));
  expect(screen.queryByRole('region', { name: /회사A.*작업순서/ })).toBeNull();
  for (const name of ['기름', '깨', '미분류']) expect(screen.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeTruthy();
  expect(fixture.write).not.toHaveBeenCalled();
});
it('내장 목록은 작업 그룹을 구독하지 않는다', () => {
  render(<OrdersList {...props()} embeddedListOnly />); expect(fixture.subscriptions).toHaveLength(0); expect(fixture.write).not.toHaveBeenCalled();
});

function openLog() {
  fireEvent.click(screen.getByRole('button', { name: '리스트' }));
  fireEvent.click(screen.getAllByRole('button', { name: '검수거래처 주문 수정' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '로그' }));
}
const deferred = () => { let resolve!: (value: unknown[]) => void; const promise = new Promise<unknown[]>(done => { resolve = done; }); return { promise, resolve }; };
it('회사 A→B→A에서 로그를 닫고 이전 회사 지연 응답을 새 조회에 섞지 않는다', async () => {
  const audits = deferred(), edits = deferred(); fixture.fetch.mockReturnValueOnce(audits.promise).mockReturnValueOnce(edits.promise);
  const p = props(), view = render(<OrdersList {...p} />); openLog();
  expect(screen.getByRole('region', { name: '검수 주문 로그' })).toBeTruthy();
  view.rerender(<OrdersList {...p} companyId="punghoe" />); view.rerender(<OrdersList {...p} />);
  expect(screen.queryByRole('region', { name: '검수 주문 로그' })).toBeNull();
  await act(async () => { audits.resolve([]); edits.resolve([{ id: 'old', changes: ['늦은A수정'], at: today(), by: '검수' }]); });
  fireEvent.click(screen.getByRole('button', { name: '로그' }));
  await act(async () => {}); expect(screen.queryByText('늦은A수정')).toBeNull();
});
it('부모 재렌더 없이 실제 로그인 UID가 바뀌면 로그를 닫고 늦은 응답을 버린다', async () => {
  const audits = deferred(), edits = deferred(); fixture.fetch.mockReturnValueOnce(audits.promise).mockReturnValueOnce(edits.promise);
  render(<OrdersList {...props()} />); openLog();
  act(() => { fixture.auth.currentUser = { uid: 'uid-b' }; fixture.authCallbacks.forEach(callback => callback(fixture.auth.currentUser)); });
  expect(screen.queryByRole('region', { name: '검수 주문 로그' })).toBeNull();
  await act(async () => { audits.resolve([]); edits.resolve([{ id: 'old', changes: ['이전직원수정'], at: today(), by: '검수' }]); });
  fireEvent.click(screen.getByRole('button', { name: '로그' })); await act(async () => {});
  expect(screen.queryByText('이전직원수정')).toBeNull();
});
it('현재 회사와 로그인에서 정상 조회한 로그는 보이고 닫은 뒤 재조회한다', async () => {
  fixture.fetch.mockImplementation((collection: string) => Promise.resolve(collection === 'orderItemEdits'
    ? [{ id: 'edit', changes: ['정상 품목 수정'], at: today(), by: '검수' }] : []));
  render(<OrdersList {...props()} />); openLog(); await act(async () => {});
  expect(screen.getByText('정상 품목 수정')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '로그 닫기' }));
  expect(screen.queryByRole('region', { name: '검수 주문 로그' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '로그' })); await act(async () => {});
  expect(screen.getByText('정상 품목 수정')).toBeTruthy(); expect(fixture.fetch).toHaveBeenCalledTimes(4);
  expect(fixture.fetch).toHaveBeenCalledWith('orderItemEdits', 'orderId', 'order-a');
  expect(fixture.write).not.toHaveBeenCalled();
});
