/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePurchaseCartDraft } from './usePurchaseCartDraft';
import { buildBomIndex } from '../../../shared/bomIndex';
import { buildPackIndex } from '../../../shared/packIndex';
import type { CompanyId, Item } from '../../../shared/types';
const item = { id: 'p', name: '상품', type: 'product', unit: '개', spec: '1kg * 10', stock: 0, minStock: 0, image: '', companyId: 'taebaek' } as Item;
const inputs = { bom: buildBomIndex([item], []), pack: buildPackIndex([{ item_id: 'p', units_per_box: 10 }]) };
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const rows = [{ id: 'p', qty: 2, isBox: false, partnerId: 's' }];
it('같은tick submit1/모든setter/clear/X를 동기잠금으로 보호한다', async () => {
    const d = deferred(), save = vi.fn(() => d.promise), committed = vi.fn();
    const { result } = renderHook(() => usePurchaseCartDraft({ companyId: 'taebaek', getUid: () => 'u', items: [item], inputs, save, onCommitted: committed }));
    act(() => { result.current.setCart(rows); result.current.setPanel(true); });
    let task!: Promise<void>;
    act(() => { task = result.current.submit(); void result.current.submit(); result.current.setCart([]); result.current.setCart(old => [...old, { id: 'new', qty: 1, isBox: false }]); result.current.setPanel(false); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.cart).toEqual(rows);
    expect(result.current.panel).toBe(true);
    await act(async () => { d.resolve(undefined); await task; });
    expect(result.current.cart).toEqual([]);
    expect(result.current.panel).toBe(false);
    expect(committed).toHaveBeenCalledTimes(1);
});
it('저장전X재열기는초안을유지하며박스수량은한번만환산한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePurchaseCartDraft({ companyId: 'taebaek', getUid: () => 'u', items: [item], inputs, save, onCommitted: vi.fn() }));
    act(() => { result.current.setCart([{ ...rows[0], isBox: true }]); result.current.setPanel(true); result.current.setPanel(false); result.current.setPanel(true); });
    expect(result.current.cart[0].qty).toBe(2);
    await act(async () => { await result.current.submit(); });
    expect(save.mock.calls[0][0]).toEqual([{ id: 'p', partnerId: 's', quantity: 20, boxQuantity: 2 }]);
});
it('실패원문과부분생성가능안내를유지하고자동재송신하지않는다', async () => {
    const save = vi.fn().mockRejectedValue(Error('둘째그룹거절'));
    const { result } = renderHook(() => usePurchaseCartDraft({ companyId: 'taebaek', getUid: () => 'u', items: [item], inputs, save, onCommitted: vi.fn() }));
    act(() => result.current.setCart(rows));
    await act(async () => { await result.current.submit(); });
    expect(result.current.cart).toEqual(rows);
    expect(result.current.error).toContain('일부 발주가 이미 생성되었을 수 있습니다');
    expect(result.current.error).toContain('둘째그룹거절');
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
});
it('회사UID왕복뒤oldACK/finally는새cart와pending을보존한다', async () => {
    const a = deferred(), b = deferred(), save = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise), committed = vi.fn();
    let uid = 'u';
    const { result, rerender } = renderHook(({ companyId }: {
        companyId: CompanyId;
    }) => usePurchaseCartDraft({ companyId, getUid: () => uid, items: [item], inputs, save, onCommitted: committed }), { initialProps: { companyId: 'taebaek' as CompanyId } });
    act(() => result.current.setCart(rows));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = result.current.submit(); });
    uid = 'v';
    rerender({ companyId: 'punghoe' });
    uid = 'u';
    rerender({ companyId: 'taebaek' });
    expect(result.current.cart).toEqual([]);
    act(() => result.current.setCart([{ ...rows[0], qty: 8 }]));
    act(() => { second = result.current.submit(); });
    await act(async () => { a.resolve(undefined); await first; });
    expect(result.current.cart[0].qty).toBe(8);
    expect(result.current.busy).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    await act(async () => { b.resolve(undefined); await second; });
    expect(committed).toHaveBeenCalledTimes(1);
});
it('렌더전UID교체/없음은옛cart송신0·unmount뒤오류무시', async () => {
    let uid: string | undefined = 'u';
    const d = deferred(), save = vi.fn(() => d.promise);
    const { result, unmount } = renderHook(() => usePurchaseCartDraft({ companyId: 'taebaek', getUid: () => uid, items: [item], inputs, save, onCommitted: vi.fn() }));
    act(() => result.current.setCart(rows));
    uid = 'v';
    await act(async () => { await result.current.submit(); });
    uid = undefined;
    await act(async () => { await result.current.submit(); });
    expect(save).not.toHaveBeenCalled();
    uid = 'u';
    let task!: Promise<void>;
    act(() => { task = result.current.submit(); });
    unmount();
    d.reject(Error('늦은거절'));
    await task;
    expect(result.current.error).toBe('');
});
it('정상inlinecallback교체는pending을폐기하지않고다음송신은최신callback', async () => {
    const d = deferred(), first = vi.fn(() => d.promise), next = vi.fn().mockResolvedValue(undefined), committed = vi.fn();
    const { result, rerender } = renderHook(({ save }) => usePurchaseCartDraft({ companyId: 'taebaek', getUid: () => 'u', items: [item], inputs, save, onCommitted: committed }), { initialProps: { save: first as (rows: any[]) => Promise<unknown> } });
    act(() => result.current.setCart(rows));
    let task!: Promise<void>;
    act(() => { task = result.current.submit(); });
    rerender({ save: next });
    await act(async () => { d.resolve(undefined); await task; });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    act(() => result.current.setCart(rows));
    await act(async () => { await result.current.submit(); });
    expect(next).toHaveBeenCalledTimes(1);
});
