/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePartnerPortalDraft } from './usePartnerPortalDraft';
import type { Item, Partner, PartnerItem } from '../../../../types';
const partners = [{ id: 'a', name: 'A', type: '일반', email: 'a@example.invalid', region: '검수' } as Partner, { id: 'b', name: 'B', type: '일반' } as Partner];
const items = [{ id: 'p', name: '품목', type: 'product', unit: '개' } as Item];
const partnerItems = [{ id: 'l', partnerId: 'a', itemId: 'p', Direction: 'out', price: 1200 } as PartnerItem];
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function options(save: (order: any) => Promise<unknown>, exit = vi.fn()) { return { partners, items, partnerItems, onOrderSubmit: save, onExit: exit }; }
function enter(result: {
    current: ReturnType<typeof usePartnerPortalDraft>;
}, id = 'a') {
    act(() => result.current.changePartnerInput(id));
    act(() => result.current.handleAuth({ preventDefault() { } } as React.FormEvent));
}
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
it('실패는 최초 수량/이유를 보존하고 명시 재시도 ACK 뒤에만 성공한다', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => { });
    const save = vi.fn().mockRejectedValueOnce(Error('검수 실패')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePartnerPortalDraft(options(save)));
    enter(result);
    act(() => result.current.updateCart('p', 2));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.cart).toEqual({ p: 2 });
    expect(result.current.error).toContain('검수 실패');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.saving).toBe(false);
    await act(async () => { await result.current.handleSubmit(); });
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
    const save = vi.fn().mockRejectedValueOnce(Error('연결 끊김')).mockResolvedValue(undefined), { result } = renderHook(() => usePartnerPortalDraft(options(save)));
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
    expect(save.mock.calls[1][0].id).toBe('WEB-' + (epoch + 1000));
});
it('연결은있고판매단가미지정이면기존0가격합계정책을바꾸지않는다', async () => {
    const save = vi.fn().mockResolvedValue(undefined), { result } = renderHook(() => usePartnerPortalDraft({ ...options(save), partnerItems: [{ ...partnerItems[0], price: undefined }] }));
    enter(result);
    act(() => result.current.updateCart('p', 1));
    await act(async () => { await result.current.handleSubmit(); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 0, items: [expect.objectContaining({ quantity: 1, price: 0 })] }));
});
