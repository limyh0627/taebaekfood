/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PalletStockEditRequest, PalletTransactionResult } from '../../../shared/palletTransactionCommand';
import type { PalletTransactionEntry as Entry } from '../../../shared/services/palletTransactionWrites';
import type { PalletStock } from '../../../shared/types';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'uid' } as {
            uid: string;
            getIdTokenResult?: () => Promise<unknown>;
        } | null }, listeners: new Set<(user: {
        uid: string;
    } | null) => void>(), entries: [] as Entry[], openEdit: vi.fn(), prepare: vi.fn(), command: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, fn: (user: {
        uid: string;
    } | null) => void) => { m.listeners.add(fn); fn(m.auth.currentUser); return () => m.listeners.delete(fn); } }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.rpc }));
vi.mock('../../../shared/services/palletTransactionWrites', () => ({ default: { read: async () => m.entries, openEdit: m.openEdit, prepare: m.prepare, command: m.command, findMatchingEdit: (rows: Entry[], input: {
            palletId: string;
            patch: unknown;
        }) => rows.find(row => row.request?.version === 3 && row.request.reference.palletId === input.palletId && JSON.stringify(row.request.patch) === JSON.stringify(input.patch)) ?? null } }));
import writes from '../../../shared/services/palletTransactionWrites';
import { usePalletTransactionEditor } from './usePalletTransactionEditor';
import { usePalletStockEditor } from './usePalletStockEditor';
const pallet = { id: 'pallet', name: '원래 이름', total: 10, damaged: 0, inUse: 2, hidden: false } as PalletStock;
const options = { companyId: 'taebaek' as 'taebaek' | 'punghoe', onRecoveryRequired: vi.fn(async () => { }) };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const entryOf = (request: PalletStockEditRequest): Entry => ({ key: 'key-' + request.reference.operationId, bodyRaw: JSON.stringify(request), referenceRaw: JSON.stringify(request.reference), request, reference: request.reference, transaction: null, summary: { action: 'edit-pallet', palletId: request.reference.palletId, original: request.original, patch: request.patch }, references: [{ reference: request.reference, source: 'both' }], requestHash: 'a'.repeat(64), legacy: false, lastAttempt: null, status: 'valid', description: '파렛트 정보 수정' });
const applied = (entry: Entry): PalletTransactionResult => ({ version: 1, reference: entry.reference!, actorUid: 'uid', status: 'applied', requestHash: entry.requestHash, message: '수정 처리됨' });
beforeEach(() => { m.auth.currentUser = { uid: 'uid', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'employee' } }) }; m.entries = []; m.rpc.mockReset(); options.onRecoveryRequired.mockClear(); m.openEdit.mockReset().mockImplementation(async (_scope, input) => ({ ...input, actorUid: 'uid', expectedVersion: '1:000000001' })); m.prepare.mockReset().mockImplementation(async (_scope, request) => { const entry = entryOf(request); m.entries = [entry]; return entry; }); m.command.mockReset().mockImplementation(async (_scope, entry) => ({ entry, result: applied(entry), terminal: true })); });
async function setup() { const hook = renderHook(props => usePalletStockEditor(props), { initialProps: options }); await act(async () => { }); act(() => hook.result.current.begin(pallet)); act(() => hook.result.current.change('name', '이름만 변경')); return hook; }
it('선택 원문은 유지하고 이름 dirty만 보관해 현재 ACK 뒤에 편집을 닫는다', async () => { const { result } = await setup(); await act(async () => result.current.save()); expect(m.openEdit.mock.calls[0][1].original).toEqual({ name: '원래 이름', total: 10, damaged: 0 }); expect(m.prepare.mock.calls[0][1]).toMatchObject({ version: 3, action: 'edit-pallet', patch: { name: '이름만 변경' } }); expect(m.prepare.mock.calls[0][1].patch).not.toHaveProperty('total'); expect(result.current.editingId).toBeNull(); });
it('동일 tick 두 저장은 하나만 보내고 pending 입력과 X를 잠근다', async () => { const reply = deferred<unknown>(); m.command.mockReturnValueOnce(reply.promise); const { result } = await setup(); let task!: Promise<void>; act(() => { task = result.current.save(); void result.current.save(); }); await waitFor(() => expect(m.command).toHaveBeenCalledOnce()); act(() => { result.current.close(); result.current.change('name', '덮기'); }); expect(result.current.editingId).toBe('pallet'); expect(result.current.draft.name).toBe('이름만 변경'); const entry = m.command.mock.calls[0][1]; await act(async () => { reply.resolve({ entry, result: applied(entry), terminal: true }); await task; }); expect(result.current.editingId).toBeNull(); });
it('거절과 유실은 원문을 보존하고 복구 진입을 알린다', async () => { m.command.mockRejectedValueOnce(Error('기존 total이 바뀌었습니다')); const { result } = await setup(); await act(async () => result.current.save()); expect(result.current.editingId).toBe('pallet'); expect(result.current.draft.name).toBe('이름만 변경'); expect(result.current.locked).toBe(true); expect(options.onRecoveryRequired).toHaveBeenCalledOnce(); });
it('변경 없는 저장은 open·보관·RPC 없이 닫는다', async () => { const hook = renderHook(() => usePalletStockEditor(options)); await act(async () => { }); act(() => hook.result.current.begin(pallet)); await act(async () => hook.result.current.save()); expect(m.openEdit).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.command).not.toHaveBeenCalled(); expect(hook.result.current.message).toContain('변경한 내용이 없습니다'); });
it('기존 숫자 입력0과 빈 이름·damaged가 total보다 큰 값을 새 관계검증 없이 dirty에 유지한다', async () => { const { result } = await setup(); act(() => { result.current.change('name', ''); result.current.change('total', 0); result.current.change('damaged', 3); }); await act(async () => result.current.save()); expect(m.prepare.mock.calls[0][1].patch).toEqual({ name: '', total: 0, damaged: 3 }); });
it.each(['company', 'uid', 'unmount'] as const)('준비 대기 중 %s 전환은 옛 보관과 송신을 시작하지 않는다', async (kind) => {
    const opening = deferred<unknown>();
    m.openEdit.mockReturnValueOnce(opening.promise);
    const hook = await setup();
    let task!: Promise<void>;
    act(() => { task = hook.result.current.save(); });
    await waitFor(() => expect(m.openEdit).toHaveBeenCalledOnce());
    const input = m.openEdit.mock.calls[0][1];
    if (kind === 'company') {
        hook.rerender({ ...options, companyId: 'punghoe' });
        hook.rerender(options);
    }
    else if (kind === 'unmount')
        hook.unmount();
    else {
        act(() => {
            m.auth.currentUser = { uid: 'other' };
            for (const fn of m.listeners)
                fn(m.auth.currentUser);
        });
        act(() => {
            m.auth.currentUser = { uid: 'uid' };
            for (const fn of m.listeners)
                fn(m.auth.currentUser);
        });
    }
    await act(async () => { opening.resolve({ ...input, actorUid: 'uid', expectedVersion: '1:000000001' }); await task; });
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.command).not.toHaveBeenCalled();
});
it('옛 ACK와 finally는 회사 왕복 뒤 새 편집 pending을 건드리지 않는다', async () => { const old = deferred<unknown>(), fresh = deferred<unknown>(); m.command.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise); const hook = await setup(); let first!: Promise<void>; act(() => { first = hook.result.current.save(); }); await waitFor(() => expect(m.command).toHaveBeenCalledOnce()); hook.rerender({ ...options, companyId: 'punghoe' }); hook.rerender(options); act(() => hook.result.current.begin({ ...pallet, id: 'new' })); act(() => hook.result.current.change('total', 7)); let second!: Promise<void>; act(() => { second = hook.result.current.save(); }); await waitFor(() => expect(m.command).toHaveBeenCalledTimes(2)); const oldEntry = m.command.mock.calls[0][1]; await act(async () => { old.resolve({ entry: oldEntry, result: applied(oldEntry), terminal: true }); await first; }); expect(hook.result.current.editingId).toBe('new'); expect(hook.result.current.draft.total).toBe(7); expect(hook.result.current.busy).toBe(true); const entry = m.command.mock.calls[1][1]; await act(async () => { fresh.resolve({ entry, result: applied(entry), terminal: true }); await second; }); });
it('정확 자기 메타의 전후 쌍만 연속 갱신하고 현재 조회 뒤 닫는다', async () => { m.command.mockRejectedValueOnce(Error('유실')); const { result } = await setup(); await act(async () => result.current.save()); const before = m.entries[0], after = { ...before, referenceRaw: '자기 갱신 메타' }; m.entries = [after]; await act(async () => result.current.acceptRecovery(before, { entry: after, terminal: false }, 'observed')); await act(async () => result.current.acceptRecovery(after, { entry: after, result: applied(after), terminal: true }, 'inspect')); expect(result.current.editingId).toBeNull(); });
it('외부 같은본문 메타 B에서 시작한 자기 C는 옛 prepared A를 건너뛰어 종결하지 않는다', async () => { m.command.mockRejectedValueOnce(Error('유실')); const { result } = await setup(); await act(async () => result.current.save()); const before = m.entries[0], external = { ...before, referenceRaw: '외부 B' }, after = { ...before, referenceRaw: '자기 C' }; m.entries = [after]; await act(async () => result.current.acceptRecovery(external, { entry: after, terminal: false }, 'observed')); await act(async () => result.current.acceptRecovery(after, { entry: after, result: applied(after), terminal: true }, 'inspect')); expect(result.current.editingId).toBe('pallet'); expect(result.current.locked).toBe(true); });
it('사본 정리는 편집을 닫고 최신 목록에서 다시 선택하도록 안내한다', async () => { m.command.mockRejectedValueOnce(Error('유실')); const { result } = await setup(); await act(async () => result.current.save()); await act(async () => result.current.acceptRecovery(m.entries[0], { entry: null, terminal: true }, 'discard')); expect(result.current.editingId).toBeNull(); expect(result.current.message).toContain('다시 선택'); });
it('보관 전 오류 뒤 재읽기도 실패하면 두 원인을 안내하고 Promise를 종결한다', async () => {
    const read = vi.spyOn(writes, 'read').mockResolvedValueOnce([]).mockRejectedValueOnce(Error('기기 보관 읽기 실패'));
    m.openEdit.mockRejectedValueOnce(Error('원문 확인 통신 실패'));
    const { result } = await setup();
    let escaped: unknown;
    try {
        await act(async () => { await result.current.save().catch(error => { escaped = error; }); });
        expect(escaped).toBeUndefined();
        expect(result.current.editingId).toBe('pallet');
        expect(result.current.draft.name).toBe('이름만 변경');
        expect(result.current.error).toContain('원문 확인 통신 실패');
        expect(result.current.error).toContain('기기 보관 읽기 실패');
    }
    finally {
        read.mockRestore();
    }
});
function useCombined() { const stock = usePalletStockEditor({ companyId: 'taebaek', onRecoveryRequired: async () => { await tx.refresh(); tx.openRecovery(); } }); const tx = usePalletTransactionEditor({ companyId: 'taebaek', pallets: [pallet], onRecoveryObserved: stock.acceptRecovery }); return { stock, tx }; }
it.each([false, true])('실 서비스 lost 자기메타와 외부메타=%s 복구는 정확 prepared 연결만 종결한다', async (external) => {
    localStorage.clear();
    const actual = await vi.importActual<typeof import('../../../shared/services/palletTransactionWrites')>('../../../shared/services/palletTransactionWrites');
    const before = { ...writes };
    Object.assign(writes, actual.default);
    m.rpc.mockImplementation(async (input: {
        mode: string;
        reference?: unknown;
        original?: unknown;
    }) => {
        if (input.mode === 'open-edit')
            return { data: { reference: input.reference, original: input.original, actorUid: 'uid', expectedVersion: '1:000000001' } };
        if (input.mode === 'apply')
            throw Error('실 편집 응답 유실');
        if (input.mode === 'inspect') {
            const entry = (await actual.default.read({ companyId: 'taebaek', actorUid: 'uid' }, () => true))[0];
            return { data: applied(entry) };
        }
        throw Error('예상하지 않은 RPC');
    });
    try {
        const { result, unmount } = renderHook(useCombined);
        await waitFor(() => expect(result.current.tx.readLoading).toBe(false));
        act(() => result.current.stock.begin(pallet));
        act(() => result.current.stock.change('name', '보관할 이름'));
        await act(async () => result.current.stock.save());
        expect(result.current.stock.editingId).toBe('pallet');
        let entry = result.current.tx.failureRows[0].entry;
        expect(entry.lastAttempt?.message).toContain('유실');
        if (external) {
            const side = JSON.parse(entry.referenceRaw!);
            side.lastAttempt = { at: '2026-10-21', outcome: 'unconfirmed', message: '다른 창의 메타' };
            localStorage.setItem(entry.key + ':reference', JSON.stringify(side));
            await act(async () => result.current.tx.refresh());
            entry = result.current.tx.failureRows[0].entry;
        }
        await act(async () => result.current.tx.retry(entry));
        entry = result.current.tx.failureRows[0].entry;
        expect(entry.lastAttempt?.message).toContain('실 편집 응답 유실');
        await act(async () => result.current.tx.inspect(entry));
        if (external) {
            expect(result.current.stock.editingId).toBe('pallet');
            expect(result.current.stock.error).toContain('편집을 닫고');
            await act(async () => result.current.tx.discard(entry));
            expect(result.current.stock.editingId).toBe('pallet');
            act(() => result.current.stock.close());
            expect(result.current.stock.editingId).toBeNull();
            act(() => result.current.stock.begin({ ...pallet, total: 7 }));
            expect(result.current.stock.draft.total).toBe(7);
        }
        else
            expect(result.current.stock.editingId).toBeNull();
        expect(m.rpc.mock.calls.filter(call => call[0].mode === 'apply')).toHaveLength(2);
        unmount();
    }
    finally {
        for (const key of Object.keys(writes))
            if (!(key in before))
                delete (writes as unknown as Record<string, unknown>)[key];
        Object.assign(writes, before);
        localStorage.clear();
    }
});
it('손상된 현재 row 선택은 동기 예외나 기존 편집 초안 교체 없이 원인을 알린다', async () => {
    const { result } = await setup();
    let escaped: unknown;
    act(() => {
        try {
            result.current.begin({ ...pallet, id: 'invalid', total: NaN });
        }
        catch (error) {
            escaped = error;
        }
    });
    expect(escaped).toBeUndefined();
    expect(result.current.editingId).toBe('pallet');
    expect(result.current.draft.name).toBe('이름만 변경');
    expect(result.current.error).toContain('확인');
});
it('과거 편집 조회는 새 편집과 현재 등록 창을 닫지 않는다', async () => { m.command.mockRejectedValueOnce(Error('유실')); const { result } = await setup(); await act(async () => result.current.save()); const old = m.entries[0]; act(() => result.current.close()); act(() => result.current.begin({ ...pallet, id: 'new' })); act(() => result.current.change('name', '새 편집')); await act(async () => result.current.acceptRecovery(old, { entry: old, result: applied(old), terminal: true }, 'inspect')); expect(result.current.editingId).toBe('new'); expect(result.current.draft.name).toBe('새 편집'); });
it('같은 patch의 과거 요청 선택은 새 원문의 현재 편집을 성공으로 닫지 않는다', async () => {
    const { result } = await setup();
    await act(async () => result.current.save());
    const old = m.entries[0];
    act(() => result.current.begin({ ...pallet, name: '이후 변경 이름', total: 7 }));
    act(() => result.current.change('name', '이름만 변경'));
    await act(async () => result.current.save());
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(m.command).toHaveBeenCalledOnce();
    await act(async () => result.current.acceptRecovery(old, { entry: old, result: applied(old), terminal: true }, 'inspect'));
    expect(result.current.editingId).toBe('pallet');
    expect(result.current.draft.name).toBe('이름만 변경');
    expect(result.current.draft.total).toBe(7);
    act(() => result.current.close());
    expect(result.current.editingId).toBeNull();
});
it('최종 재읽기에서 외부 메타를 관측하면 원메타 복원 뒤에도 편집 연결은 부활하지 않는다', async () => {
    m.command.mockRejectedValueOnce(Error('유실'));
    const { result } = await setup();
    await act(async () => result.current.save());
    const original = m.entries[0], external = { ...original, referenceRaw: '최종 읽기의 외부 메타' };
    m.entries = [external];
    await act(async () => result.current.acceptRecovery(original, { entry: original, result: applied(original), terminal: true }, 'inspect'));
    expect(result.current.editingId).toBe('pallet');
    expect(result.current.error).toContain('바뀌었습니다');
    m.entries = [original];
    await act(async () => result.current.acceptRecovery(original, { entry: original, result: applied(original), terminal: true }, 'inspect'));
    expect(result.current.editingId).toBe('pallet');
    expect(result.current.draft.name).toBe('이름만 변경');
    act(() => result.current.close());
    expect(result.current.editingId).toBeNull();
});
