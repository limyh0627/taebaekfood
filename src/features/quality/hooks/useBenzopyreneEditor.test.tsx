/** @vitest-environment jsdom */
import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ uid: 'u', events: new Set<(u: {
        uid: string;
    }) => void>(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: { get currentUser() { return { uid: m.uid }; }, onAuthStateChanged: (cb: (u: {
            uid: string;
        }) => void) => { m.events.add(cb); queueMicrotask(() => { if (m.events.has(cb))
            cb({ uid: m.uid }); }); return () => m.events.delete(cb); } } }));
vi.mock('../../../shared/services/firebaseService', () => ({ addItem: m.add, updateItem: m.update, deleteItem: m.remove }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: m.confirm }));
import { useBenzopyreneEditor, type BenzopyreneTest } from './useBenzopyreneEditor';
const row: BenzopyreneTest = { id: 'a', productName: '제품', receivedDate: '2026-10-01', completedDate: '2026-10-02', testItem: '벤조피렌', criteria: '기존 기준', result: '0.1', judgment: '적합', lotNo: 'lot', createdAt: '2026-10-02', addedBy: '담당자' };
const options = { companyId: 'taebaek' as 'taebaek' | 'punghoe', currentUserName: '새담당', isAdmin: true };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
beforeEach(() => { m.uid = 'u'; m.events.clear(); m.add.mockReset().mockResolvedValue(undefined); m.update.mockReset().mockResolvedValue(undefined); m.remove.mockReset().mockResolvedValue(undefined); m.confirm.mockReset().mockResolvedValue(true); vi.spyOn(window, 'alert').mockImplementation(() => { }); vi.spyOn(console, 'error').mockImplementation(() => { }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('같은tick 저장·입력·취소·다른행수정은 공통ref로 잠그고 기존payload를 보존한다', async () => {
    const d = deferred<void>();
    m.update.mockReturnValue(d.promise);
    const h = renderHook(() => useBenzopyreneEditor(options));
    act(() => h.result.current.startEdit(row));
    let run!: Promise<void>;
    act(() => { run = h.result.current.saveEdit(); h.result.current.cancelEdit(); h.result.current.startEdit({ ...row, id: 'b' }); h.result.current.setEditRow({ ...row, result: '침범' }); void h.result.current.saveEdit(); });
    expect(m.update).toHaveBeenCalledOnce();
    expect(h.result.current.editingId).toBe('a');
    expect(h.result.current.editRow?.result).toBe('0.1');
    const { id, ...data } = row;
    expect(m.update).toHaveBeenCalledWith('benzopyreneTests', id, data);
    await act(async () => { d.resolve(); await run; });
    expect(h.result.current.editRow).toBeNull();
});
it('추가payload trim·기준·날짜·판정·addedBy정책을 유지하고 실패 원초안 재시도가 가능하다', async () => {
    const h = renderHook(() => useBenzopyreneEditor(options));
    act(() => h.result.current.setDraft(d => ({ ...d, productName: ' 제품 ', result: ' 0.1 ', judgment: '부적합', receivedDate: '2026-09-01' })));
    m.add.mockRejectedValueOnce(Error('실패'));
    await act(async () => h.result.current.addRow());
    expect(h.result.current.draft.productName).toBe(' 제품 ');
    expect(h.result.current.busy).toBe(false);
    await act(async () => h.result.current.addRow());
    expect(m.add).toHaveBeenCalledTimes(2);
    expect(m.add.mock.calls[0][1]).toMatchObject({ productName: '제품', result: '0.1', criteria: '2.0 μg/kg 이하', judgment: '부적합', receivedDate: '2026-09-01', addedBy: '새담당', createdAt: expect.any(String) });
    expect(h.result.current.draft.productName).toBe('');
});
it.each(['uid', 'admin', 'company', 'unmount'] as const)('삭제 확인 중 %s 변경은 송신하지 않는다', async (mode) => {
    const d = deferred<boolean>();
    m.confirm.mockReturnValue(d.promise);
    const h = renderHook(props => useBenzopyreneEditor(props), { initialProps: options });
    let run!: Promise<void>;
    act(() => { run = h.result.current.removeRow('a'); });
    if (mode === 'uid')
        m.uid = 'other';
    else if (mode === 'admin')
        h.rerender({ ...options, isAdmin: false });
    else if (mode === 'company')
        h.rerender({ ...options, companyId: 'punghoe' });
    else
        h.unmount();
    await act(async () => { d.resolve(true); await run; });
    expect(m.remove).not.toHaveBeenCalled();
});
it('실UID A-B-A token세대 이후 옛응답은 새초안·busy를 건드리지 않는다', async () => {
    const a = deferred<void>(), b = deferred<void>();
    m.update.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const h = renderHook(() => useBenzopyreneEditor(options));
    act(() => h.result.current.startEdit(row));
    let old!: Promise<void>, fresh!: Promise<void>;
    act(() => { old = h.result.current.saveEdit(); });
    await act(async () => { await Promise.resolve(); });
    act(() => { m.uid = 'other'; for (const event of m.events)
        event({ uid: m.uid }); });
    act(() => { m.uid = 'u'; for (const event of m.events)
        event({ uid: m.uid }); });
    act(() => h.result.current.startEdit({ ...row, id: 'b', result: '새값' }));
    act(() => { fresh = h.result.current.saveEdit(); });
    await act(async () => { a.reject(Error('옛 오류')); await old; });
    expect(h.result.current.editingId).toBe('b');
    expect(h.result.current.editRow?.result).toBe('새값');
    expect(h.result.current.busy).toBe(true);
    expect(window.alert).not.toHaveBeenCalled();
    await act(async () => { b.resolve(); await fresh; });
    expect(h.result.current.editingId).toBeNull();
});
it('이전 scope초안은 새scope 삭제ACK로 되살아나지 않는다', async () => {
    const h = renderHook(props => useBenzopyreneEditor(props), { initialProps: options });
    act(() => { h.result.current.setDraft(d => ({ ...d, productName: '옛 제품' })); h.result.current.startEdit(row); });
    h.rerender({ ...options, companyId: 'punghoe' });
    await act(async () => h.result.current.removeRow('b'));
    expect(h.result.current.draft.productName).toBe('');
    expect(h.result.current.editRow).toBeNull();
});
it.each(['cancel', 'confirm-error', 'delete-error'] as const)('삭제 %s 후 현재run 잠금이 풀리고 다시 실행한다', async (mode) => {
    const h = renderHook(() => useBenzopyreneEditor(options));
    if (mode === 'cancel')
        m.confirm.mockResolvedValueOnce(false);
    if (mode === 'confirm-error')
        m.confirm.mockRejectedValueOnce(Error('확인 실패'));
    if (mode === 'delete-error')
        m.remove.mockRejectedValueOnce(Error('삭제 실패'));
    await act(async () => h.result.current.removeRow('a'));
    expect(h.result.current.busy).toBe(false);
    await act(async () => h.result.current.removeRow('a'));
    expect(m.remove).toHaveBeenCalledTimes(mode === 'delete-error' ? 2 : 1);
});
it('StrictMode 실제마운트에서도 수정과 추가를 실행할 수 있다', async () => {
    const h = renderHook(() => useBenzopyreneEditor(options), { wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode> });
    act(() => h.result.current.setDraft(d => ({ ...d, productName: '현재 제품' })));
    await act(async () => h.result.current.addRow());
    expect(m.add).toHaveBeenCalledOnce();
});
