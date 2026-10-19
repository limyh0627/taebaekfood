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
import { serializeProductionRecordRequest, type ProductionRecordRequest, type ProductionRecordResult } from '../../../shared/productionRecordCommand';
import { productionRecordKey, type ProductionRecordBindings, type ProductionRecordEntry, type ProductionRecordObservation } from '../../../shared/services/productionRecordWrites';
const item = { id: 'item', name: '참기름', type: 'product', cost: 100 } as Item;
const record: ProductionRecord = { id: 'record', itemId: 'item', itemName: '참기름', finishedQty: 2, date: '2026-10-20', createdAt: '' };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type TestCallbacks = {
    onAdd: (row: ProductionRecord) => Promise<void>;
    onUpdate: (id: string, patch: Partial<ProductionRecord>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
};
function fixture(extra: Partial<ProductionRecordEditorOptions & TestCallbacks> = {}) {
    const entries: ProductionRecordEntry[] = [], server = new Map<string, ProductionRecordResult>();
    const callbacks: TestCallbacks = { onAdd: vi.fn(async () => { }), onUpdate: vi.fn(async () => { }), onDelete: vi.fn(async () => { }), ...extra };
    const bindings: ProductionRecordBindings = {
        open: vi.fn(async (_scope, reference, opening, source) => ({ reference, actorUid: 'uid', opening, expectedVersion: opening === null ? null : '1:000000000', ...(source ? { source: { ...source, expectedVersion: '2:000000000' } } : {}) })),
        prepare: vi.fn(async (scope, request) => {
            const raw = serializeProductionRecordRequest(request);
            const entry: ProductionRecordEntry = { key: productionRecordKey(scope, request.reference), reference: request.reference, request: JSON.parse(raw), requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), observedLocalText: raw, observedReferenceText: '최초참조', status: 'valid', description: '생산기록' };
            entries.push(entry);
            return entry;
        }),
        read: vi.fn(async () => [...entries]),
        command: vi.fn(async (_scope, entry, mode, current = () => true): Promise<ProductionRecordObservation> => {
            try {
                if (mode === 'apply') {
                    const request = entry.request!;
                    if (request.action === 'create' || request.action === 'sync')
                        await callbacks.onAdd({ ...request.record, id: request.reference.targetId });
                    else if (request.action === 'date')
                        await callbacks.onUpdate(request.reference.targetId, { date: request.date });
                    else
                        await callbacks.onDelete(request.reference.targetId);
                    server.set(entry.key, { version: 1, reference: entry.reference!, actorUid: 'uid', status: 'applied', requestHash: entry.requestHash, message: '실제 처리 완료' });
                }
                if (!current())
                    return { terminal: false, outcome: { status: 'unknown', message: '이전 scope 응답', nextAction: '결과 확인' } };
                const result: ProductionRecordResult = mode === 'cancel' ? { version: 1, reference: entry.reference!, actorUid: 'uid', status: 'cancelled', requestHash: null, message: '미처리 중단' } : server.get(entry.key) ?? { version: 1, reference: entry.reference!, actorUid: 'uid', status: 'unknown', requestHash: null, message: '아직 확인 전' };
                if (result.status === 'unknown')
                    return { terminal: false, result, outcome: { status: 'unknown', message: result.message, nextAction: '조회 또는 중단' } };
                const index = entries.findIndex(row => row.key === entry.key);
                if (index >= 0)
                    entries.splice(index, 1);
                return { terminal: true, result, outcome: result.status === 'applied' ? { status: 'saved' } : { status: 'cancelled', message: result.message } };
            }
            catch (error) {
                return { terminal: false, outcome: { status: 'unknown', message: String(error) + ' 처리 결과를 확정하지 못했습니다.', nextAction: '조회 또는 중단' } };
            }
        }),
        discard: vi.fn(async (_scope, entry) => {
            const index = entries.findIndex(row => row.key === entry.key);
            if (index >= 0)
                entries.splice(index, 1);
            return { status: 'cleared' as const, message: '기기사본만 정리' };
        }),
        history: vi.fn(async (scope) => ({ version: 1 as const, ...scope, entries: [], nextCursor: null })),
    };
    const options: ProductionRecordEditorOptions & TestCallbacks = { companyId: 'taebaek', actorUid: 'uid', items: [item], records: [], orders: [], ...callbacks, ...extra, productionRecordBindings: extra.productionRecordBindings ?? bindings };
    const hook = renderHook((props: ProductionRecordEditorOptions) => useProductionRecordEditor(props), { initialProps: options });
    return { ...hook, options, bindings, entries, server };
}
async function fill(result: ReturnType<typeof fixture>['result']) {
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => { result.current.openCreate(); result.current.setField('itemId', 'item'); result.current.setField('finishedQty', '2'); result.current.setField('note', '원문'); });
}
beforeEach(() => { mocks.auth.currentUser = { uid: 'uid' }; mocks.confirm.mockResolvedValue(true); });
afterEach(cleanup);
it('저장 ACK 전 폼을 보존하고 같은 tick 중복 송신을 막는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise) });
    await fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); void f.result.current.submit(); f.result.current.closeForm(); });
    await waitFor(() => expect(f.options.onAdd).toHaveBeenCalledTimes(1));
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(false);
    expect(f.result.current.form.note).toBe('');
});
it('지연 거절 뒤 원문을 보존하고 자동 및 명시 동일 재송신을 막는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise) });
    await fill(f.result);
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
    await fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); });
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await fill(f.result);
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
});
it('실 UID 구독 전환만으로 새 수명으로 바꾸고 옛 핸들러를 차단한다', async () => {
    const f = fixture();
    await fill(f.result);
    const old = f.result.current.submit;
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    await act(async () => { await old(); });
    expect(f.options.onAdd).not.toHaveBeenCalled();
    expect(f.result.current.showForm).toBe(false);
});
it('날짜 저장 응답 전 편집을 유지하고 거절도 원래 입력을 남긴다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onUpdate: vi.fn(() => gate.promise) });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.openDate(record); });
    act(() => f.result.current.changeDate('2026-11-01'));
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
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    let task!: Promise<void>;
    act(() => { task = f.result.current.removeRecord(record); });
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.resolve(true); await task; });
    expect(f.options.onDelete).not.toHaveBeenCalled();
});
it('날짜 ACK에서만 편집을 종료한다', async () => {
    const f = fixture();
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.openDate(record); });
    act(() => f.result.current.changeDate('2026-11-01'));
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
    await waitFor(() => expect(f.result.current.ready).toBe(true));
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
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(f.result.current.error).toContain('1건');
    expect(add).toHaveBeenCalledTimes(2);
    f.rerender({ ...f.options, companyId: 'punghoe' });
    f.rerender(f.options);
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(add.mock.calls.map(call => call[0].id)).toEqual(['pr-o-one', 'pr-o-two', 'pr-o-three']);
});
it('날짜 미확정 뒤 동일 날짜 쓰기를 재실행하지 않는다', async () => {
    const f = fixture({ onUpdate: vi.fn(async () => { throw Error('미확정'); }) });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.openDate(record); });
    await act(async () => { await f.result.current.saveDate(); await f.result.current.saveDate(); });
    expect(f.options.onUpdate).toHaveBeenCalledTimes(1);
    expect(f.result.current.editingDateId).toBe(record.id);
});
it('UID 교체 후 지연 ACK가 새 계정 작성창을 닫지 않는다', async () => {
    const gate = deferred<void>();
    const f = fixture({ onAdd: vi.fn(() => gate.promise), actorUid: undefined });
    await fill(f.result);
    let task!: Promise<void>;
    act(() => { task = f.result.current.submit(); });
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    await fill(f.result);
    await act(async () => { gate.resolve(); await task; });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
});
it('삭제 응답 미확정은 원인과 행별 잠금을 유지하되 다른 기록 삭제는 허용한다', async () => {
    const remove = vi.fn(async () => { throw Error('삭제 응답 유실'); });
    const f = fixture({ onDelete: remove });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
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
        await waitFor(() => expect(f.result.current.ready).toBe(true));
        await act(async () => { await f.result.current.openDate(record); });
        act(() => { task = f.result.current.saveDate(); });
    }
    else {
        await waitFor(() => expect(f.result.current.ready).toBe(true));
        await act(async () => { task = f.result.current.removeRecord(record); await Promise.resolve(); });
    }
    await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.reject(Error('옛 요청 미확정')); await task; });
    expect(f.result.current.error).toBe('');
    f.rerender(f.options);
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    if (kind === 'date') {
        await act(async () => { await f.result.current.openDate(record); });
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
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    expect(f.result.current.unconfirmedRecords).toHaveLength(1);
    act(() => { mocks.auth.currentUser = { uid: 'other' }; mocks.listener?.(mocks.auth.currentUser); });
    expect(f.result.current.form.note).toBe('');
    expect(f.result.current.error).toBe('');
    expect(f.result.current.message).toBe('');
    expect(f.result.current.unconfirmedRecords).toEqual([]);
});
it('미확정 동일 ref 결과확인은 추가 apply 없이 해당 현재작성만 종결한다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('ACK 유실'); }) });
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    const row = f.result.current.operations[0];
    f.server.set(row.key, { version: 1, reference: row.reference!, actorUid: 'uid', status: 'applied', requestHash: row.requestHash, message: '등록 완료' });
    await act(async () => { await f.result.current.inspect(row); });
    expect(f.options.onAdd).toHaveBeenCalledTimes(1);
    expect(f.result.current.showForm).toBe(false);
    expect(f.result.current.failureCount).toBe(0);
    expect(f.bindings.command).toHaveBeenLastCalledWith(expect.any(Object), row, 'inspect', expect.any(Function));
});
it('reload 보관원문 조회 후 과거 ACK는 새 작성 입력과 창을 닫지 않는다', async () => {
    const first = fixture({ onAdd: vi.fn(async () => { throw Error('ACK 유실'); }) });
    await fill(first.result);
    await act(async () => { await first.result.current.submit(); });
    const row = first.result.current.operations[0];
    first.unmount();
    const f = fixture({ productionRecordBindings: first.bindings });
    await fill(f.result);
    first.server.set(row.key, { version: 1, reference: row.reference!, actorUid: 'uid', status: 'applied', requestHash: row.requestHash, message: '과거 등록 완료' });
    await act(async () => { await f.result.current.inspect(row); });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
    expect(first.options.onAdd).toHaveBeenCalledTimes(1);
    expect(f.result.current.failureCount).toBe(0);
});
it('손상·미식별사본 명시정리는 새작성초안을 보존하고 업무ACK로 쓰지 않는다', async () => {
    const f = fixture();
    f.entries.push({ key: 'broken', reference: null, request: null, requestHash: null, referenceHash: null, observedLocalText: '손상 원문', observedReferenceText: '손상 참조', status: 'corrupt', description: '식별 불가' });
    await act(async () => { await f.result.current.refresh(); });
    await fill(f.result);
    const row = f.result.current.operations[0];
    expect(f.result.current.canRetry(row)).toBe(false);
    expect(f.result.current.canCancel(row)).toBe(false);
    await act(async () => { await f.result.current.discardCopy(row); });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
    expect(f.bindings.command).not.toHaveBeenCalled();
    expect(f.bindings.discard).toHaveBeenCalledWith(expect.any(Object), row, expect.any(Function));
});
it('생산일은 편집열기 당시 native 버전으로만 저장해 숨은 동시변경을 덮지 않는다', async () => {
    const f = fixture();
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.openDate(record); });
    const openingCall = vi.mocked(f.bindings.open).mock.calls[0];
    act(() => f.result.current.changeDate('2026-11-02'));
    vi.mocked(f.bindings.command).mockResolvedValueOnce({ terminal: true, outcome: { status: 'rejected', message: '다른 담당자가 수정했습니다.' }, result: { version: 1, reference: openingCall[1], actorUid: 'uid', status: 'rejected', requestHash: 'a'.repeat(64), message: '동시 변경' } });
    await act(async () => { await f.result.current.saveDate(); });
    expect(f.bindings.open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.bindings.prepare).mock.calls[0][1]).toMatchObject({ action: 'date', expectedVersion: '1:000000000', date: '2026-11-02' });
    expect(f.result.current.editingDateVal).toBe('2026-11-02');
    expect(f.result.current.error).toContain('다른 담당자');
});
it('삭제 확인 전 고정한 원문과 버전을 확인 후 최신 props로 재조립하지 않는다', async () => {
    const gate = deferred<boolean>();
    mocks.confirm.mockReturnValue(gate.promise);
    const f = fixture();
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    let task!: Promise<void>;
    act(() => { task = f.result.current.removeRecord(record); });
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    f.rerender({ ...f.options, records: [{ ...record, finishedQty: 99 }] });
    await act(async () => { gate.resolve(true); await task; });
    expect(f.bindings.open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.bindings.prepare).mock.calls[0][1]).toMatchObject({ action: 'delete', expectedVersion: '1:000000000' });
});
it('초기 보관목록 확인 전 신규송신은 차단하고 읽기실패는 명시 refresh로 복구한다', async () => {
    const f = fixture();
    const gate = deferred<ProductionRecordEntry[]>();
    vi.mocked(f.bindings.read).mockReturnValueOnce(gate.promise);
    let read!: Promise<void>;
    act(() => { read = f.result.current.refresh(); f.result.current.openCreate(); void f.result.current.submit(); });
    expect(f.options.onAdd).not.toHaveBeenCalled();
    expect(f.result.current.readLoading).toBe(true);
    await act(async () => { gate.reject(Error('기기 보관 읽기 실패')); await read; });
    expect(f.result.current.readError).toContain('읽기 실패');
    await act(async () => { await f.result.current.refresh(); });
    expect(f.result.current.ready).toBe(true);
});
it('동기화 첫계획의 원가 날짜 생성시각과 source근거는 await중 최신 props로 바꾸지 않는다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const { productionRecordSourceEvidence } = await import('../../../shared/productionRecordCommand');
    const order = { id: 'source-order', partnerName: '처음거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'item', name: '처음이름', quantity: 2, price: 0 }] } as Order;
    const f = fixture({ orders: [order], items: [{ ...item, cost: 0 }] });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    const gate = deferred<void>();
    vi.mocked(f.bindings.open).mockImplementationOnce(async (_scope, reference, opening, source) => { await gate.promise; return { reference, actorUid: 'uid', opening, expectedVersion: null, source: { ...source!, expectedVersion: '2:000000000' } }; });
    let task!: Promise<void>;
    act(() => { task = f.result.current.syncFromOrders(); });
    await waitFor(() => expect(f.bindings.open).toHaveBeenCalled());
    f.rerender({ ...f.options, orders: [{ ...order, partnerName: '바뀐거래처', items: [{ itemId: 'item', name: '새이름', quantity: 99, price: 0 }] }], items: [{ ...item, cost: 999 }] });
    await act(async () => { gate.resolve(); await task; });
    const packet = vi.mocked(f.bindings.prepare).mock.calls[0][1];
    expect(packet).toMatchObject({ action: 'sync', record: { cost: 0, finishedQty: 2, date: '2026-10-20' }, source: { orderId: order.id, evidence: productionRecordSourceEvidence(order) } });
    expect(f.options.onAdd).toHaveBeenCalledTimes(1);
});
it('명시이력 빈페이지 다음조회와 scope교체는 cursor·로딩을 새계정으로 넘기지 않는다', async () => {
    const f = fixture();
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    const cursor = 'a'.repeat(64);
    vi.mocked(f.bindings.history).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: cursor });
    expect(f.bindings.history).not.toHaveBeenCalled();
    await act(async () => { await f.result.current.loadHistory(); });
    expect(f.result.current.historyMore).toBe(true);
    expect(f.result.current.failureCount).toBe(0);
    expect(f.result.current.message).toContain('미처리가 확정');
    const gate = deferred<Awaited<ReturnType<ProductionRecordBindings['history']>>>();
    vi.mocked(f.bindings.history).mockReturnValueOnce(gate.promise);
    let task!: Promise<void>;
    act(() => { task = f.result.current.nextHistory(); });
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.resolve({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: cursor }); await task; });
    expect(f.result.current.historyLoading).toBe(false);
    expect(f.result.current.historyMore).toBe(false);
    expect(f.result.current.historyRows).toEqual([]);
});
it('원문없는 정상 과거이력은 실패0이며 조회만 현재새작성 입력을 보존한다', async () => {
    const f = fixture();
    await fill(f.result);
    const reference = { companyId: 'taebaek' as const, planId: 'old', targetId: 'old-target' };
    const result: ProductionRecordResult = { version: 1, reference, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '과거 날짜 변경 완료' };
    vi.mocked(f.bindings.history).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [{ result, action: 'date', createdAt: '2026-10-20' }], nextCursor: null });
    await act(async () => { await f.result.current.loadHistory(); });
    const row = f.result.current.historyRows[0];
    expect(row.currentState).toContain('완료');
    expect(f.result.current.failureCount).toBe(0);
    expect(f.result.current.canCancel(row.entry)).toBe(false);
    expect(f.result.current.canDiscard(row.entry)).toBe(false);
    expect(f.result.current.form.note).toBe('원문');
    expect(f.result.current.showForm).toBe(true);
});
it('손상 원문도 known target은 새 sync 계획에서 제외하고 무관 target만 준비한다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const order = { id: 'o', partnerName: '거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'one', name: '하나', quantity: 1, price: 0 }, { itemId: 'two', name: '둘', quantity: 2, price: 0 }] } as Order;
    const f = fixture({ orders: [order] });
    const reference = { companyId: 'taebaek' as const, planId: 'damaged', targetId: 'pr-o-one' };
    f.entries.push({ key: productionRecordKey({ companyId: 'taebaek', actorUid: 'uid' }, reference), reference, request: null, requestHash: null, referenceHash: 'a'.repeat(64), observedLocalText: '{손상', observedReferenceText: '참조', status: 'corrupt', description: '손상' });
    await act(async () => { await f.result.current.refresh(); });
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(vi.mocked(f.options.onAdd).mock.calls.map(call => call[0].id)).toEqual(['pr-o-two']);
    expect(f.entries[0].observedLocalText).toBe('{손상');
});
it('같은 ref의 교체 사본 결과는 원래 현재초안 ACK로 승격하지 않는다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('미확정'); }) });
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    const original = f.result.current.operations[0], replaced = { ...original, observedLocalText: '다른 원문', observedReferenceText: '다른 참조' };
    f.server.set(original.key, { version: 1, reference: original.reference!, actorUid: 'uid', status: 'applied', requestHash: 'b'.repeat(64), message: '다른 사본 완료' });
    await act(async () => { await f.result.current.inspect(replaced); });
    expect(f.result.current.showForm).toBe(true);
    expect(f.result.current.form.note).toBe('원문');
});
it('동기화 중 scope 교체는 받은 ACK prefix를 보존하고 후속 기록을 보내지 않는다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const gate = deferred<void>();
    const order = { id: 'o', partnerName: '거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'one', name: '하나', quantity: 1, price: 0 }, { itemId: 'two', name: '둘', quantity: 2, price: 0 }] } as Order;
    const f = fixture({ orders: [order], onAdd: vi.fn(() => gate.promise) });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    let task!: Promise<void>;
    act(() => { task = f.result.current.syncFromOrders(); });
    await waitFor(() => expect(f.options.onAdd).toHaveBeenCalledTimes(1));
    f.rerender({ ...f.options, companyId: 'punghoe' });
    await act(async () => { gate.resolve(); await task; });
    expect(f.options.onAdd).toHaveBeenCalledTimes(1);
    expect(f.bindings.prepare).toHaveBeenCalledTimes(1);
    expect(f.result.current.error).toBe('');
});
it.each([false, true])('빈 동기화는 실제 기록을 쓰지 않고 기존 두 빈결과 안내를 구분한다 (%s)', async (delivered) => {
    const { OrderStatus } = await import('../../../shared/types');
    const order = { id: 'empty', partnerName: '거래처', status: OrderStatus.DELIVERED, items: [] } as unknown as Order;
    const f = fixture({ orders: delivered ? [order] : [] });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.syncFromOrders(); });
    expect(f.options.onAdd).not.toHaveBeenCalled();
    expect(f.bindings.prepare).not.toHaveBeenCalled();
    expect(f.result.current.message).toBe(delivered ? '동기화할 새 기록이 없습니다.' : '이력에 완료된 주문이 없습니다.');
});
it('prepare하지 않은 suffix는 reload에 자동재개하지 않고 다음 명시click의 새계획으로 준비한다', async () => {
    const { OrderStatus } = await import('../../../shared/types');
    const order = { id: 'o', partnerName: '거래처', status: OrderStatus.DELIVERED, createdAt: '2026-10-20', items: [{ itemId: 'one', name: '하나', quantity: 1, price: 0 }, { itemId: 'item', name: '둘', quantity: 2, price: 0 }] } as Order;
    const add = vi.fn(async (_row: ProductionRecord) => { }).mockRejectedValueOnce(Error('첫 응답 유실'));
    const f = fixture({ orders: [order], onAdd: add });
    await waitFor(() => expect(f.result.current.ready).toBe(true));
    await act(async () => { await f.result.current.syncFromOrders(); });
    const firstRaw = f.entries[0].observedLocalText;
    expect(f.bindings.prepare).toHaveBeenCalledTimes(1);
    await act(async () => { await f.result.current.refresh(); });
    expect(f.bindings.prepare).toHaveBeenCalledTimes(1);
    f.rerender({ ...f.options, items: [{ ...item, cost: 777 }] });
    await act(async () => { await f.result.current.syncFromOrders(); });
    const packet = vi.mocked(f.bindings.prepare).mock.calls[1][1];
    expect(packet).toMatchObject({ action: 'sync', reference: { targetId: 'pr-o-item' }, record: { cost: 777 } });
    expect(f.entries[0].observedLocalText).toBe(firstRaw);
});
it('보관된 미확정 실패는 본문 안내에서 빼고 행의 원인과 다음행동을 나눈다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('저장 응답 유실'); }) });
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    const row = f.result.current.failureRows[0];
    expect(f.result.current.inlineError).toBe('');
    expect(f.result.current.inlineMessage).toBe('');
    expect(f.result.current.recoveryError).toBe('');
    expect(row.cause).toContain('저장 응답 유실');
    expect(row.cause).not.toContain('조회 또는 중단');
    expect(row.nextAction).toBe('조회 또는 중단');
});
it('이전 보관 실패가 있어도 새작성 필수입력 오류는 폼에만 별도로 표시한다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('이전 실패'); }) });
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    const cause = f.result.current.failureRows[0].cause;
    act(() => { f.result.current.closeForm(); f.result.current.openCreate(); });
    await act(async () => { await f.result.current.submit(); });
    expect(f.result.current.inlineError).toContain('품목과 생산수량');
    expect(f.result.current.recoveryError).toBe('');
    expect(f.result.current.failureRows[0].cause).toBe(cause);
    expect(f.result.current.failureRows[0].cause).not.toContain('품목과 생산수량');
});
it('중단 확인된 다른 사본의 다음행동은 다시중단이 아니라 남은 기기사본정리다', async () => {
    const f = fixture();
    const reference = { companyId: 'taebaek' as const, planId: 'broken', targetId: 'old' };
    const entry: ProductionRecordEntry = { key: productionRecordKey({ companyId: 'taebaek', actorUid: 'uid' }, reference), reference, request: null, requestHash: null, referenceHash: 'a'.repeat(64), observedLocalText: '손상 원문', observedReferenceText: '참조', status: 'corrupt', description: '이전 요청' };
    f.entries.push(entry);
    await act(async () => { await f.result.current.refresh(); });
    vi.mocked(f.bindings.command).mockResolvedValueOnce({ terminal: false, copyMismatch: true, result: { version: 1, reference, actorUid: 'uid', status: 'cancelled', requestHash: null, message: '미처리 요청 중단 완료' }, outcome: { status: 'rejected', message: '미처리 요청을 중단했지만 보관 내용은 확인이 필요합니다.', nextAction: '처리 결과를 확인한 뒤 이 기기에 남은 요청 정보만 정리해 주세요.' } });
    await act(async () => { await f.result.current.cancel(entry); });
    const row = f.result.current.failureRows[0];
    expect(row.currentState).toContain('중단');
    expect(row.nextAction).toContain('남은 요청 정보만 정리');
    expect(row.nextAction).not.toContain('미처리 요청 중단');
    expect(row.cause).not.toContain(row.nextAction);
    expect(f.result.current.canCancel(entry)).toBe(false);
});
it('현재 동일작성의 확정거절과 사본정리완료는 짧은 입력안내로 남긴다', async () => {
    const f = fixture();
    await fill(f.result);
    vi.mocked(f.bindings.command).mockImplementationOnce(async (_scope, entry) => { f.entries.splice(0); return { terminal: true, result: { version: 1, reference: entry.reference!, actorUid: 'uid', status: 'rejected', requestHash: entry.requestHash, message: '같은 기록이 이미 있습니다.' }, outcome: { status: 'rejected', message: '같은 기록이 이미 있습니다.', nextAction: '현재 기록을 확인한 뒤 새로 작성해 주세요.' } }; });
    await act(async () => { await f.result.current.submit(); });
    expect(f.result.current.failureCount).toBe(0);
    expect(f.result.current.inlineError).toContain('이미 있습니다');
    expect(f.result.current.inlineError).toContain('새로 작성');
    expect(f.result.current.recoveryError).toBe('');
    expect(f.result.current.form.note).toBe('원문');
});
it('과거 요청의 확정거절은 현재 새작성 입력안내로 승격하지 않는다', async () => {
    const f = fixture({ onAdd: vi.fn(async () => { throw Error('미확정'); }) });
    await fill(f.result);
    await act(async () => { await f.result.current.submit(); });
    const entry = f.result.current.operations[0];
    act(() => { f.result.current.closeForm(); f.result.current.openCreate(); f.result.current.setField('note', '새작성'); });
    vi.mocked(f.bindings.command).mockImplementationOnce(async () => { f.entries.splice(0); return { terminal: true, result: { version: 1, reference: entry.reference!, actorUid: 'uid', status: 'rejected', requestHash: entry.requestHash, message: '이전 요청 거절' }, outcome: { status: 'rejected', message: '이전 요청 거절', nextAction: '기록 확인' } }; });
    await act(async () => { await f.result.current.inspect(entry); });
    expect(f.result.current.inlineError).toBe('');
    expect(f.result.current.recoveryError).toContain('이전 요청 거절');
    expect(f.result.current.form.note).toBe('새작성');
    expect(f.result.current.showForm).toBe(true);
});
it('history-only 결과확인의 원인도 모달요약과 행에 중복하지 않는다', async () => {
    const f = fixture();
    await fill(f.result);
    const reference = { companyId: 'taebaek' as const, planId: 'history-only', targetId: 'old-record' };
    const result: ProductionRecordResult = { version: 1, reference, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '과거 등록 완료' };
    vi.mocked(f.bindings.history).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [{ result, action: 'create', createdAt: '2026-10-20' }], nextCursor: null });
    await act(async () => { await f.result.current.loadHistory(); });
    const entry = f.result.current.historyRows[0].entry;
    vi.mocked(f.bindings.command).mockResolvedValueOnce({ terminal: false, copyMismatch: true, result, outcome: { status: 'rejected', message: '현재 입력과 다른 과거 요청입니다.', nextAction: '현재 입력으로 새 업무를 진행해 주세요.' } });
    await act(async () => { await f.result.current.inspect(entry); });
    expect(f.result.current.recoveryError).toBe('');
    expect(f.result.current.inlineError).toBe('');
    expect(f.result.current.historyRows[0].cause).toBe('현재 입력과 다른 과거 요청입니다.');
    expect(f.result.current.historyRows[0].nextAction).toBe('현재 입력으로 새 업무를 진행해 주세요.');
});
