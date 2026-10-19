// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePartnerAdvanceRecovery, partnerAdvanceServices } from './usePartnerAdvanceRecovery';
import type { PreparedPartnerAdvance } from '../../../shared/partnerAdvance';
import type { AdvanceRecoveryEntry, AdvanceRecoveryOutcome } from '../infrastructure/partnerAdvanceCommands';
const mocks = vi.hoisted(() => ({
    auth: {
        currentUser: {
            uid: 'uid'
        } as {
            uid: string;
        } | null
    }, listeners: new Set<(user: {
        uid: string;
    } | null) => void>()
}));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth: unknown, callback: (user: {
        uid: string;
    } | null) => void) => { mocks.listeners.add(callback); return () => mocks.listeners.delete(callback); }
}));
vi.mock('../../../shared/firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve(), functions: {}
}));
const data: PreparedPartnerAdvance = {
    enabled: true, revision: 1, releaseId: 'release', sources: [{
            key: {
                collection: 'cashEntries', id: 'cash', lineKey: '133'
            }, code: '133', originalAmount: 100, remaining: 100, date: '2026-10-01', docNo: '출금-1', note: '', fingerprint: 'a'.repeat(64)
        }], targets: [{
            statementId: 'target', accountCode: '251', remaining: 70, date: '2026-10-02', docNo: '매입-1', fingerprint: 'b'.repeat(64)
        }], applications: [], diagnostics: []
};
const options = {
    companyId: 'taebaek' as const, partnerId: 'p', confirm: vi.fn(async () => true)
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return {
        promise, resolve
    };
}
function fixture() {
    let rows: AdvanceRecoveryEntry[] = [];
    const services = {
        ...partnerAdvanceServices, prepare: vi.fn<typeof partnerAdvanceServices.prepare>(async () => structuredClone(data)), read: vi.fn<typeof partnerAdvanceServices.read>(async () => rows), submit: vi.fn<typeof partnerAdvanceServices.submit>(async () => ({
            outcome: {
                status: 'saved'
            }, terminal: true
        })), resolve: vi.fn<typeof partnerAdvanceServices.resolve>(async () => ({
            outcome: {
                status: 'unknown', message: '아직 확인 중', nextAction: '결과 확인'
            }, terminal: false
        })), retry: vi.fn<typeof partnerAdvanceServices.retry>(async () => ({
            outcome: {
                status: 'saved'
            }, terminal: true
        })), discard: vi.fn<typeof partnerAdvanceServices.discard>(async () => ({
            status: 'cleared', message: '기기 사본만 정리'
        })), list: vi.fn<typeof partnerAdvanceServices.list>(async () => ({
            version: 1, companyId: 'taebaek', actorId: 'uid', partnerId: 'p', entries: [], nextCursor: null
        }))
    };
    return {
        services, setRows: (value: AdvanceRecoveryEntry[]) => { rows = value; }
    };
}
const row = (operationId = 'old'): AdvanceRecoveryEntry => ({
    key: 'key', bodyText: 'raw', sidecarKey: 'refkey', sidecarText: 'reference', reference: {
        companyId: 'taebaek', partnerId: 'p', operationId
    }, request: null, requestHash: null, sidecarHash: null, status: 'corrupt', description: '원문'
});
beforeEach(() => {
    mocks.auth.currentUser = {
        uid: 'uid'
    };
    mocks.listeners.clear();
    options.confirm.mockClear();
});
it('기존 잔액 한도·정렬 제안과 고정 요청을 보존하고 같은 tick 중복을 막는다', async () => {
    const f = fixture(), gate = deferred<AdvanceRecoveryOutcome>();
    f.services.submit.mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    expect(result.current.amount).toBe('70');
    expect(result.current.selectionValid).toBe(true);
    let sending!: Promise<boolean>;
    act(() => { sending = result.current.submit(); });
    await act(async () => { });
    await act(() => result.current.submit());
    expect(f.services.submit).toHaveBeenCalledOnce();
    const pending = f.services.submit.mock.calls[0][1];
    expect(pending.input).toMatchObject({
        amount: 70, date: result.current.date, expectedRevision: 1, releaseId: 'release'
    });
    await act(async () => {
        gate.resolve({
            outcome: {
                status: 'saved'
            }, terminal: true
        });
        await sending;
    });
    expect(result.current.applied).toBe(true);
});
it('초기 원문 읽기 중과 실패 후에는 금융 송신을 막고 명시 읽기가 복구한다', async () => {
    const f = fixture(), gate = deferred<AdvanceRecoveryEntry[]>();
    f.services.read.mockReturnValueOnce(gate.promise).mockRejectedValueOnce(Error('보관 오류')).mockResolvedValue([]);
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(() => result.current.submit());
    expect(f.services.submit).not.toHaveBeenCalled();
    await act(async () => gate.resolve([]));
    await act(() => result.current.refresh());
    expect(result.current.readError).toContain('보관 오류');
    await act(() => result.current.submit());
    expect(f.services.submit).not.toHaveBeenCalled();
    await act(() => result.current.refresh());
    expect(result.current.readError).toBe('');
});
it('결과 확인은 readonly resolve만 호출하며 새 금액·날짜를 덮지 않는다', async () => {
    const f = fixture(), { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    act(() => { result.current.setAmount('30'); result.current.setDate('2026-10-05'); });
    await act(() => result.current.inspect(row()));
    expect(f.services.resolve).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), 'inspect', expect.any(Function));
    expect(f.services.submit).not.toHaveBeenCalled();
    expect(f.services.retry).not.toHaveBeenCalled();
    expect(result.current.amount).toBe('30');
    expect(result.current.date).toBe('2026-10-05');
});
it('과거 완료와 기기사본 정리는 현재 새 상계 또는 현금 초안 완료가 아니다', async () => {
    const f = fixture(), state = vi.fn();
    f.services.resolve.mockResolvedValue({
        outcome: {
            status: 'saved'
        }, terminal: true
    });
    const { result } = renderHook(() => usePartnerAdvanceRecovery({
        ...options, onStateChange: state
    }, f.services));
    await act(async () => { });
    act(() => result.current.setAmount('35'));
    const previous: AdvanceRecoveryEntry = {
        ...row(), request: {
            version: 1, companyId: 'taebaek', actorId: 'uid', action: 'apply', input: {
                operationId: 'old', partnerId: 'p', date: '2026-10-01', source: data.sources[0].key, statementId: 'target', accountCode: '251', amount: 60, expectedRevision: 0, releaseId: 'release', expectedSourceFingerprint: 'a'.repeat(64), expectedTargetFingerprint: 'b'.repeat(64)
            }
        }
    };
    await act(() => result.current.inspect(previous));
    expect(result.current.applied).toBe(false);
    expect(result.current.amount).toBe('35');
    await act(() => result.current.discardCopy(row()));
    expect(result.current.applied).toBe(false);
    expect(result.current.resetVersion).toBe(0);
    expect(f.services.submit).not.toHaveBeenCalled();
});
it('현재 송신의 완료를 조회하면 그 원문만 종결하고 잔액 실패는 재송신 없이 재조회한다', async () => {
    const f = fixture();
    let currentRow: AdvanceRecoveryEntry;
    f.services.submit.mockImplementationOnce(async (_scope, pending) => {
        currentRow = {
            ...row(pending.input.operationId), request: pending, status: 'valid'
        };
        f.setRows([currentRow]);
        return {
            outcome: {
                status: 'unknown', message: 'ACK 유실', nextAction: '결과 확인'
            }, terminal: false
        };
    });
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    await act(() => result.current.submit());
    f.setRows([]);
    f.services.resolve.mockResolvedValueOnce({
        outcome: {
            status: 'saved'
        }, terminal: true
    });
    f.services.prepare.mockRejectedValueOnce(Error('잔액 오류'));
    await act(() => result.current.inspect(currentRow!));
    expect(result.current.applied).toBe(true);
    expect(result.current.refreshFailed).toBe(true);
    await act(() => result.current.refreshBalances());
    expect(f.services.submit).toHaveBeenCalledOnce();
    expect(result.current.refreshFailed).toBe(false);
});
it('현재 요청도 사본정리 partial이면 applied/reset을 올리지 않고 원인을 보존한다', async () => {
    const f = fixture();
    f.services.submit.mockResolvedValueOnce({
        terminal: false, outcome: {
            status: 'partial', reason: 'followup-unconfirmed', committedIds: ['op'], unconfirmedIds: [], message: '상계 완료 기기정리 실패', nextAction: '조회만'
        }
    });
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    await act(() => result.current.submit());
    expect(result.current.applied).toBe(false);
    expect(result.current.message).toContain('기기정리 실패');
    expect(result.current.message).toContain('조회만');
});
it('확인창 await 뒤 UID 변경은 금융 요청을 보내지 않는다', async () => {
    const f = fixture(), gate = deferred<boolean>();
    const { result } = renderHook(() => usePartnerAdvanceRecovery({
        ...options, confirm: () => gate.promise
    }, f.services));
    await act(async () => { });
    let sending!: Promise<boolean>;
    act(() => { sending = result.current.submit(); });
    act(() => {
        mocks.auth.currentUser = {
            uid: 'other'
        };
        mocks.listeners.forEach(fn => fn(mocks.auth.currentUser));
    });
    await act(async () => { gate.resolve(true); await sending; });
    expect(f.services.submit).not.toHaveBeenCalled();
});
it('이전 render 저장 함수는 같은 UID의 다른 거래처로 송신하지 않는다', async () => {
    const f = fixture(), { result, rerender } = renderHook(({ partnerId }) => usePartnerAdvanceRecovery({
        ...options, partnerId
    }, f.services), {
        initialProps: {
            partnerId: 'p'
        }
    });
    await act(async () => { });
    const old = result.current.submit;
    rerender({
        partnerId: 'p2'
    });
    await act(async () => { });
    await act(() => old());
    expect(f.services.submit).not.toHaveBeenCalled();
});
it('이력은 명시 조회만 하며 빈페이지 cursor를 유지하고 과거 ref는 원문합성 없이 조회한다', async () => {
    const f = fixture();
    f.services.list.mockResolvedValue({
        version: 1, companyId: 'taebaek', actorId: 'uid', partnerId: 'p', entries: [], nextCursor: 'next'
    });
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    expect(f.services.list).not.toHaveBeenCalled();
    await act(() => result.current.loadHistory());
    expect(result.current.historyMore).toBe('next');
    expect(result.current.message).toContain('0건');
    await act(() => result.current.nextHistory());
    expect(f.services.list).toHaveBeenLastCalledWith(expect.any(Object), 'next', expect.any(Function));
    await act(() => result.current.inspectHistory({
        version: 1, reference: row().reference!, actorId: 'uid', status: 'unknown', requestHash: null, message: '과거'
    }));
    expect(f.services.resolve.mock.calls.at(-1)?.[1].request).toBeNull();
});
it('외부 현금 busy는 상계 송신·중단도 막고 권한 없는 오래된 결과는 새 busy를 풀지 않는다', async () => {
    const f = fixture(), { result } = renderHook(() => usePartnerAdvanceRecovery({
        ...options, externalBusy: true
    }, f.services));
    await act(async () => { });
    await act(() => result.current.submit());
    await act(() => result.current.stop(row()));
    expect(f.services.submit).not.toHaveBeenCalled();
    expect(f.services.resolve).not.toHaveBeenCalled();
});
it('처음 잔액 조회 실패 뒤 명시 재조회 성공은 그 실패 안내를 없앤다', async () => {
    const f = fixture();
    f.services.prepare.mockRejectedValueOnce(Error('첫 잔액 오류'));
    const { result } = renderHook(() => usePartnerAdvanceRecovery(options, f.services));
    await act(async () => { });
    expect(result.current.error).toContain('첫 잔액 오류');
    await act(() => result.current.refreshBalances());
    expect(result.current.refreshFailed).toBe(false);
    expect(result.current.error).toBe('');
    expect(f.services.submit).not.toHaveBeenCalled();
});
