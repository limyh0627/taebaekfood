import OrderEditModalShell from './OrderEditModalShell';
/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrdersList from './OrdersList';
import { OrderStatus, type Order } from '../types';
import { today } from '../src/shared/day';
import {encodeCatalogValue} from '../src/shared/workOrderCommand';
import {workOrderWrites,type WorkOrderBindings} from '../src/shared/services/workOrderWrites';

const fixture = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'uid-a' } as { uid: string;getIdTokenResult?:()=>Promise<{claims:{companyId:string;employeeId:string}}> } | null },
  authCallbacks: [] as Array<(user: { uid: string } | null) => void>,
  subscriptions: [] as Array<{ id: string; callback: (doc: { names: string[] } | null) => void; stop: ReturnType<typeof vi.fn> }>,
  fetch: vi.fn(), write: vi.fn(),claimCompany:'taebaek',
}));
vi.mock('../src/shared/firebase', () => ({ auth: fixture.auth,authReady:Promise.resolve(),functions:{} }));
vi.mock('firebase/functions',()=>({httpsCallable:()=>async()=>{throw Error('등록하지 않은 합성 RPC입니다.');}}));
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
  fixture.claimCompany='taebaek';
  fixture.auth.currentUser = { uid: 'uid-a',getIdTokenResult:async()=>({claims:{companyId:fixture.claimCompany,employeeId:'employee'}}) }; fixture.authCallbacks = []; fixture.subscriptions = [];
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

it.each([null, { names: [] }])('다른 회사의 그룹 문서가 없거나 비면 기본값을 쓰고 늦은 이전 회사 응답은 버린다', async doc => {
  const p = { ...props(), orders: [{ ...order(), items: [{ itemId: 'oil', name: '검수기름', quantity: 1, price: 0 }] }],
    workOrderItems: [{ key: 'order-a-oil', orderId: 'order-a', itemId: 'oil', itemName: '검수기름', partnerName: '검수거래처', qty: 1, category: '기름' }] };
  const bindings:WorkOrderBindings={...workOrderWrites,open:async(scope,reference)=>({reference,actorUid:scope.actorUid,items:p.workOrderItems.map((item,index)=>({id:'group-row-'+index,data:encodeCatalogValue({...item,companyId:scope.companyId}),version:'1:000000001'})),groups:{exists:false,version:null,data:null},reset:{exists:false,version:null,data:null}})};
  const view = render(<OrdersList {...p} workOrderBindings={bindings}/>);
  await act(async()=>{});
  fireEvent.click(screen.getByRole('button', { name: /금일 작업순서/ }));
  const first = fixture.subscriptions[0]; act(() => first.callback({ names: ['회사A전용'] }));
  expect(screen.getByRole('region', { name: '회사A전용 작업순서' })).toBeTruthy();
  fixture.claimCompany='punghoe';view.rerender(<OrdersList {...p} companyId="punghoe" workOrderBindings={bindings}/>);
  await act(async()=>{});
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
  fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);fireEvent.click(screen.getByRole('button',{name:'로그'}));
  await act(async () => {}); expect(screen.queryByText('늦은A수정')).toBeNull();
});
it('부모 재렌더 없이 실제 로그인 UID가 바뀌면 로그를 닫고 늦은 응답을 버린다', async () => {
  const audits = deferred(), edits = deferred(); fixture.fetch.mockReturnValueOnce(audits.promise).mockReturnValueOnce(edits.promise);
  render(<OrdersList {...props()} />); openLog();
  act(() => { fixture.auth.currentUser = { uid: 'uid-b' }; fixture.authCallbacks.forEach(callback => callback(fixture.auth.currentUser)); });
  expect(screen.queryByRole('region', { name: '검수 주문 로그' })).toBeNull();
  await act(async () => { audits.resolve([]); edits.resolve([{ id: 'old', changes: ['이전직원수정'], at: today(), by: '검수' }]); });
  fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);fireEvent.click(screen.getByRole('button', { name: '로그' })); await act(async () => {});
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

it('주문 저장 오류는 스크롤 본문 밖의 저장 버튼과 같은 footer에서 보인다',()=>{const view=render(<OrderEditModalShell title="저장 오류 검수" partnerName="합성" context="주문일" onClose={()=>{}} onSave={()=>{}} saveError="현재 주문을 확인해 주세요."><div>긴 본문</div></OrderEditModalShell>);const error=screen.getByRole('alert'),save=screen.getByRole('button',{name:'변경 저장'});expect(save.closest('[data-order-edit-footer]')).toContainElement(error);expect(error).toHaveTextContent('현재 주문을 확인');expect(error.compareDocumentPosition(save)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();view.unmount();});

it('실제 주문 수정의 거절은 모달 복구 안내에 남고 초안은 유지된다',async()=>{const p=props(),save=vi.fn(async()=>({status:'rejected' as const,message:'완료된 품목의 수량은 되돌린 뒤 수정해 주세요.'}));const row={...order(),items:[{itemId:'oil',name:'검수기름',quantity:1,price:0}],note:'보존할 초안'};render(<OrdersList {...p} orders={[row]} onSaveOrderEdit={save}/>);fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'변경 저장'})));const dialog=screen.getByRole('dialog',{name:'거래처 주문 수정'}),button=within(dialog).getByRole('button',{name:'변경 저장'});expect(within(dialog).getByRole('status')).toHaveTextContent('완료된 품목의 수량');expect(button.closest('[data-order-edit-footer]')).not.toContainElement(within(dialog).getByRole('status'));expect(within(dialog).queryByRole('alert')).toBeNull();expect(screen.getByRole('dialog',{name:'거래처 주문 수정'})).toBeInTheDocument();expect(screen.getByDisplayValue('보존할 초안')).toBeInTheDocument();expect(save).toHaveBeenCalledOnce();});

it('같은 주문을 다시 연 새 초안은 이전 보관 요청의 결과 확인으로 닫히지 않는다',async()=>{
 const p=props(),row={...order(),items:[{itemId:'oil',name:'검수기름',quantity:1,price:0}],note:'보관 초안'};let pending:Array<{id:string;planId:string;description:string}>=[];
 const save=vi.fn(async()=>{pending=[{id:row.id,planId:'edit-plan',description:'보관 수정'}];return {status:'unknown' as const,message:'주문 응답 미확인',nextAction:'결과 확인 또는 요청 중단'};}),inspect=vi.fn(async()=>{pending=[];return {status:'saved' as const};});
 render(<OrdersList {...p} orders={[row]} onSaveOrderEdit={save} onReadPendingOrderEdits={()=>pending} onInspectOrderEdit={inspect}/>);fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'변경 저장'})));const dialog=screen.getByRole('dialog',{name:'거래처 주문 수정'});expect(within(dialog).getByRole('button',{name:'변경 저장'})).toBeDisabled();expect(within(dialog).getByDisplayValue('보관 초안')).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'취소'}));fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);const reopened=screen.getByRole('dialog',{name:'거래처 주문 수정'});fireEvent.change(within(reopened).getByDisplayValue('보관 초안'),{target:{value:'재열기 새 초안'}});
 await act(async()=>fireEvent.click(within(reopened).getByRole('button',{name:'주문 수정 결과 확인'})));expect(inspect).toHaveBeenCalledExactlyOnceWith('edit-plan',row.id);expect(save).toHaveBeenCalledOnce();expect(screen.getByRole('dialog',{name:'거래처 주문 수정'})).toBe(reopened);expect(within(reopened).getByDisplayValue('재열기 새 초안')).toBeInTheDocument();
});
it('보관 저장소 접근 오류는 모든 카드에 복제하지 않고 열려는 수정창에도 안내한다',()=>{render(<OrdersList {...props()} onReadPendingOrderEdits={()=>{throw Error('blocked');}}/>);expect(screen.getAllByText(/기기 저장소 접근/)).toHaveLength(1);fireEvent.click(screen.getAllByRole('button',{name:'검수거래처 주문 수정'})[0]);expect(within(screen.getByRole('dialog',{name:'거래처 주문 수정'})).getByRole('status')).toHaveTextContent('기기 저장소 접근');});

it('필터로 숨겨진 주문도 한곳에서 확인하고 다시 표시해도 복구 버튼은 중복되지 않는다',async()=>{const p=props(),pending=[{id:'order-a',planId:'retained-plan',description:'보관 수정'}],inspect=vi.fn(async()=>({status:'unknown' as const,message:'응답 미확인',nextAction:'중단 또는 다시 확인'}));render(<OrdersList {...p} onReadPendingOrderEdits={()=>pending} onInspectOrderEdit={inspect}/>);expect(screen.getAllByRole('button',{name:'주문 수정 결과 확인'})).toHaveLength(1);const search=screen.getByPlaceholderText('거래처, 품목, 제조, 라벨, 포장, 팔레트 검색');fireEvent.change(search,{target:{value:'검색 결과 없음'}});expect(screen.queryByRole('button',{name:'검수거래처 주문 수정'})).toBeNull();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 수정 결과 확인'})));expect(inspect).toHaveBeenCalledExactlyOnceWith('retained-plan','order-a');fireEvent.change(search,{target:{value:''}});expect(screen.getAllByRole('button',{name:'주문 수정 결과 확인'})).toHaveLength(1);});
it('실제 주문 행이 없어도 정확한 보관 참조를 중단하고 복구 버튼 대신 중단 결과를 남긴다',async()=>{let pending=[{id:'removed-order',planId:'removed-plan',description:'행이 없는 수정'}];const cancel=vi.fn(async()=>{pending=[];return {status:'cancelled' as const,message:'요청 중단 확인'};});render(<OrdersList {...props()} orders={[]} onReadPendingOrderEdits={()=>pending} onCancelOrderEdit={cancel}/>);expect(screen.getByRole('region',{name:'처리 결과 확인이 필요한 주문 수정'})).toHaveTextContent('removed-order');await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 수정 요청 중단'})));expect(cancel).toHaveBeenCalledExactlyOnceWith('removed-plan','removed-order');expect(screen.queryByRole('button',{name:'주문 수정 요청 중단'})).toBeNull();expect(screen.queryByRole('button',{name:'주문 수정 결과 확인'})).toBeNull();expect(screen.getByRole('region',{name:'처리 결과 확인이 필요한 주문 수정'})).toHaveTextContent('요청 중단 확인');});
