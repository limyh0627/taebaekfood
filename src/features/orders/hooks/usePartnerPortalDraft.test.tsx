/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {appConfirm} from '../../../shared/components/appDialog';
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(false)}));
import { usePartnerPortalDraft } from './usePartnerPortalDraft';
import type { Item, Partner, PartnerItem } from '../../../../types';
const partners = [{ id: 'a', name: 'A', type: '일반', email: 'a@example.invalid', region: '검수' } as Partner, { id: 'b', name: 'B', type: '일반' } as Partner];
const items = [{ id: 'p', name: '품목', type: 'product', unit: '개' } as Item];
const partnerItems = [{ id: 'l', partnerId: 'a', itemId: 'p', Direction: 'out', price: 1200 } as PartnerItem];
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const scopeSignal=new AbortController().signal;
function options(save: (order: any) => Promise<unknown>, exit = vi.fn(), readOrder:any=vi.fn().mockResolvedValue({kind:'unconfirmed',reason:'조회 실패'})) { return { companyId:'taebaek' as const,employeeId:'employee',getUid:()=> 'uid',getSignal:()=>scopeSignal,readOrder,partners, items, partnerItems, onOrderSubmit: save, onExit: exit }; }
function enter(result: {
    current: ReturnType<typeof usePartnerPortalDraft>;
}, id = 'a') {
    act(() => result.current.changePartnerInput(id));
    act(() => result.current.handleAuth({ preventDefault() { } } as React.FormEvent));
}
beforeEach(()=>vi.mocked(appConfirm).mockReset().mockResolvedValue(false));
afterEach(() => vi.restoreAllMocks());
it('같은 tick 중복송신과 pending의 모든 초안/이탈 handler를 막는다', async () => {
    const d = deferred(), save = vi.fn(() => d.promise), exit = vi.fn();
    const { result } = renderHook(() => usePartnerPortalDraft(options(save, exit)));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    let task!: Promise<void>;
    act(() => { task = result.current.handleSubmit(); void result.current.handleSubmit(); result.current.updateCart('p', 1); result.current.backToAuth(); result.current.changePartnerInput('b'); result.current.orderAgain(); result.current.exit(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(result.current.cart).toEqual({ p: 1 });
    expect(result.current.step).toBe('order');
    expect(result.current.partnerIdInput).toBe('a');
    await act(async () => { d.resolve(undefined); await task; });
    expect(result.current.step).toBe('confirm');
    expect(result.current.saving).toBe(false);
});
it('송신후 실패는 최초 수량/이유를 보존하고 서버 확인 뒤 명시 새 주문으로 재개한다', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const save = vi.fn().mockRejectedValueOnce(Error('검수 실패')).mockResolvedValueOnce(undefined);
    const read=vi.fn(async()=>({kind:'found',record:{...save.mock.calls[0][0],companyId:'taebaek',status:'processing'}}));
    const { result } = renderHook(() => usePartnerPortalDraft(options(save,vi.fn(),read)));
    enter(result);
    act(() => result.current.updateCart('p', 2));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.cart).toEqual({ p: 2 });
    expect(result.current.error).toContain('검수 실패');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.saving).toBe(false);
    await act(async () => { await result.current.handleSubmit(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.pending?.order.id).toBe(save.mock.calls[0][0].id);
    await act(async()=>{await result.current.readPending();});expect(read).toHaveBeenCalledTimes(1);expect(result.current.pending?.matches).toBe(true);
    act(()=>result.current.startNewOrder());expect(save).toHaveBeenCalledTimes(1);act(()=>result.current.updateCart('p',2));await act(async()=>{await result.current.handleSubmit();});
    expect(result.current.isSuccess).toBe(true);
    expect(save.mock.calls[0][0]).toMatchObject({ partnerId: 'a', totalAmount: 2400, email: 'a@example.invalid', region: '검수', items: [{ itemId: 'p', quantity: 2, price: 1200, checked: false }] });
});
it.each(['resolve', 'reject'] as const)('unmount 뒤 %s는 성공/오류를 반영하지 않는다', async (kind) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => { }), d = deferred();
    const { result, unmount } = renderHook(() => usePartnerPortalDraft(options(() => d.promise)));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    let task!: Promise<void>;
    act(() => { task = result.current.handleSubmit(); });
    unmount();
    await act(async () => {
        if (kind === 'resolve')
            d.resolve(undefined);
        else
            d.reject(Error('늦은 실패'));
        await task;
    });
    expect(alert).not.toHaveBeenCalled();
    expect(result.current.isSuccess).toBe(false);
});
it('정상 inline callback 재렌더는 진행을 취소하지 않으며 이후 새 callback을 쓴다', async () => {
    const d = deferred(), first = vi.fn(() => d.promise), next = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ save }) => usePartnerPortalDraft(options(save)), { initialProps: { save: first as (order: any) => Promise<unknown> } });
    enter(view.result);
    act(() => view.result.current.updateCart('p', 1));
    let task!: Promise<void>;
    act(() => { task = view.result.current.handleSubmit(); });
    view.rerender({ save: next });
    await act(async () => { d.resolve(undefined); await task; });
    expect(view.result.current.isSuccess).toBe(true);
    expect(next).not.toHaveBeenCalled();
    act(() => view.result.current.orderAgain());
    act(() => view.result.current.updateCart('p', 1));
    await act(async () => { await view.result.current.handleSubmit(); });
    expect(next).toHaveBeenCalledTimes(1);
});
it('거래처 A-B-A 명시 전환은 다른 초안을 소유하고 입력 음수는 기존처럼 0으로 제거한다', () => {
    const { result } = renderHook(() => usePartnerPortalDraft(options(vi.fn())));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    act(() => result.current.updateCart('p', -2));
    expect(result.current.cart).toEqual({});
    act(() => result.current.backToAuth());
    enter(result, 'b');
    expect(result.current.selectedClient?.id).toBe('b');
    act(() => result.current.backToAuth());
    enter(result, 'a');
    expect(result.current.selectedClient?.id).toBe('a');
});
it('카트품목이조회에서사라져도송신0·입력보존·잠금해제후다시작성한다', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const save = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ currentItems }) => usePartnerPortalDraft({ ...options(save), items: currentItems }), { initialProps: { currentItems: items } });
    enter(view.result);
    act(() => view.result.current.updateCart('p', 1));
    view.rerender({ currentItems: [] });
    await act(async () => { await view.result.current.handleSubmit().catch(() => { }); });
    expect(save).not.toHaveBeenCalled();
    expect(view.result.current.saving).toBe(false);
    expect(view.result.current.cart).toEqual({ p: 1 });
    expect(view.result.current.error).toContain('품목');
    view.rerender({ currentItems: items });
    act(() => view.result.current.updateCart('p', 1));
    await act(async () => { await view.result.current.handleSubmit(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(view.result.current.isSuccess).toBe(true);
});
it.each(['거래처삭제', '연결해제'] as const)('현재%s는송신0·원문보존·편집가능', async (kind) => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const save = vi.fn();
    const view = renderHook(({ currentPartners, currentLinks }) => usePartnerPortalDraft({ ...options(save), partners: currentPartners, partnerItems: currentLinks }), { initialProps: { currentPartners: partners, currentLinks: partnerItems } });
    enter(view.result);
    act(() => view.result.current.updateCart('p', 1));
    view.rerender({ currentPartners: kind === '거래처삭제' ? [] : partners, currentLinks: kind === '연결해제' ? [] : partnerItems });
    await act(async () => { await view.result.current.handleSubmit(); });
    expect(save).not.toHaveBeenCalled();
    expect(view.result.current.saving).toBe(false);
    expect(view.result.current.cart).toEqual({ p: 1 });
    expect(view.result.current.error).toContain(kind === '거래처삭제' ? '거래처' : '연결');
    act(() => view.result.current.updateCart('p', 1));
    expect(view.result.current.cart).toEqual({ p: 2 });
});
it.each([Infinity, NaN])('유한양수아닌수량%s는원문유지·잠금해제·송신0', async (qty) => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const save = vi.fn(), { result } = renderHook(() => usePartnerPortalDraft(options(save)));
    enter(result);
    act(() => result.current.updateCart('p', qty));
    await act(async () => { await result.current.handleSubmit(); });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toContain('유한');
    expect(result.current.cart.p).toBe(qty);
    act(() => result.current.orderAgain());
    act(() => result.current.updateCart('p', 1));
    expect(result.current.cart.p).toBe(1);
});
it('응답거절은미처리확정아닌확인안내·자동송신0이고기존WEB시간정책을유지한다', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const epoch = Date.parse('2026-10-24T03:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
    const save = vi.fn().mockRejectedValueOnce(Error('연결 끊김')).mockResolvedValue(undefined),read=vi.fn(async()=>({kind:'found',record:{...save.mock.calls[0][0],companyId:'taebaek'}})), { result } = renderHook(() => usePartnerPortalDraft(options(save,vi.fn(),read)));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.error).toContain('저장 결과를 확인하지 못했습니다');
    expect(result.current.error).toContain('주문 내역을 먼저 확인');
    expect(result.current.error).not.toContain('저장하지 못했습니다');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ id: 'WEB-' + epoch, deliveryDate: new Date(epoch + 86400000 * 3).toISOString() });
    vi.mocked(Date.now).mockReturnValue(epoch + 1000);
    await act(async () => { await result.current.handleSubmit(); });
    expect(save).toHaveBeenCalledTimes(1);expect(result.current.pending?.order.id).toBe('WEB-'+epoch);
    await act(async()=>{await result.current.readPending();});expect(read).toHaveBeenCalledTimes(1);expect(result.current.pending?.matches).toBe(true);act(()=>result.current.startNewOrder());expect(save).toHaveBeenCalledTimes(1);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});expect(save.mock.calls[1][0].id).toBe('WEB-'+(epoch+1000));
});
it('연결은있고판매단가미지정이면기존0가격합계정책을바꾸지않는다', async () => {
    const save = vi.fn().mockResolvedValue(undefined), { result } = renderHook(() => usePartnerPortalDraft({ ...options(save), partnerItems: [{ ...partnerItems[0], price: undefined }] }));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    await act(async () => { await result.current.handleSubmit(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 0, items: [expect.objectContaining({ quantity: 1, price: 0 })] }));
});

it('실저장 뒤 응답유실은 시각이 바뀌어도 두 번째 새 주문을 쓰지 않는다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});let tick=1000;vi.spyOn(Date,'now').mockImplementation(()=>tick);const stored=new Map<string,unknown>(),write=vi.fn(async(order:any)=>{stored.set(order.id,structuredClone(order));throw Error('응답유실');});const {result}=renderHook(()=>usePartnerPortalDraft(options(write)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});tick+=1000;await act(async()=>{await result.current.handleSubmit();});expect(write).toHaveBeenCalledTimes(1);expect(stored.size).toBe(1);});

it.each(['missing','error','mismatch','deleted','foreign'] as const)('미확인 주문 %s 결과는 원문을 보존하고 새 송신을 허용하지 않는다',async kind=>{vi.spyOn(window,'alert').mockImplementation(()=>{});const write=vi.fn().mockRejectedValue(new Error('unknown'));const read=vi.fn(async()=>{const original=write.mock.calls[0][0];if(kind==='missing')return {kind:'missing'};if(kind==='error')throw Error('조회 오류');return {kind:'found',record:{...original,companyId:kind==='foreign'?'punghoe':'taebaek',...(kind==='mismatch'?{totalAmount:999}:{}),...(kind==='deleted'?{deletedAt:'2026-01-01'}:{})}};});const {result}=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),read)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});const original=result.current.pending!.order;act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.readPending();result.current.startNewOrder();await result.current.handleSubmit();});expect(write).toHaveBeenCalledOnce();expect(result.current.pending?.order).toEqual(original);expect(result.current.cart).toEqual({p:2});expect(result.current.pending?.matches).toBe(false);expect(result.current.error).toBe('');expect(result.current.pending?.notice).not.toBe('');if(kind==='foreign')expect(result.current.pending?.result?.kind).toBe('unconfirmed');});
it('서버 확인은 같은 tick 중복을 잠그고 오류 뒤 실제 재조회만 한다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});const write=vi.fn().mockRejectedValue(Error('unknown')),d=deferred(),read=vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({kind:'missing'});const {result}=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),read)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});let first!:Promise<void>;act(()=>{first=result.current.readPending();void result.current.readPending();});expect(read).toHaveBeenCalledOnce();expect(read.mock.calls[0][0]).toBe(write.mock.calls[0][0].id);expect(read.mock.calls[0][1]).toBe('a');await act(async()=>{d.reject(Error('read'));await first;});await act(async()=>{await result.current.readPending();});expect(read).toHaveBeenCalledTimes(2);expect(write).toHaveBeenCalledOnce();expect(result.current.pending?.result).toEqual({kind:'missing'});});
it('조회 중 수정한 현재 카트는 원주문과 분리하고 후속 status/checked는 일치 판정에서 제외한다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});const write=vi.fn().mockRejectedValue(Error('unknown')),d=deferred(),read=vi.fn(()=>d.promise);const {result}=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),read)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});let task!:Promise<void>;act(()=>{task=result.current.readPending();result.current.updateCart('p',2);});const original=write.mock.calls[0][0];await act(async()=>{d.resolve({kind:'found',record:{...original,companyId:'taebaek',status:'processing',items:original.items.map((row:any)=>({...row,checked:true}))}});await task;});expect(result.current.pending?.matches).toBe(true);expect(result.current.cart).toEqual({p:3});expect(result.current.pending?.order.items[0].quantity).toBe(1);expect(write).toHaveBeenCalledOnce();});
it('Auth abort는 렌더 없는 UID ABA 뒤 옛 ACK와 pending 원문을 반영하지 않는다',async()=>{const d=deferred(),write=vi.fn(()=>d.promise),c=new AbortController();let uid='A';const {result}=renderHook(()=>usePartnerPortalDraft({...options(write),getUid:()=>uid,getSignal:()=>c.signal}));enter(result);act(()=>result.current.updateCart('p',1));let task!:Promise<void>;act(()=>{task=result.current.handleSubmit();});act(()=>{uid='B';c.abort();uid='A';});await act(async()=>{d.resolve(undefined);await task;});expect(result.current.isSuccess).toBe(false);expect(result.current.pending).toBeNull();expect(result.current.saving).toBe(false);expect(result.current.cart).toEqual({});});
it('회사와 직원 교체 뒤 옛 조회 결과는 새 pending을 덮지 않는다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});const oldRead=deferred(),write=vi.fn().mockRejectedValue(Error('unknown'));const view=renderHook(({employee})=>usePartnerPortalDraft({...options(write,vi.fn(),()=>oldRead.promise),employeeId:employee}),{initialProps:{employee:'first'}});enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});const old=view.result.current.pending!.order;let task!:Promise<void>;act(()=>{task=view.result.current.readPending();});view.rerender({employee:'second'});expect(view.result.current.pending).toBeNull();enter(view.result);act(()=>view.result.current.updateCart('p',2));await act(async()=>{await view.result.current.handleSubmit();});const next=view.result.current.pending;await act(async()=>{oldRead.resolve({kind:'found',record:{...old,companyId:'taebaek'}});await task;});expect(view.result.current.pending).toBe(next);expect(view.result.current.pending?.result).toBeNull();});
it('unmount 뒤 조회 결과와 오류는 화면을 갱신하지 않는다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});const d=deferred(),write=vi.fn().mockRejectedValue(Error('unknown')),view=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),()=>d.promise)));enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});let task!:Promise<void>;act(()=>{task=view.result.current.readPending();});view.unmount();await act(async()=>{d.reject(Error('late'));await task;});expect(write).toHaveBeenCalledOnce();});
it('정상 ACK는 서버 조회 없이 바로 완료하며 미확인 이탈은 명시 경고한다',async()=>{const read=vi.fn(),write=vi.fn().mockResolvedValue(undefined),exit=vi.fn(),confirm=vi.mocked(appConfirm).mockResolvedValue(false);vi.spyOn(window,'alert').mockImplementation(()=>{});const {result}=renderHook(()=>usePartnerPortalDraft(options(write,exit,read)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});expect(result.current.isSuccess).toBe(true);expect(read).not.toHaveBeenCalled();act(()=>result.current.orderAgain());act(()=>result.current.updateCart('p',1));write.mockRejectedValueOnce(Error('unknown'));await act(async()=>{await result.current.handleSubmit();});await act(async()=>{await result.current.exit();});expect(exit).not.toHaveBeenCalled();expect(confirm).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining(result.current.pending!.order.id)}));confirm.mockResolvedValue(true);await act(async()=>{await result.current.exit();});expect(exit).toHaveBeenCalledOnce();});

it('새 owner의 확인이 먼저 끝난 뒤 옛 조회가 도착해도 현재 확인을 유지한다',async()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});let tick=1000;vi.spyOn(Date,'now').mockImplementation(()=>tick);const d=deferred(),write=vi.fn().mockRejectedValue(Error('unknown')),read=vi.fn().mockReturnValueOnce(d.promise).mockImplementation(async()=>({kind:'found',record:{...write.mock.calls.at(-1)![0],companyId:'taebaek'}}));const view=renderHook(({employee})=>usePartnerPortalDraft({...options(write,vi.fn(),read),employeeId:employee}),{initialProps:{employee:'first'}});enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});const first=view.result.current.pending!.order;let task!:Promise<void>;act(()=>{task=view.result.current.readPending();});view.rerender({employee:'second'});tick=2000;enter(view.result);act(()=>view.result.current.updateCart('p',2));await act(async()=>{await view.result.current.handleSubmit();await view.result.current.readPending();});expect(view.result.current.pending?.matches).toBe(true);expect(view.result.current.pending?.order.id).toBe('WEB-2000');await act(async()=>{d.resolve({kind:'found',record:{...first,companyId:'taebaek'}});await task;});expect(view.result.current.pending?.matches).toBe(true);expect(view.result.current.pending?.order.id).toBe('WEB-2000');expect(read).toHaveBeenCalledTimes(2);});

it('일치 조회 뒤 재조회 거절은 이전 확인을 폐기하고 원문을 보존한다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});
 const write=vi.fn().mockRejectedValue(Error('unknown'));
 const read=vi.fn().mockImplementationOnce(async()=>({kind:'found',record:{...write.mock.calls[0][0],companyId:'taebaek'}})).mockRejectedValueOnce(Error('read')).mockImplementation(async()=>({kind:'found',record:{...write.mock.calls[0][0],companyId:'taebaek'}}));
 const {result}=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),read)));enter(result);act(()=>result.current.updateCart('p',1));
 await act(async()=>{await result.current.handleSubmit();await result.current.readPending();});
 expect(result.current.pending?.matches).toBe(true);const original=result.current.pending!.order;
 await act(async()=>{await result.current.readPending();});
 expect(result.current.pending?.matches).toBe(false);expect(result.current.pending?.result?.kind).toBe('unconfirmed');
 act(()=>result.current.startNewOrder());expect(result.current.pending?.order).toEqual(original);expect(result.current.cart).toEqual({p:1});expect(write).toHaveBeenCalledOnce();
 await act(async()=>{await result.current.readPending();});act(()=>result.current.startNewOrder());expect(result.current.pending).toBeNull();expect(write).toHaveBeenCalledOnce();
});
it('송신 대기 중 직접 조회와 새업무 처리기는 원실행을 무효화하지 않는다',async()=>{
 const d=deferred(),write=vi.fn<(order:any)=>Promise<unknown>>(()=>d.promise),read=vi.fn(async()=>({kind:'found',record:{...write.mock.calls[0][0],companyId:'taebaek'}}));
 const {result}=renderHook(()=>usePartnerPortalDraft(options(write,vi.fn(),read)));enter(result);act(()=>result.current.updateCart('p',1));let task!:Promise<void>;
 act(()=>{task=result.current.handleSubmit();});const original=result.current.pending!.order;
 await act(async()=>{await result.current.readPending();});act(()=>result.current.startNewOrder());
 expect(read).not.toHaveBeenCalled();expect(result.current.pending?.order).toEqual(original);expect(result.current.saving).toBe(true);
 await act(async()=>{d.resolve(undefined);await task;});expect(result.current.isSuccess).toBe(true);expect(result.current.saving).toBe(false);expect(result.current.pending).toBeNull();expect(write).toHaveBeenCalledOnce();
 act(()=>result.current.orderAgain());act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});expect(write).toHaveBeenCalledTimes(2);
});

it('앱 이탈 확인은 같은 tick 한 번만 열고 취소와 거절 뒤 다시 확인할 수 있다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});const dialog=deferred(),confirm=vi.mocked(appConfirm).mockReturnValueOnce(dialog.promise as Promise<boolean>).mockResolvedValue(false),exit=vi.fn(),write=vi.fn().mockRejectedValue(Error('unknown'));
 const {result}=renderHook(()=>usePartnerPortalDraft(options(write,exit)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});const original=result.current.pending;
 let task!:Promise<void>;act(()=>{task=result.current.exit();void result.current.exit();});expect(confirm).toHaveBeenCalledOnce();await act(async()=>{dialog.resolve(false);await task;});expect(exit).not.toHaveBeenCalled();expect(result.current.pending).toBe(original);expect(result.current.cart).toEqual({p:1});
 confirm.mockRejectedValueOnce(Error('host'));await act(async()=>{await result.current.exit();});expect(result.current.pending).toBe(original);expect(exit).not.toHaveBeenCalled();confirm.mockResolvedValue(true);await act(async()=>{await result.current.exit();});expect(exit).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledOnce();
});
it.each(['abort','unmount','edit','new-order','new-order-pending'] as const)('앱 확인 대기 중 %s 뒤 옛 승인은 화면을 닫지 않는다',async kind=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});const d=deferred(),signal=new AbortController(),exit=vi.fn(),write=vi.fn().mockRejectedValueOnce(Error('unknown')).mockResolvedValue(undefined),read=vi.fn(async()=>({kind:'found',record:{...write.mock.calls[0][0],companyId:'taebaek'}}));vi.mocked(appConfirm).mockReturnValueOnce(d.promise as Promise<boolean>);let uid='uid';
 const view=renderHook(()=>usePartnerPortalDraft({...options(write,exit,read),getSignal:()=>signal.signal,getUid:()=>uid}));enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});let task!:Promise<void>;act(()=>{task=view.result.current.exit();});
 if(kind==='abort')act(()=>{uid='B';signal.abort();uid='uid';});else if(kind==='unmount')view.unmount();else if(kind==='edit')act(()=>view.result.current.updateCart('p',1));else {await act(async()=>{await view.result.current.readPending();});act(()=>view.result.current.startNewOrder());act(()=>view.result.current.updateCart('p',2));if(kind==='new-order-pending'){const save=deferred();write.mockReturnValueOnce(save.promise);let nextTask!:Promise<void>;act(()=>{nextTask=view.result.current.handleSubmit();});expect(view.result.current.saving).toBe(true);await act(async()=>{d.resolve(true);await task;});expect(exit).not.toHaveBeenCalled();await act(async()=>{save.resolve(undefined);await nextTask;});expect(view.result.current.isSuccess).toBe(true);}else{await act(async()=>{await view.result.current.handleSubmit();});expect(view.result.current.isSuccess).toBe(true);}}
 await act(async()=>{d.resolve(true);await task;});expect(exit).not.toHaveBeenCalled();if(kind==='edit'){expect(view.result.current.cart).toEqual({p:2});expect(view.result.current.pending).not.toBeNull();}
});
it('옛 owner 확인 finally는 새 owner 확인 잠금을 풀지 않으며 최신 닫기 callback을 쓴다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});const first=deferred(),next=deferred(),confirm=vi.mocked(appConfirm).mockReturnValueOnce(first.promise as Promise<boolean>).mockReturnValueOnce(next.promise as Promise<boolean>),write=vi.fn().mockRejectedValue(Error('unknown')),oldExit=vi.fn(),newExit=vi.fn();
 const view=renderHook(({employee,exit})=>usePartnerPortalDraft({...options(write,exit),employeeId:employee}),{initialProps:{employee:'old',exit:oldExit}});enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});let a!:Promise<void>,b!:Promise<void>;act(()=>{a=view.result.current.exit();});view.rerender({employee:'new',exit:newExit});enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});act(()=>{b=view.result.current.exit();});await act(async()=>{first.resolve(true);await a;});act(()=>{void view.result.current.exit();});expect(confirm).toHaveBeenCalledTimes(2);await act(async()=>{next.resolve(true);await b;});expect(oldExit).not.toHaveBeenCalled();expect(newExit).toHaveBeenCalledOnce();
});
it('host가 없으면 앱 확인은 false로 끝나고 원문을 보존한다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});vi.mocked(appConfirm).mockResolvedValue(false);const exit=vi.fn(),write=vi.fn().mockRejectedValue(Error('unknown'));const {result}=renderHook(()=>usePartnerPortalDraft(options(write,exit)));enter(result);act(()=>result.current.updateCart('p',1));await act(async()=>{await result.current.handleSubmit();});const original=result.current.pending;await act(async()=>{await result.current.exit();});expect(exit).not.toHaveBeenCalled();expect(result.current.pending).toBe(original);
});

it('확인 대기 중 읽기만 완료하면 같은 원요청을 최신 닫기 callback으로 나간다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});const d=deferred(),first=vi.fn(),latest=vi.fn(),write=vi.fn().mockRejectedValue(Error('unknown')),read=vi.fn(async()=>({kind:'found',record:{...write.mock.calls[0][0],companyId:'taebaek'}}));vi.mocked(appConfirm).mockReturnValueOnce(d.promise as Promise<boolean>);
 const view=renderHook(({exit})=>usePartnerPortalDraft(options(write,exit,read)),{initialProps:{exit:first}});enter(view.result);act(()=>view.result.current.updateCart('p',1));await act(async()=>{await view.result.current.handleSubmit();});let task!:Promise<void>;act(()=>{task=view.result.current.exit();});await act(async()=>{await view.result.current.readPending();});view.rerender({exit:latest});await act(async()=>{d.resolve(true);await task;});expect(first).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledOnce();expect(view.result.current.pending?.matches).toBe(true);
});
