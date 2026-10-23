/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CompanyId, Item } from '../../../shared/types';
import { useStocktakeEditor } from './useStocktakeEditor';
const item = { id: 'a', name: '실사', type: 'product', companyId: 'taebaek', stock: 3, minStock: 0, unit: '개', image: '' } as Item;
it('같은 tick 실행은 하나이며 저장 중 form/lot handler를 막는다', () => {
    const { result } = renderHook(() => useStocktakeEditor({ companyId: 'taebaek', actorKey: '직원', getUid: () => 'u' }));
    act(() => result.current.open(item, { stock: 3, minStock: 1 }, 'lot', null));
    let first!: ReturnType<typeof result.current.begin>;
    act(() => { first = result.current.begin(); expect(result.current.begin()).toBeNull(); result.current.setForm({ stock: 99 }); result.current.setLotId('other'); });
    expect(result.current.form.stock).toBe(3);
    expect(result.current.lotId).toBe('lot');
    expect(result.current.saving).toBe(true);
    act(() => first!.finish());
    expect(result.current.saving).toBe(false);
});
it('대기 중 닫기와 재열기는 허용하며 old ACK/finally는 새 run을 풀지 않는다', () => {
    const { result } = renderHook(() => useStocktakeEditor({ companyId: 'taebaek', getUid: () => 'u' }));
    act(() => result.current.open(item, { stock: 3 }, '', null));
    let old!: ReturnType<typeof result.current.begin>;
    act(() => { old = result.current.begin(); });
    const oldId = result.current.operationId.current;
    act(() => result.current.close());
    act(() => result.current.open(item, { stock: 8 }, '', null));
    expect(result.current.operationId.current).not.toBe(oldId);
    let fresh!: ReturnType<typeof result.current.begin>;
    act(() => { fresh = result.current.begin(); old!.finish(); });
    expect(old!.isCurrent()).toBe(false);
    expect(result.current.saving).toBe(true);
    expect(result.current.form.stock).toBe(8);
    act(() => fresh!.finish());
    expect(result.current.saving).toBe(false);
});
it('회사/실UID 왕복 후 옛 선택과 응답은 되살아나지 않는다', () => {
    let uid = 'u';
    const { result, rerender } = renderHook(({ companyId }: {
        companyId: CompanyId;
    }) => useStocktakeEditor({ companyId, getUid: () => uid }), { initialProps: { companyId: 'taebaek' as CompanyId } });
    act(() => result.current.open(item, { stock: 3 }, '', null));
    let old!: ReturnType<typeof result.current.begin>;
    act(() => { old = result.current.begin(); });
    uid = 'v';
    rerender({ companyId: 'punghoe' });
    uid = 'u';
    rerender({ companyId: 'taebaek' });
    expect(result.current.item).toBeNull();
    expect(old!.isCurrent()).toBe(false);
    act(() => old!.finish());
    expect(result.current.saving).toBe(false);
});
it('렌더 전 실UID 변경은 신규 실행과 입력을 거절한다', () => {
    let uid = 'u';
    const { result } = renderHook(() => useStocktakeEditor({ companyId: 'taebaek', getUid: () => uid }));
    act(() => result.current.open(item, { stock: 3 }, '', null));
    uid = 'v';
    act(() => { expect(result.current.begin()).toBeNull(); result.current.setForm({ stock: 99 }); });
    expect(result.current.form.stock).toBe(3);
});
it('보존 요청은 입력만 잠그고 결과 조회 실행은 허용하며 unmount 뒤 owner를 폐기한다', () => {
    const { result, unmount } = renderHook(() => useStocktakeEditor({ companyId: 'taebaek', getUid: () => 'u' }));
    act(() => result.current.open(item, { stock: 5 }, '', {} as never));
    act(() => result.current.setForm({ stock: 9 }));
    expect(result.current.form.stock).toBe(5);
    let run!: ReturnType<typeof result.current.begin>;
    act(() => { run = result.current.begin(); });
    expect(run).not.toBeNull();
    unmount();
    expect(run!.isCurrent()).toBe(false);
    run!.finish();
});
