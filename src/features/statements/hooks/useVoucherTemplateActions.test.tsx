// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVoucherTemplateActions } from './useVoucherTemplateActions';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as {
            uid: string;
        } | null }, listeners: new Set<(u: {
        uid: string;
    } | null) => void>(), notice: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: m.auth }));
vi.mock('../../../shared/components/appDialog', () => ({ appNotice: m.notice }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_a: unknown, cb: (u: {
        uid: string;
    } | null) => void) => { m.listeners.add(cb); cb(m.auth.currentUser); return () => m.listeners.delete(cb); } }));
const deferred = () => { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
beforeEach(() => { m.auth.currentUser = { uid: 'a' }; m.notice.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); m.listeners.clear(); });
it('같은 tick의 두 실행은 첫 실행만 예약하고 완료 뒤 재시도한다', async () => {
    const h = renderHook(() => useVoucherTemplateActions('taebaek'));
    const d = deferred();
    const write = vi.fn(() => d.promise);
    let first!: Promise<void>;
    act(() => { first = h.result.current.runAction(write); void h.result.current.runAction(write); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.result.current.busy).toBe(true);
    await act(async () => { d.resolve(); await first; });
    expect(h.result.current.busy).toBe(false);
    await act(async () => { await h.result.current.runAction(async () => { }); });
    expect(h.result.current.busy).toBe(false);
});
it('rerender 없는 실제 UID 교체도 지연 작업의 current를 무효화한다', async () => {
    const h = renderHook(() => useVoucherTemplateActions('taebaek'));
    const d = deferred();
    const write = vi.fn();
    let p!: Promise<void>;
    act(() => { p = h.result.current.runAction(async (current) => { await d.promise; if (current())
        write(); }); });
    m.auth.currentUser = { uid: 'b' };
    await act(async () => { d.resolve(); await p; });
    expect(write).not.toHaveBeenCalled();
});
it('회사 변경과 unmount는 이전 current와 handler를 폐기한다', async () => {
    const h = renderHook(({ company }: {
        company: 'taebaek' | 'punghoe';
    }) => useVoucherTemplateActions(company), { initialProps: { company: 'taebaek' } });
    const old = h.result.current;
    h.rerender({ company: 'punghoe' });
    const write = vi.fn();
    await act(async () => { await old.runAction(write); });
    expect(write).not.toHaveBeenCalled();
    const latest = h.result.current;
    h.unmount();
    await latest.runAction(write);
    expect(write).not.toHaveBeenCalled();
});
it('UID 왕복 뒤 old reject와 finally는 새 busy와 오류를 건드리지 않는다', async () => {
    const h = renderHook(() => useVoucherTemplateActions('taebaek'));
    const old = deferred(), fresh = deferred();
    let p!: Promise<void>, q!: Promise<void>;
    act(() => { p = h.result.current.runAction(() => old.promise); });
    act(() => { m.auth.currentUser = { uid: 'b' }; m.listeners.forEach(cb => cb(m.auth.currentUser)); });
    act(() => { m.auth.currentUser = { uid: 'a' }; m.listeners.forEach(cb => cb(m.auth.currentUser)); });
    act(() => { q = h.result.current.runAction(() => fresh.promise); });
    await act(async () => { old.reject(new Error('old')); await p; });
    expect(h.result.current.busy).toBe(true);
    expect(m.notice).not.toHaveBeenCalled();
    await act(async () => { fresh.reject(new Error('fresh')); await q; });
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(h.result.current.busy).toBe(false);
});
it('실패는 현재 실행의 입력을 유지하고 다시 실행할 수 있다', async () => {
    const h = renderHook(() => useVoucherTemplateActions('taebaek'));
    await act(async () => { await h.result.current.runAction(async () => { throw new Error('거절'); }); });
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(h.result.current.canInteract()).toBe(true);
    const write = vi.fn().mockResolvedValue(undefined);
    await act(async () => { await h.result.current.runAction(write); });
    expect(write).toHaveBeenCalledTimes(1);
});
it('StrictMode 재설정 뒤 정상 실행과 listener 해제를 보존한다', async () => {
    const h = renderHook(() => useVoucherTemplateActions('taebaek'), { wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode> });
    const write = vi.fn().mockResolvedValue(undefined);
    await act(async () => { await h.result.current.runAction(write); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(m.listeners.size).toBe(1);
    h.unmount();
    expect(m.listeners.size).toBe(0);
});
