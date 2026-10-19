/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Item, Order, ProductionRecord } from '../../../shared/types';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'uid' } as {
            uid: string;
        } | null }, listener: null as null | ((user: {
        uid: string;
    } | null) => void), confirm: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: mocks.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof mocks.listener) => { mocks.listener = callback; return () => { }; } }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: mocks.confirm }));
import { useProductionRecordEditor, type ProductionRecordEditorOptions } from './useProductionRecordEditor';
const item = { id: 'item', name: '참기름', type: 'product', cost: 100 } as Item;
const record: ProductionRecord = { id: 'record', itemId: 'item', itemName: '참기름', finishedQty: 2, date: '2026-10-20', createdAt: '' };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(extra: Partial<ProductionRecordEditorOptions> = {}) {
    const options: ProductionRecordEditorOptions = { companyId: 'taebaek', actorUid: 'uid', items: [item], records: [], orders: [], onAdd: vi.fn(async () => { }), onUpdate: vi.fn(async () => { }), onDelete: vi.fn(async () => { }), ...extra };
    const hook = renderHook((props: ProductionRecordEditorOptions) => useProductionRecordEditor(props), { initialProps: options });
    return { ...hook, options };
}
function fill(result: ReturnType<typeof fixture>['result']) { act(() => { result.current.openCreate(); result.current.setField('itemId', 'item'); result.current.setField('finishedQty', '2'); result.current.setField('note', '원문'); }); }
beforeEach(() => { mocks.auth.currentUser = { uid: 'uid' }; mocks.confirm.mockResolvedValue(true); });
afterEach(cleanup);
it('저장 ACK 전 폼을 보존하고 같은 tick 중복 송신을 막는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise) });
    fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); void f.result.current.submit(); f.result.current.closeForm(); });
    expect(f.options.onAdd).toHaveBeenCalledTimes(1);
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(false);
    expect(f.result.current.form.note).toBe('');
});
it('지연 거절 뒤 원문을 보존하고 자동 및 명시 동일 재송신을 막는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise) });
    fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); });
    await act(async () => { gate.reject(Error('연결 끊김')); await task; });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
    expect(f.result.current.error).toBeTruthy();
    await act(async () => { await f.result.current.submit(); });
    expect(f.options.onAdd).toHaveBeenCalledTimes(1);
    act(() => { f.result.current.closeForm(); f.result.current.openCreate(); });
    expect(f.result.current.locked).toBe(false);
    expect(f.result.current.error).toContain('이전 수동 생산기록 1건');
    expect(f.result.current.unconfirmedRecords[0].note).toBe('원문');
});
it('회사 전환 후 옛 ACK가 새 초안을 닫거나 초기화하지 않는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise) });
    fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); });
    f.rerender({ ...f.options, companyId: 'punghoe' });
    fill(f.result);
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
});
it('실 UID 구독 전환만으로 새 수명으로 바꾸고 옛 핸들러를 차단한다', async () => {
    const f = fixture();
    fill(f.result);
    const old = f.result.current.submit;
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    await act(async () => { await old(); });
    expect(f.options.onAdd).not.toHaveBeenCalled();
    expect(f.result.current.showForm).toBe(false);
});
it('날짜 저장 응답 전 편집을 유지하고 거절도 원래 입력을 남긴다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onUpdate: vi.fn(() => gate.promise) });
    act(() => { f.result.current.openDate(record); f.result.current.changeDate('2026-11-01'); });
    let task!: Promise<void>;
    act(() => { task = f.result.current.saveDate(); f.result.current.cancelDate(); });
    expect(f.result.current.editingDateId).toBe(record.id);
    await act(async () => { gate.reject(Error('실패')); await task; });
    expect(f.result.current.editingDateVal).toBe('2026-11-01');
    expect(f.result.current.error).toBeTruthy();
});
it('삭제 확인 대기 중 회사가 바뀌면 삭제를 보내지 않는다', async () => {
    const gate = deferred<boolean>();
    mocks.confirm.mockReturnValue(gate.promise);
    const f = fixture();
    let task!: Promise<void>;
    act(() => { task = f.result.current.removeRecord(record); });
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.resolve(true); await task; });
    expect(f.options.onDelete).not.toHaveBeenCalled();
});
it('날짜 ACK에서만 편집을 종료한다', async () => {
    const f = fixture();
    act(() => { f.result.current.openDate(record); f.result.current.changeDate('2026-11-01'); });
    await act(async () => { await f.result.current.saveDate(); });
    expect(f.options.onUpdate).toHaveBeenCalledWith(record.id, { date: '2026-11-01' });
    expect(f.result.current.editingDateId).toBeNull();
});
it('회사 정보 없는 읽기 화면은 쓰기를 시작하지 않는다', async () => {
    const f = fixture({ companyId: undefined });
    act(() => f.result.current.openCreate());
    await act(async () => { await f.result.current.submit(); });
    expect(f.options.onAdd).not.toHaveBeenCalled();
});
it('동기화 완료 prefix와 미확정 항목은 stale props에서도 다시 보내지 않는다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const order = { id: 'o', partnerName: '거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'one', name: '하나', quantity: 1 }, { itemId: 'two', name: '둘', quantity: 2 }, { itemId: 'three', name: '셋', quantity: 3 }] } as Order;
    const add = vi.fn(async (_record: ProductionRecord) => { });
    add.mockRejectedValueOnce(Error('첫 응답 미확정'));
    const f = fixture({ orders: [order], onAdd: add });
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(add).toHaveBeenCalledTimes(1);
    expect(f.result.current.error).toContain('확정하지');
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(add.mock.calls.map(call => call[0].id)).toEqual(['pr-o-one', 'pr-o-two', 'pr-o-three']);
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(add).toHaveBeenCalledTimes(3);
    expect(f.result.current.error).toContain('아직 확인하지');
});
it('동기화 일부 ACK 뒤 실패는 남은 미송신과 구분하며 다음 클릭은 안전한 나머지만 보낸다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const order = { id: 'o', partnerName: '거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'one', name: '하나', quantity: 1 }, { itemId: 'two', name: '둘', quantity: 2 }, { itemId: 'three', name: '셋', quantity: 3 }] } as Order;
    const add = vi.fn(async (_record: ProductionRecord) => { });
    add.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('미확정'));
    const f = fixture({ orders: [order], onAdd: add });
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(f.result.current.error).toContain('1건');
    expect(add).toHaveBeenCalledTimes(2);
    f.rerender({ ...f.options, companyId: 'punghoe' });
    f.rerender(f.options);
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(add.mock.calls.map(call => call[0].id)).toEqual(['pr-o-one', 'pr-o-two', 'pr-o-three']);
});
it('날짜 미확정 뒤 동일 날짜 쓰기를 재실행하지 않는다', async () => {
    const f = fixture({ onUpdate: vi.fn(async () => { throw Error('미확정'); }) });
    act(() => f.result.current.openDate(record));
    await act(async () => { await f.result.current.saveDate(); await f.result.current.saveDate(); });
    expect(f.options.onUpdate).toHaveBeenCalledTimes(1);
    expect(f.result.current.editingDateId).toBe(record.id);
});
it('UID 교체 후 지연 ACK가 새 계정 작성창을 닫지 않는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise), actorUid: undefined });
    fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); });
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    fill(f.result);
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
});
it('삭제 응답 미확정은 원인과 행별 잠금을 유지하되 다른 기록 삭제는 허용한다', async () => {
    const remove = vi.fn(async () => { throw Error('삭제 응답 유실'); });
    const f = fixture({ onDelete: remove });
    await act(async () => { await f.result.current.removeRecord(record); });
    expect(f.result.current.error).toContain('삭제 응답 유실');
    expect(f.result.current.canRemoveRecord(record)).toBe(false);
    await act(async () => { await f.result.current.removeRecord(record); });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.result.current.canRemoveRecord({ ...record, id: 'other' })).toBe(true);
});
it.each(['date', 'delete'] as const)('회사 전환 중 %s 미확정은 옛 scope에 기록해 재진입 재송신을 막는다', async (kind) => {
    const gate = deferred<void>();
    const callback = vi.fn(() => gate.promise);
    const f = fixture(kind === 'date' ? { onUpdate: callback } : { onDelete: callback });
    let task!: Promise<void>;
    if (kind === 'date') {
        act(() => { f.result.current.openDate(record); task = f.result.current.saveDate(); });
    }
    else {
        await act(async () => { task = f.result.current.removeRecord(record); await Promise.resolve(); });
    }
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.reject(Error('옛 요청 미확정')); await task; });
    expect(f.result.current.error).toBe('');
    f.rerender(f.options);
    if (kind === 'date') {
        act(() => f.result.current.openDate(record));
        expect(f.result.current.canSaveDate).toBe(false);
        await act(async () => { await f.result.current.saveDate(); });
    }
    else {
        expect(f.result.current.canRemoveRecord(record)).toBe(false);
        await act(async () => { await f.result.current.removeRecord(record); });
    }
    expect(callback).toHaveBeenCalledTimes(1);
});
it('부모 expected UID 갱신 전 실 UID가 바뀌면 옛 미확정 원문과 안내를 숨긴다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('옛 원문'); }) });
    fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    expect(f.result.current.unconfirmedRecords).toHaveLength(1);
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    expect(f.result.current.form.note).toBe('');
    expect(f.result.current.error).toBe('');
    expect(f.result.current.message).toBe('');
    expect(f.result.current.unconfirmedRecords).toEqual([]);
});
