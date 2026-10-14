/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Order } from '../types';
import { today } from '../day';
import { useAppData } from './useAppData';

const mock = vi.hoisted(() => ({
  authListeners: new Set<(user: {uid:string}|null) => void>(),
  auth: { currentUser: null as {uid:string}|null, onAuthStateChanged: (callback: (user: {uid:string}|null)=>void) => { mock.authListeners.add(callback); return () => { mock.authListeners.delete(callback); }; } },
  requests: [] as Array<{ company: string; resolve: (orders: Order[]) => void }>,
  fetchCollection: vi.fn(),
  onOrders: null as null | ((orders: Order[]) => void),
  listeners: [] as Array<{ name: string; callback: (rows: any[]) => void }>,
  documents: [] as Array<{ id: string; callback: (value: any) => void }>,
}));

vi.mock('../firebase', () => ({ authReady: Promise.resolve(), auth: mock.auth }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: unknown) => ({ field, op, value }) }));
vi.mock('../services/firebaseService', () => ({
  subscribeToCollection: (collection: string, callback: (orders: Order[]) => void) => {
    mock.listeners.push({ name: collection, callback });
    if (collection === 'orders') mock.onOrders = callback;
    return () => {};
  },
  subscribeToRecentCollection: () => () => {},
  subscribeToDocument: (_name: string, id: string, callback: (value: any) => void) => {
    mock.documents.push({ id, callback });
    return () => {};
  },
  fetchDateRange: async () => [],
  fetchCollection: mock.fetchCollection,
}));

const order = (id: string, companyId: 'taebaek' | 'punghoe') => ({ id, companyId }) as Order;

describe('과거 주문 회사 전환', () => {
  beforeEach(() => {
    mock.requests.length = 0;
    mock.onOrders = null;
    mock.fetchCollection.mockImplementation((collection: string, clauses: Array<{ field: string; value: unknown }>) => {
      if (collection !== 'orders') return Promise.resolve([]);
      return new Promise<Order[]>(resolve => {
        mock.requests.push({ company: String(clauses.find(clause => clause.field === 'companyId')?.value), resolve });
      });
    });
  });

  it('동일 범위를 새 회사에서 다시 조회하고 늦게 끝난 옛 회사 요청을 버린다', async () => {
    const { result, rerender } = renderHook(({ company }) => useAppData(true, company, true), {
      initialProps: { company: 'taebaek' as 'taebaek' | 'punghoe' },
    });
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(1));

    rerender({ company: 'punghoe' });
    expect(result.current.historicalOrders).toEqual([]);
    let newRequest!: Promise<void>;
    act(() => { newRequest = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(2));
    expect(mock.requests.map(request => request.company)).toEqual(['taebaek', 'punghoe']);

    await act(async () => { mock.requests[0].resolve([order('old', 'taebaek')]); await oldRequest; });
    expect(result.current.historicalOrders).toEqual([]);
    await act(async () => { mock.requests[1].resolve([order('new', 'punghoe')]); await newRequest; });
    expect(result.current.historicalOrders.map(value => value.id)).toEqual(['new']);
  });

  it('로그아웃 뒤 같은 회사로 다시 로그인해도 전 세션 이력을 즉시 노출하지 않는다', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAppData(enabled, 'taebaek', true), {
      initialProps: { enabled: true },
    });
    let request!: Promise<void>;
    act(() => { request = result.current.loadHistoricalOrders('2026-09-01', '2026-09-30'); });
    await waitFor(() => expect(mock.requests.length).toBe(1));
    await act(async () => { mock.requests[0].resolve([order('old', 'taebaek')]); await request; });
    expect(result.current.historicalOrders.map(value => value.id)).toEqual(['old']);
    rerender({ enabled: false });
    expect(result.current.historicalOrders).toEqual([]);
    rerender({ enabled: true });
    expect(result.current.historicalOrders).toEqual([]);
  });
});

it('회사 전환 직후 옛 회사 설정을 숨기고 늦은 설정 응답도 버린다', async () => {
  mock.documents.length = 0;
  mock.fetchCollection.mockResolvedValue([]);
  const { result, rerender } = renderHook(({ company }) => useAppData(true, company, true), {
    initialProps: { company: 'taebaek' as 'taebaek' | 'punghoe' },
  });
  await waitFor(() => expect(mock.documents).toHaveLength(1));
  const old = mock.documents[0];
  act(() => old.callback({ name: '태백' }));
  expect(result.current.companyInfo).toMatchObject({ name: '태백' });
  rerender({ company: 'punghoe' });
  expect(result.current.companyInfo).toBeNull();
  await waitFor(() => expect(mock.documents).toHaveLength(2));
  act(() => mock.documents[1].callback({ name: '풍회' }));
  act(() => old.callback({ name: '늦은 태백' }));
  expect(result.current.companyInfo).toMatchObject({ name: '풍회' });
});

it('직원은 재무 구독을 걸지 않고 회사 전환 뒤 늦은 업무 응답을 무시한다', async () => {
  mock.listeners.length = 0;
  mock.fetchCollection.mockResolvedValue([]);
  const { result, rerender } = renderHook(({ company }) => useAppData(true, company, false), {
    initialProps: { company: 'taebaek' as 'taebaek' | 'punghoe' },
  });
  await waitFor(() => expect(mock.listeners.some(row => row.name === 'items')).toBe(true));
  expect(mock.listeners.map(row => row.name)).not.toContain('issuedStatements');
  expect(mock.listeners.map(row => row.name)).not.toContain('cashEntries');
  const oldItems = mock.listeners.find(row => row.name === 'items')!;
  act(() => oldItems.callback([{ id: 'old', companyId: 'taebaek' }]));
  expect(result.current.items.map(row => row.id)).toEqual(['old']);
  rerender({ company: 'punghoe' });
  expect(result.current.items).toEqual([]);
  await waitFor(() => expect(mock.listeners.filter(row => row.name === 'items')).toHaveLength(2));
  const newItems = mock.listeners.filter(row => row.name === 'items')[1];
  act(() => newItems.callback([{ id: 'new', companyId: 'punghoe' }]));
  act(() => oldItems.callback([{ id: 'late', companyId: 'taebaek' }]));
  expect(result.current.items.map(row => row.id)).toEqual(['new']);
});

it('구독 월을 줄여도 오래된 진행 주문은 남기고 완료 주문만 완료일로 제한한다', async () => {
  const { result } = renderHook(() => useAppData(true, 'taebaek', true));
  await waitFor(() => expect(mock.onOrders).not.toBeNull());
  act(() => result.current.setOrdersMonths(1));
  await waitFor(() => expect(mock.onOrders).not.toBeNull());
  const active = [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DISPATCHED, OrderStatus.ON_HOLD]
    .map(status => ({ ...order(status, 'taebaek'), status, createdAt: '2020-01-01T00:00:00Z' }));
  const recentDone = { ...order('recent-done', 'taebaek'), status: OrderStatus.DELIVERED, createdAt: '2020-01-01T00:00:00Z', deliveredAt: today() };
  const oldDone = { ...order('old-done', 'taebaek'), status: OrderStatus.DELIVERED, createdAt: '2020-01-01T00:00:00Z', deliveredAt: '2020-01-02' };
  act(() => mock.onOrders!([...active, recentDone, oldDone]));
  expect(result.current.orders.map(value => value.id)).toEqual([...active.map(value => value.id), 'recent-done']);
});


describe('과거 주문 요청 순서와 공유', () => {
  const pending: Array<{resolve:(rows:Order[])=>void;reject:(error:Error)=>void}> = [];
  beforeEach(() => {
    pending.length = 0;
    mock.auth.currentUser = {uid:'actor-a'};
    mock.fetchCollection.mockImplementation((name:string) => name === 'orders'
      ? new Promise<Order[]>((resolve,reject) => pending.push({resolve,reject})) : Promise.resolve([]));
  });
  const start = (result: {current:ReturnType<typeof useAppData>}, from:string, to:string) => {
    let promise!:Promise<void>;
    act(() => { promise=result.current.loadHistoricalOrders(from,to); });
    return promise;
  };
  const finish = async (index:number,promise:Promise<void>,id:string) => {
    await act(async () => { pending[index].resolve([order(id,'taebaek')]); await promise; });
  };
  for (const reverse of [false,true]) it('월→전체 경합의 완료 순서와 무관하게 최신 전체 조회를 보존한다 '+reverse,async () => {
    const {result}=renderHook(()=>useAppData(true,'taebaek',true));
    const first=start(result,'2026-09-01','2026-10-31');await waitFor(()=>expect(pending).toHaveLength(1));
    const second=start(result,'2020-01-01','2026-10-31');await waitFor(()=>expect(pending).toHaveLength(2));
    if(reverse){await finish(1,second,'full');await finish(0,first,'month');}
    else{await finish(0,first,'month');expect(result.current.isLoadingHistoricalOrders).toBe(true);await finish(1,second,'full');}
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['full']);
    await act(async()=>{await result.current.loadHistoricalOrders('2021-01-01','2026-09-30');});
    expect(pending).toHaveLength(2);
  });
  it('진행중 전체와 포함된 월은 같은 Promise를 공유한다',async()=>{
    const {result}=renderHook(()=>useAppData(true,'taebaek',true));
    const whole=start(result,'2020-01-01','2026-10-31');
    const same=start(result,'2020-01-01','2026-10-31');
    const month=start(result,'2026-09-01','2026-09-30');
    expect(same).toBe(whole);expect(month).toBe(whole);
    await waitFor(()=>expect(pending).toHaveLength(1));await finish(0,whole,'full');
  });
  it('포함되지 않는 최신 조회가 실패하면 기존 자료와 완료 범위를 보존하고 재시도한다',async()=>{
    const {result}=renderHook(()=>useAppData(true,'taebaek',true));
    const initial=start(result,'2026-08-01','2026-08-31');await waitFor(()=>expect(pending).toHaveLength(1));await finish(0,initial,'saved');
    const old=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(2));
    const latest=start(result,'2026-10-01','2026-10-31');const rejected=latest.catch(error=>error.message);await waitFor(()=>expect(pending).toHaveLength(3));
    await act(async()=>{pending[2].reject(new Error('synthetic-read-error'));expect(await rejected).toBe('synthetic-read-error');});
    expect(result.current.isLoadingHistoricalOrders).toBe(false);expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['saved']);
    await finish(1,old,'stale');expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['saved']);
    await act(async()=>{await result.current.loadHistoricalOrders('2026-08-01','2026-08-31');});expect(pending).toHaveLength(3);
    const retry=start(result,'2026-10-01','2026-10-31');await waitFor(()=>expect(pending).toHaveLength(4));await finish(3,retry,'retry');
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['retry']);
  });
  it('같은 tick UID A→B→A 후 늦은 응답을 버리고 새 세대 조회를 허용한다',async()=>{
    const {result}=renderHook(()=>useAppData(true,'taebaek',true));
    const first=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(1));
    act(()=>{for(const uid of ['actor-b','actor-a']){mock.auth.currentUser={uid};for(const callback of mock.authListeners)callback(mock.auth.currentUser);}});
    await finish(0,first,'stale');expect(result.current.historicalOrders).toEqual([]);
    const fresh=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(2));await finish(1,fresh,'fresh');
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['fresh']);
  });
  it('auth callback과 같은 tick의 새 요청은 옛 진행중 Promise나 완료 캐시를 공유하지 않는다',async()=>{
    const {result}=renderHook(()=>useAppData(true,'taebaek',true));
    const old=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(1));
    let fresh!:Promise<void>;
    act(()=>{for(const uid of ['actor-b','actor-a']){mock.auth.currentUser={uid};for(const callback of mock.authListeners)callback(mock.auth.currentUser);}fresh=result.current.loadHistoricalOrders('2026-09-01','2026-09-30');});
    expect(fresh).not.toBe(old);await waitFor(()=>expect(pending).toHaveLength(2));await finish(1,fresh,'fresh');await finish(0,old,'old');
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['fresh']);
    let afterCache!:Promise<void>;
    act(()=>{for(const uid of ['actor-b','actor-a']){mock.auth.currentUser={uid};for(const callback of mock.authListeners)callback(mock.auth.currentUser);}afterCache=result.current.loadHistoricalOrders('2026-09-01','2026-09-30');});
    await waitFor(()=>expect(pending).toHaveLength(3));await finish(2,afterCache,'after-cache');
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['after-cache']);
  });
  it('실제 UID 변경과 disable 동안 옛 응답을 숨긴다',async()=>{
    const {result,rerender}=renderHook(({enabled})=>useAppData(enabled,'taebaek',true),{initialProps:{enabled:true}});
    const old=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(1));
    act(()=>{mock.auth.currentUser={uid:'actor-b'};for(const callback of mock.authListeners)callback(mock.auth.currentUser);});
    await finish(0,old,'old');expect(result.current.historicalOrders).toEqual([]);
    const fresh=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(2));
    rerender({enabled:false});await finish(1,fresh,'disabled');rerender({enabled:true});
    expect(result.current.historicalOrders).toEqual([]);
    const retry=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(3));await finish(2,retry,'new');
    expect(result.current.historicalOrders.map(row=>row.id)).toEqual(['new']);
  });
  it('unmount 후 완료된 요청은 공유 캐시에 반영되지 않는다',async()=>{
    const {result,unmount}=renderHook(()=>useAppData(true,'taebaek',true));
    const first=start(result,'2026-09-01','2026-09-30');await waitFor(()=>expect(pending).toHaveLength(1));unmount();
    await finish(0,first,'late');await act(async()=>{await result.current.loadHistoricalOrders('2026-09-01','2026-09-30');});
    expect(pending).toHaveLength(1);expect(mock.authListeners.size).toBe(0);
  });
});
