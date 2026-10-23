/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useClosingStockEditor } from './useClosingStockEditor';
function deferred() { let resolve!: (ok: boolean) => void, reject!: (e: Error) => void; const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const scope = {};
it('첫await전 같은tick 잠금과 입력/선택/취소를 보호한다', async () => {
    const d = deferred(), write = vi.fn(() => d.promise);
    const { result } = renderHook(() => useClosingStockEditor({ scope, modalOpen: true, view: 'stock', getUid: () => 'u' }));
    act(() => result.current.open('p', '5'));
    let task!: Promise<boolean>;
    act(() => { task = result.current.execute('p', '5', write); void result.current.execute('p', '7', write); result.current.setValue('9'); result.current.open('q', '10'); result.current.cancel(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.value).toBe('5');
    expect(result.current.id).toBe('p');
    await act(async () => { d.resolve(true); await task; });
    expect(result.current.id).toBeNull();
    expect(result.current.busy).toBe(false);
});
it('false와throw는 입력을 보존하고 미반영으로 단정하지 않는다', async () => {
    const { result } = renderHook(() => useClosingStockEditor({ scope, modalOpen: true, view: 'stock', getUid: () => 'u' }));
    await act(async () => { await result.current.execute('p', '5', async () => false); });
    expect(result.current.value).toBe('5');
    expect(result.current.error).toContain('처리 결과');
    await act(async () => { await result.current.execute('p', '5', async () => { throw Error('합성거절'); }); });
    expect(result.current.error).toContain('합성거절');
    expect(result.current.id).toBe('p');
});
it('명시 확인취소는 이전 초안을 복원하고 오류로 표시하지 않는다', async () => {
    const { result } = renderHook(() => useClosingStockEditor({ scope, modalOpen: true, view: 'stock', getUid: () => 'u' }));
    act(() => result.current.open('a', '8'));
    await act(async () => { await result.current.execute('b', '0', async () => 'cancelled'); });
    expect(result.current.id).toBe('a');
    expect(result.current.value).toBe('8');
    expect(result.current.error).toBe('');
    expect(result.current.busy).toBe(false);
});
it('모달닫기/보기왕복 뒤 옛 응답/finally는 새 저장잠금을 해제하지 않는다', async () => {
    const a = deferred(), b = deferred();
    const { result, rerender } = renderHook(({ open, view }) => useClosingStockEditor({ scope, modalOpen: open, view, getUid: () => 'u' }), { initialProps: { open: true, view: 'stock' } });
    let first!: Promise<boolean>, next!: Promise<boolean>;
    act(() => { first = result.current.execute('p', '5', () => a.promise); });
    rerender({ open: false, view: 'all' });
    rerender({ open: true, view: 'stock' });
    act(() => { next = result.current.execute('q', '9', () => b.promise); });
    await act(async () => { a.resolve(true); await first; });
    expect(result.current.id).toBe('q');
    expect(result.current.busy).toBe(true);
    await act(async () => { b.resolve(true); await next; });
    expect(result.current.busy).toBe(false);
});
it('실UID없음/렌더전UID교체는 실행0이며 scope새owner는 옛오류를 무시한다', async () => {
    let uid: string | undefined = 'u';
    const d = deferred(), write = vi.fn(() => d.promise);
    const { result, rerender } = renderHook(({ owner }) => useClosingStockEditor({ scope: owner, modalOpen: true, view: 'stock', getUid: () => uid }), { initialProps: { owner: scope } });
    uid = undefined;
    await act(async () => { await result.current.execute('p', '5', write); });
    uid = 'other';
    await act(async () => { await result.current.execute('p', '5', write); });
    expect(write).not.toHaveBeenCalled();
    uid = 'u';
    let task!: Promise<boolean>;
    act(() => { task = result.current.execute('p', '5', write); });
    rerender({ owner: {} });
    await act(async () => { d.reject(Error('옛거절')); await task; });
    expect(result.current.error).toBe('');
    expect(result.current.id).toBeNull();
});
it('unmount 뒤 own검사는 false이며 늦은결과는 종료한다', async () => {
    const d = deferred();
    let own!: () => boolean;
    const { result, unmount } = renderHook(() => useClosingStockEditor({ scope, modalOpen: true, view: 'stock', getUid: () => 'u' }));
    let task!: Promise<boolean>;
    act(() => { task = result.current.execute('p', '5', current => { own = current; return d.promise; }); });
    unmount();
    expect(own()).toBe(false);
    d.resolve(true);
    expect(await task).toBe(false);
});
