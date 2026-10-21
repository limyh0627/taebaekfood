/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PalletTransactionEntry } from '../../../shared/services/palletTransactionWrites';
import type { PalletTransactionAnyRequest, PalletTransactionRequest, PalletTransactionResult } from '../../../shared/palletTransactionCommand';
import type { PalletStock } from '../../../shared/types';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'uid' } as {
            uid: string;
            getIdTokenResult?: () => Promise<unknown>;
        } | null }, listeners: new Set<(user: {
        uid: string;
    } | null) => void>(), entries: [] as unknown[], confirm: vi.fn(), notice: vi.fn(), openExchange: vi.fn(), rpc: vi.fn(), open: vi.fn(), prepare: vi.fn(), command: vi.fn(), discard: vi.fn() }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: m.confirm, appNotice: m.notice }));
vi.mock('../../../shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.rpc }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: (user: {
        uid: string;
    } | null) => void) => { m.listeners.add(listener); listener(m.auth.currentUser); return () => m.listeners.delete(listener); } }));
vi.mock('../../../shared/services/palletTransactionWrites', () => ({ default: { read: async () => m.entries, open: m.open, openExchange: m.openExchange, findMatchingExchange: (entries: PalletTransactionEntry[], id: string) => entries.find(row => row.request?.version === 2 && row.request.sourceTransactionId === id) ?? null, prepare: m.prepare, command: m.command, discard: m.discard, findMatching: (entries: PalletTransactionEntry[], transaction: PalletTransactionRequest['transaction']) => entries.find(row => JSON.stringify((row.request?.version === 1 ? row.request.transaction : null)) === JSON.stringify(transaction)) ?? null, projection: (entry: PalletTransactionEntry, results: PalletTransactionResult[]) => { const result = results.find(row => JSON.stringify(row.reference) === JSON.stringify(entry.reference)); return { isUnresolved: !result || result.status === 'unknown', terminal: !!result && result.status !== 'unknown', canUpgradeReference: false, currentState: result?.status ?? '미확정', cause: entry.lastAttempt?.message ?? '', nextAction: '처리 결과를 확인해 주세요.', referenceRows: entry.references.map(row => ({ ...row, label: '보관된 요청', currentState: result?.status ?? '미확정', cause: '', nextAction: '결과 확인', canInspect: true, canCancel: result?.status !== 'applied' && result?.status !== 'cancelled' })), canRetry: entry.status === 'valid' && !result, canInspect: entry.references.length > 0, canCancel: !result, canDiscard: entry.references.length === 0 || !!result }; } } }));
import writes from '../../../shared/services/palletTransactionWrites';
import { usePalletTransactionEditor } from './usePalletTransactionEditor';
function entryOf(request: PalletTransactionAnyRequest): PalletTransactionEntry { return { key: `key-${request.reference.operationId}`, bodyRaw: JSON.stringify(request), referenceRaw: JSON.stringify(request.reference), request, reference: request.reference, transaction: request.version === 1 ? request.transaction : null, summary: request.version === 1 ? { action: 'register', ...request.transaction, note: request.transaction.note ?? '', returnQty: request.transaction.exchangeReturnQty } : { action: 'complete-exchange', ...request.source, type: 'in', date: request.returnDate, returnQty: request.source.exchangeReturnQty ?? request.source.quantity, note: request.source.note ?? '', sourceTransactionId: request.sourceTransactionId }, legacy: false, references: [{ reference: request.reference, source: 'both' }], requestHash: 'a'.repeat(64), lastAttempt: null, status: 'valid', description: '등록 요청' }; }
const resultOf = (entry: PalletTransactionEntry, status: 'applied' | 'cancelled' | 'unknown' = 'applied'): PalletTransactionResult => ({ version: 1, reference: entry.reference!, actorUid: 'uid', status, requestHash: status === 'applied' ? 'a'.repeat(64) : null, message: '결과' });
const options = { partners: [] as import('../../../shared/types').Partner[], companyId: 'taebaek' as 'taebaek' | 'punghoe', pallets: [{ id: 'pallet', name: '파렛트', total: 100, damaged: 0 }] as PalletStock[] };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
beforeEach(() => { m.auth.currentUser = { uid: 'uid', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'employee' } }) }; m.confirm.mockReset().mockResolvedValue(true); m.notice.mockReset().mockResolvedValue(undefined); m.openExchange.mockReset().mockImplementation(async (_scope, input) => ({ ...input, actorUid: 'uid', expectedVersion: '1:000000001' })); m.rpc.mockReset(); m.entries = []; m.open.mockReset().mockImplementation(async (_scope, reference, palletId, originalTotal) => ({ reference, actorUid: 'uid', palletId, originalTotal, expectedVersion: '1:000000001' })); m.prepare.mockReset().mockImplementation(async (_scope, request, _current, own) => { const entry = entryOf(request); m.entries.push(entry); own?.(entry); return entry; }); m.command.mockReset().mockImplementation(async (_scope, entry) => ({ entry, result: resultOf(entry), terminal: true })); m.discard.mockReset().mockImplementation(async (_scope, _entry, _current, own) => { m.entries = []; own?.(null); return { entry: null, terminal: true }; }); });
async function setup() { const hook = renderHook(props => usePalletTransactionEditor(props), { initialProps: options }); await waitFor(() => expect(hook.result.current.readLoading).toBe(false)); act(() => { hook.result.current.open('in'); hook.result.current.change('partnerId', 'partner'); hook.result.current.change('palletId', 'pallet'); hook.result.current.change('quantity', '7'); hook.result.current.change('note', '보존할 입력'); }); return hook; }
it('원자 등록 대기 중 입력과 닫기를 잠그고 현재 ACK 뒤에만 닫는다', async () => {
    const reply = deferred<unknown>();
    m.command.mockReturnValueOnce(reply.promise);
    const { result } = await setup();
    let saving!: Promise<void>;
    act(() => { saving = result.current.submit(); void result.current.submit(); });
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    act(() => { result.current.close(); result.current.change('quantity', '9'); });
    expect(result.current.showForm).toBe(true);
    expect(result.current.draft.quantity).toBe('7');
    const entry = m.prepare.mock.results[0].value;
    await act(async () => { reply.resolve({ entry: await entry, result: resultOf(await entry), terminal: true }); await saving; });
    expect(result.current.showForm).toBe(false);
    expect(m.prepare).toHaveBeenCalledOnce();
});
it('응답 유실은 원문과 고정 ID를 보존하고 명시 재시도만 같은 요청을 보낸다', async () => {
    m.command.mockRejectedValueOnce(Error('응답 유실'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    expect(result.current.showForm).toBe(true);
    expect(result.current.draft.note).toBe('보존할 입력');
    expect(result.current.locked).toBe(true);
    expect(result.current.inlineError).toBe('');
    expect(result.current.failureCount).toBe(1);
    const row = result.current.failureRows[0];
    await act(async () => { await result.current.retry(row.entry); });
    expect(m.command.mock.calls[1][1].bodyRaw).toBe(m.command.mock.calls[0][1].bodyRaw);
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(result.current.showForm).toBe(false);
});
it('transfer는 선택 원보유량으로 준비하고 같은 버전과 원문을 원자 등록한다', async () => {
    const { result, rerender } = await setup();
    act(() => result.current.change('isTransfer', true));
    rerender({ ...options, pallets: [{ ...options.pallets[0], total: 200 }] });
    await act(async () => { await result.current.submit(); });
    expect(m.open.mock.calls[0][3]).toBe(100);
    const request = m.prepare.mock.calls[0][1];
    expect(request.transfer).toEqual({ originalTotal: 100, expectedVersion: '1:000000001' });
    expect(request.transaction).toMatchObject({ type: 'in', quantity: 7, isTransfer: true });
});
it('교체 등록은 기존 out 상태·회수 예정·비고를 보존하고 transfer 준비를 하지 않는다', async () => {
    const { result } = await setup();
    act(() => { result.current.close(); result.current.open('exchange', 'partner'); result.current.change('palletId', 'pallet'); result.current.change('newQty', '8'); result.current.change('returnQty', '3'); result.current.change('note', '검수'); });
    await act(async () => { await result.current.submit(); });
    expect(m.open).not.toHaveBeenCalled();
    expect(m.prepare.mock.calls[0][1].transaction).toMatchObject({ type: 'out', quantity: 8, status: '교체중', exchangeReturnQty: 3, note: '교체 지급 — 검수' });
});
it('실 UID 왕복 뒤 옛 ACK는 현재 새 초안과 새 busy를 건드리지 않는다', async () => {
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    m.command.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result } = await setup();
    let first!: Promise<void>;
    act(() => { first = result.current.submit(); });
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    act(() => {
        m.auth.currentUser = { uid: 'other' };
        for (const listener of m.listeners)
            listener(m.auth.currentUser);
    });
    act(() => {
        m.auth.currentUser = { uid: 'uid' };
        for (const listener of m.listeners)
            listener(m.auth.currentUser);
    });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    act(() => { result.current.open('out', 'partner'); result.current.change('palletId', 'pallet'); result.current.change('quantity', '20'); });
    let second!: Promise<void>;
    act(() => { second = result.current.submit(); });
    await waitFor(() => expect(m.command).toHaveBeenCalledTimes(2));
    const firstEntry = m.command.mock.calls[0][1];
    await act(async () => { old.resolve({ entry: firstEntry, result: resultOf(firstEntry), terminal: true }); await first; });
    expect(result.current.draft.quantity).toBe('20');
    expect(result.current.showForm).toBe(true);
    expect(result.current.busy).toBe(true);
    const secondEntry = m.command.mock.calls[1][1];
    await act(async () => { fresh.resolve({ entry: secondEntry, result: resultOf(secondEntry), terminal: true }); await second; });
});
it('준비 open 대기 중 회사 변경은 원문 보관과 송신을 시작하지 않는다', async () => {
    const opening = deferred<unknown>();
    m.open.mockReturnValueOnce(opening.promise);
    const { result, rerender } = await setup();
    act(() => result.current.change('isTransfer', true));
    let saving!: Promise<void>;
    act(() => { saving = result.current.submit(); });
    await waitFor(() => expect(m.open).toHaveBeenCalledOnce());
    const args = m.open.mock.calls[0];
    rerender({ ...options, companyId: 'punghoe' });
    await act(async () => { opening.resolve({ reference: args[1], actorUid: 'uid', palletId: 'pallet', originalTotal: 100, expectedVersion: '1:000000001' }); await saving; });
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.command).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
});
it('과거 요청 조회와 사본 정리는 새 폼을 닫거나 업무를 재송신하지 않는다', async () => {
    m.command.mockRejectedValueOnce(Error('lost'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    const old = result.current.failureRows[0].entry;
    act(() => { result.current.close(); result.current.open('out', 'partner'); result.current.change('quantity', '99'); });
    await act(async () => { await result.current.inspect(old); await result.current.discard(old); });
    expect(result.current.showForm).toBe(true);
    expect(result.current.draft.quantity).toBe('99');
    expect(m.command.mock.calls[1][2]).toBe('inspect');
    expect(m.prepare).toHaveBeenCalledOnce();
});
it('unmount 뒤 응답은 새 마운트의 초안에 영향을 주지 않는다', async () => {
    const reply = deferred<unknown>();
    m.command.mockReturnValueOnce(reply.promise);
    const old = await setup();
    let saving!: Promise<void>;
    act(() => { saving = old.result.current.submit(); });
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    old.unmount();
    const next = await setup();
    const entry = m.command.mock.calls[0][1];
    await act(async () => { reply.resolve({ entry, result: resultOf(entry), terminal: true }); await saving; });
    expect(next.result.current.showForm).toBe(true);
    expect(next.result.current.draft.quantity).toBe('7');
});
it('현재 초안의 보관 사본이 바뀌면 조용히 잠그지 않고 다시 읽기 안내를 남긴다', async () => {
    m.command.mockImplementationOnce(async (_scope, entry) => ({ entry, terminal: false, copyMismatch: true }));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    expect(result.current.showForm).toBe(true);
    expect(result.current.recoveryError).toContain('바뀌었습니다');
    expect(result.current.inlineMessage).toContain('다시');
});
it.each(['unknown', 'applied'] as const)('close/open 뒤 동일 intent의 %s 보관 요청은 새 송신 대신 처리 확인으로 연결한다', async (status) => {
    if (status === 'unknown')
        m.command.mockRejectedValueOnce(Error('lost'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    const count = m.prepare.mock.calls.length;
    act(() => { result.current.close(); result.current.open('in'); result.current.change('partnerId', 'partner'); result.current.change('palletId', 'pallet'); result.current.change('quantity', '7'); result.current.change('note', '보존할 입력'); });
    await act(async () => { await result.current.submit(); });
    expect(m.prepare).toHaveBeenCalledTimes(count);
    expect(m.command).toHaveBeenCalledTimes(1);
    expect(result.current.recoveryOpen).toBe(true);
    expect(result.current.locked).toBe(true);
    if (status === 'applied') {
        expect(result.current.failureCount).toBe(0);
        expect(result.current.recoveryRows).toHaveLength(1);
    }
});
it('다른 수량의 명시 새 입력은 과거 미확정 원문을 보존하면서 새 요청을 보낸다', async () => {
    m.command.mockRejectedValueOnce(Error('lost'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    const old = (m.entries[0] as PalletTransactionEntry).bodyRaw;
    act(() => { result.current.close(); result.current.open('in', 'partner'); result.current.change('palletId', 'pallet'); result.current.change('quantity', '8'); });
    await act(async () => { await result.current.submit(); });
    expect(m.prepare).toHaveBeenCalledTimes(2);
    expect(m.command).toHaveBeenCalledTimes(2);
    expect((m.entries[0] as PalletTransactionEntry).bodyRaw).toBe(old);
});
it('실패 재시도에서 자기 메타가 갱신되면 다음 조회 행은 최신 양 관측을 사용한다', async () => {
    m.command.mockRejectedValueOnce(Error('첫 유실'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    const entry = result.current.failureRows[0].entry;
    m.command.mockImplementationOnce(async (_scope, old, _mode, _current, _reference, own) => { const next = { ...old, referenceRaw: 'updated-self-metadata', lastAttempt: { at: 'now', outcome: 'unconfirmed', message: '두 번째 유실' } }; m.entries = [next]; own(next); throw Error('두 번째 유실'); });
    await act(async () => { await result.current.retry(entry); });
    expect(result.current.failureRows[0].entry.referenceRaw).toBe('updated-self-metadata');
    await act(async () => { await result.current.retry(result.current.failureRows[0].entry); });
    expect(m.command.mock.calls[2][1].referenceRaw).toBe('updated-self-metadata');
});
it('보관 거래의 날짜·유형·수량·비고와 현재 목록 이름을 구분해 요약한다', async () => {
    m.command.mockRejectedValueOnce(Error('lost'));
    const { result, rerender } = await setup();
    await act(async () => { await result.current.submit(); });
    const summary = result.current.recoveryRows[0].summary;
    expect(summary).toMatchObject({ kind: '입고', quantity: 7, note: '보존할 입력', partnerName: '거래처 정보 없음', palletName: '파렛트' });
    expect(summary?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    rerender({ ...options, partners: [{ id: 'partner', name: '현재 거래처' }] as typeof options.partners });
    expect(result.current.recoveryRows[0].summary?.partnerName).toBe('현재 거래처');
});
it('보관 준비가 원문을 남긴 뒤 실패해도 긴 기술 원인은 본문 검증 오류로 승격하지 않는다', async () => {
    m.prepare.mockImplementationOnce(async (_scope, request) => { m.entries = [entryOf(request)]; throw Error('참조 readback 실패'); });
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    expect(result.current.inlineError).toBe('');
    expect(result.current.recoveryError).toBe('참조 readback 실패');
    expect(result.current.failureCount).toBe(1);
    expect(m.command).not.toHaveBeenCalled();
});
it('현재 미확정 원문과 같은 해시의 실제 결과 확인은 현재 창만 닫고 사본을 남긴다', async () => {
    m.command.mockRejectedValueOnce(Error('lost'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    const entry = result.current.failureRows[0].entry;
    await act(async () => { await result.current.inspect(entry); });
    expect(result.current.showForm).toBe(false);
    expect(m.entries).toHaveLength(1);
    expect(result.current.failureCount).toBe(0);
    expect(result.current.recoveryRows).toHaveLength(1);
});
it.each(['hash', 'body', 'pair'] as const)('결과 확인의 %s 근거가 현재 원문과 다르면 창을 닫지 않는다', async (mode) => {
    m.command.mockRejectedValueOnce(Error('lost'));
    const { result } = await setup();
    await act(async () => { await result.current.submit(); });
    let entry = result.current.failureRows[0].entry;
    if (mode === 'body') {
        entry = { ...entry, bodyRaw: null, request: null, status: 'corrupt' };
        m.entries = [entry];
    }
    m.command.mockImplementationOnce(async (_scope, observed) => ({ entry: mode === 'pair' ? { ...observed, referenceRaw: 'replaced-reference' } : observed, result: { ...resultOf(observed), requestHash: mode === 'hash' ? 'b'.repeat(64) : observed.requestHash }, terminal: true }));
    await act(async () => { await result.current.inspect(entry); });
    expect(result.current.showForm).toBe(true);
    expect(result.current.draft.quantity).toBe('7');
});
it('실 보관 서비스의 자기 오류 메타 갱신 뒤 같은 현재 요청 결과 확인을 종결한다', async () => {
    localStorage.clear();
    const actual = await vi.importActual<typeof import('../../../shared/services/palletTransactionWrites')>('../../../shared/services/palletTransactionWrites');
    const before = { ...writes };
    Object.assign(writes, actual.default);
    let request: PalletTransactionRequest | undefined;
    m.rpc.mockImplementation(async (input: {
        mode: string;
        request?: PalletTransactionRequest;
        reference?: unknown;
    }) => {
        if (input.mode === 'apply') {
            request = input.request;
            throw Error('실 서비스 ACK 유실');
        }
        if (input.mode === 'inspect' && request) {
            const serialized = actual.default;
            const entry = (await serialized.read({ companyId: 'taebaek', actorUid: 'uid' }, () => true))[0];
            return { data: { ...resultOf(entry), requestHash: entry.requestHash } };
        }
        throw Error('예상하지 않은 명령');
    });
    try {
        const { result, unmount } = await setup();
        await act(async () => { await result.current.submit(); });
        expect(result.current.showForm).toBe(true);
        const row = result.current.failureRows[0];
        expect(row.entry.lastAttempt?.message).toContain('ACK 유실');
        expect(row.entry.referenceRaw).toContain('lastAttempt');
        await act(async () => { await result.current.inspect(row.entry); });
        expect(result.current.showForm).toBe(false);
        expect(result.current.failureCount).toBe(0);
        expect(localStorage.length).toBeGreaterThan(0);
        unmount();
    }
    finally {
        Object.assign(writes, before);
        localStorage.clear();
    }
});
const exchangeSource = { id: 'exchange-source', companyId: 'taebaek' as const, partnerId: 'partner', palletId: 'pallet', type: 'out' as const, quantity: 5, date: '2026-10-01', status: '교체중' as const, exchangeReturnQty: 3, note: '교체 지급' };
it('교체완료는 확인 전 잠금으로 중복 확인과 송신을 막고 고정 v2 요청만 보낸다', async () => {
    const confirm = deferred<boolean>();
    m.confirm.mockReturnValueOnce(confirm.promise);
    const { result } = await setup();
    let first!: Promise<void>;
    act(() => { first = result.current.completeExchange(exchangeSource); void result.current.completeExchange(exchangeSource); });
    await waitFor(() => expect(m.confirm).toHaveBeenCalledOnce());
    expect(m.prepare).not.toHaveBeenCalled();
    await act(async () => { confirm.resolve(true); await first; });
    expect(m.openExchange).toHaveBeenCalledOnce();
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(m.command).toHaveBeenCalledOnce();
    expect(m.prepare.mock.calls[0][1]).toMatchObject({ version: 2, action: 'complete-exchange', sourceTransactionId: exchangeSource.id, source: { quantity: 5, exchangeReturnQty: 3 }, expectedVersion: '1:000000001' });
    expect(result.current.isExchangeApplied(exchangeSource.id)).toBe(true);
    expect(result.current.showForm).toBe(true);
    expect(result.current.draft.note).toBe('보존할 입력');
    expect(m.notice).toHaveBeenCalledWith(expect.stringContaining('회수 수량 3개'));
});
it('교체완료 응답 유실은 원문을 보존하고 다음날 같은 source는 재보관 대신 복구를 연다', async () => {
    m.command.mockRejectedValueOnce(Error('회수 응답 유실'));
    const { result } = await setup();
    await act(async () => result.current.completeExchange(exchangeSource));
    expect(result.current.failureCount).toBe(1);
    expect(result.current.recoveryOpen).toBe(true);
    expect(result.current.showForm).toBe(true);
    await act(async () => result.current.completeExchange({ ...exchangeSource, date: '2026-10-02' }));
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(m.command).toHaveBeenCalledOnce();
    const observed = result.current.failureRows[0].entry;
    await act(async () => result.current.retry(observed));
    expect(m.command.mock.calls[1][1].bodyRaw).toBe(observed.bodyRaw);
    expect(result.current.isExchangeApplied(exchangeSource.id)).toBe(true);
    expect(result.current.showForm).toBe(true);
    expect(result.current.failureCount).toBe(0);
});
it.each(['company', 'uid', 'unmount'] as const)('교체완료 확인 대기 중 %s 전환은 open과 송신을 시작하지 않는다', async (kind) => {
    const confirm = deferred<boolean>();
    m.confirm.mockReturnValueOnce(confirm.promise);
    const hook = await setup();
    let task!: Promise<void>;
    act(() => { task = hook.result.current.completeExchange(exchangeSource); });
    await waitFor(() => expect(m.confirm).toHaveBeenCalledOnce());
    if (kind === 'company')
        hook.rerender({ ...options, companyId: 'punghoe' });
    else if (kind === 'unmount')
        hook.unmount();
    else {
        act(() => {
            m.auth.currentUser = { uid: 'other' };
            for (const listener of m.listeners)
                listener(m.auth.currentUser);
        });
        act(() => {
            m.auth.currentUser = { uid: 'uid' };
            for (const listener of m.listeners)
                listener(m.auth.currentUser);
        });
    }
    await act(async () => { confirm.resolve(true); await task; });
    expect(m.openExchange).not.toHaveBeenCalled();
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.command).not.toHaveBeenCalled();
});
it('옛 교체완료 ACK와 finally는 회사 왕복 뒤 새 등록 pending을 침범하지 않는다', async () => {
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    m.command.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const hook = await setup();
    let first!: Promise<void>;
    act(() => { first = hook.result.current.completeExchange(exchangeSource); });
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    hook.rerender({ ...options, companyId: 'punghoe' });
    hook.rerender(options);
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    act(() => { hook.result.current.open('in', 'partner'); hook.result.current.change('palletId', 'pallet'); hook.result.current.change('quantity', '19'); });
    let second!: Promise<void>;
    act(() => { second = hook.result.current.submit(); });
    await waitFor(() => expect(m.command).toHaveBeenCalledTimes(2));
    const entry = m.command.mock.calls[0][1];
    await act(async () => { old.resolve({ entry, result: resultOf(entry), terminal: true }); await first; });
    expect(hook.result.current.showForm).toBe(true);
    expect(hook.result.current.draft.quantity).toBe('19');
    expect(hook.result.current.busy).toBe(true);
    expect(m.notice).not.toHaveBeenCalled();
    const current = m.command.mock.calls[1][1];
    await act(async () => { fresh.resolve({ entry: current, result: resultOf(current), terminal: true }); await second; });
});
it('회수0 완료도 등록 폼을 닫지 않고 수량0을 안내한다', async () => { const { result } = await setup(); await act(async () => result.current.completeExchange({ ...exchangeSource, exchangeReturnQty: 0 })); expect(m.prepare.mock.calls[0][1].source.exchangeReturnQty).toBe(0); expect(result.current.showForm).toBe(true); expect(m.notice).toHaveBeenCalledWith(expect.stringContaining('회수 수량 0개')); });
it('완료 ACK 뒤 목록조회 실패는 완료를 보존하고 명시 재조회만 수행한다', async () => {
    const refreshed = vi.fn().mockRejectedValueOnce(Error('목록 연결 실패')).mockResolvedValue(undefined);
    const hook = renderHook(() => usePalletTransactionEditor({ ...options, onExchangeApplied: refreshed }));
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    await act(async () => hook.result.current.completeExchange(exchangeSource));
    expect(hook.result.current.isExchangeApplied(exchangeSource.id)).toBe(true);
    expect(hook.result.current.recoveryError).toContain('교체완료 처리는 확인했지만 목록을 갱신하지 못했습니다');
    await act(async () => hook.result.current.completeExchange(exchangeSource));
    expect(m.command).toHaveBeenCalledOnce();
    await act(async () => hook.result.current.refreshExchange());
    expect(refreshed).toHaveBeenCalledTimes(2);
    expect(hook.result.current.recoveryError).toBe('');
});
it('완료 과거 조회는 유효 v2 해시가 같을 때만 source 표시와 목록조회에 연결한다', async () => {
    const refreshed = vi.fn();
    const hook = renderHook(() => usePalletTransactionEditor({ ...options, onExchangeApplied: refreshed }));
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    m.command.mockRejectedValueOnce(Error('유실'));
    await act(async () => hook.result.current.completeExchange(exchangeSource));
    const entry = hook.result.current.failureRows[0].entry;
    await act(async () => hook.result.current.inspect(entry));
    expect(hook.result.current.isExchangeApplied(exchangeSource.id)).toBe(true);
    expect(refreshed).toHaveBeenCalledOnce();
    expect(m.notice).not.toHaveBeenCalled();
});
it('실 서비스 완료 유실 메타 뒤 결과조회는 완료 표시만 갱신하고 등록 초안을 보존한다', async () => {
    localStorage.clear();
    const actual = await vi.importActual<typeof import('../../../shared/services/palletTransactionWrites')>('../../../shared/services/palletTransactionWrites');
    const before = { ...writes };
    Object.assign(writes, actual.default);
    let held: import('../../../shared/palletTransactionCommand').PalletExchangeOpenInput | undefined;
    m.rpc.mockImplementation(async (input: {
        mode: string;
        reference?: unknown;
        sourceTransactionId?: string;
        source?: unknown;
    }) => {
        if (input.mode === 'open-exchange') {
            held = input as unknown as typeof held;
            return { data: { reference: input.reference, sourceTransactionId: input.sourceTransactionId, source: input.source, actorUid: 'uid', expectedVersion: '1:000000001' } };
        }
        if (input.mode === 'apply')
            throw Error('실 완료 ACK 유실');
        if (input.mode === 'inspect') {
            const entry = (await actual.default.read({ companyId: 'taebaek', actorUid: 'uid' }, () => true))[0];
            return { data: { ...resultOf(entry), requestHash: entry.requestHash } };
        }
        throw Error('예상하지 않은 명령');
    });
    try {
        const { result, unmount } = await setup();
        await act(async () => result.current.completeExchange(exchangeSource));
        expect(held?.sourceTransactionId).toBe(exchangeSource.id);
        const entry = result.current.failureRows[0].entry;
        expect(entry.lastAttempt?.message).toContain('ACK 유실');
        await act(async () => result.current.inspect(entry));
        expect(result.current.isExchangeApplied(exchangeSource.id)).toBe(true);
        expect(result.current.showForm).toBe(true);
        expect(result.current.draft.note).toBe('보존할 입력');
        expect(result.current.failureCount).toBe(0);
        expect(localStorage.length).toBeGreaterThan(0);
        expect(m.rpc.mock.calls.filter(call => call[0].mode === 'apply')).toHaveLength(1);
        unmount();
    }
    finally {
        Object.assign(writes, before);
        localStorage.clear();
    }
});
it('다른 기기가 source를 바꿔 준비가 거절되어도 명시 이력조회는 실제 읽기를 수행한다', async () => {
    const refreshed = vi.fn();
    m.openExchange.mockRejectedValueOnce(Error('이미 다른 기기에서 변경되었습니다'));
    const hook = renderHook(() => usePalletTransactionEditor({ ...options, onExchangeApplied: refreshed }));
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    await act(async () => hook.result.current.completeExchange(exchangeSource));
    expect(m.prepare).not.toHaveBeenCalled();
    expect(hook.result.current.recoveryOpen).toBe(true);
    expect(hook.result.current.isExchangeApplied(exchangeSource.id)).toBe(false);
    await act(async () => hook.result.current.refreshExchange());
    expect(refreshed).toHaveBeenCalledExactlyOnceWith(exchangeSource.id, expect.any(Function));
    expect(hook.result.current.isExchangeApplied(exchangeSource.id)).toBe(false);
    expect(m.command).not.toHaveBeenCalled();
});
