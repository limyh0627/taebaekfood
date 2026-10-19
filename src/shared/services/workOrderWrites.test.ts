/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    auth: {
        currentUser: {
            uid: 'uid', getIdTokenResult: vi.fn()
        }
    }, call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn()
}));
vi.mock('../firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve(), functions: {}
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mocks.call
}));
vi.mock('./firebaseService', () => ({
    subscribeToDocument: mocks.subscribe
}));
import { workOrderWrites, workOrderKey, reportWorkOrderNotice, readWorkOrderNotice, type WorkOrderEntry } from './workOrderWrites';
import { encodeCatalogValue, type WorkOrderRequest } from '../workOrderCommand';
const scope = {
    companyId: 'taebaek' as const, actorUid: 'uid'
}, reference = {
    companyId: 'taebaek' as const, planId: 'plan'
};
const request: WorkOrderRequest = {
    version: 1, reference, action: 'apply', expected: {
        items: [], groups: {
            exists: false, version: null
        }, reset: {
            exists: false, version: null
        }
    }, items: [], groups: ['기름', '깨', '미분류']
};
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser.uid = 'uid';
    mocks.auth.currentUser.getIdTokenResult.mockResolvedValue({
        claims: {
            companyId: 'taebaek', employeeId: 'employee', isAdmin: false
        }
    });
    Object.defineProperty(navigator, 'locks', {
        configurable: true, value: {
            request: (_name: string, _options: unknown, callback: () => unknown) => callback()
        }
    });
});
const result = (entry: WorkOrderEntry, status: 'applied' | 'rejected' | 'cancelled' | 'unknown' = 'applied', hash = entry.requestHash) => ({
    version: 1, reference, actorUid: 'uid', status, requestHash: status === 'cancelled' ? null : hash, message: '확인된 처리 결과'
});
it('기존 그룹 read구독은 회사 주소·UID 수명·해제를 보존한다', async () => {
    let listener!: (value: {
        names: string[];
    }) => void;
    mocks.subscribe.mockImplementation((_collection, _id, callback) => {
        listener = callback;
        return mocks.unsubscribe;
    });
    const observed = vi.fn(), stop = workOrderWrites.subscribeGroups(scope, observed);
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    expect(mocks.subscribe).toHaveBeenCalledWith('settings', 'taebaek__workGroups', expect.any(Function));
    listener({
        names: ['현재 그룹']
    });
    expect(observed).toHaveBeenLastCalledWith(['현재 그룹']);
    mocks.auth.currentUser.uid = 'other';
    listener({
        names: ['다른 UID 결과']
    });
    expect(observed).toHaveBeenCalledTimes(1);
    stop();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    mocks.auth.currentUser.uid = 'uid';
    listener({
        names: ['해제 뒤 결과']
    });
    expect(observed).toHaveBeenCalledTimes(1);
});
it('초기화 미확정 안내는 무관 작업 성공으로 지우지 않고 같은 plan 종결 때만 해제한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    reportWorkOrderNotice(scope, '초기화 미확정', reference);
    const other = await workOrderWrites.prepare(scope, {
        ...request, reference: {
            ...reference, planId: 'other'
        }
    });
    mocks.call.mockResolvedValueOnce({
        data: {
            ...result(other), reference: other.reference
        }
    });
    await workOrderWrites.command(scope, other, 'inspect');
    expect(readWorkOrderNotice(scope)).toBe('초기화 미확정');
    mocks.call.mockResolvedValueOnce({
        data: result(entry)
    });
    await workOrderWrites.command(scope, entry, 'inspect');
    expect(readWorkOrderNotice(scope)).toBe('');
});
it('공개 entry.request가 바뀌어도 송신은 관측 raw에서 검증한 최초 원문만 사용한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    if (entry.request?.action === 'apply')
        entry.request.groups = ['변조된 그룹'];
    mocks.call.mockResolvedValue({
        data: result(entry)
    });
    expect(await workOrderWrites.command(scope, entry, 'apply')).toMatchObject({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    expect(mocks.call.mock.calls[0][0].request.groups).toEqual(['기름', '깨', '미분류']);
});
it('같은 회사 일반 직원의 strict open은 원문 native 버전 집합을 고정한다', async () => {
    mocks.call.mockResolvedValue({
        data: {
            reference, actorUid: 'uid', items: [], groups: {
                exists: true, version: '1:000000000', data: encodeCatalogValue({
                    companyId: 'taebaek', names: ['기름']
                })
            }, reset: {
                exists: false, version: null, data: null
            }
        }
    });
    expect(await workOrderWrites.open(scope, reference)).toMatchObject({
        groups: {
            version: '1:000000000'
        }
    });
    expect(mocks.call).toHaveBeenCalledWith({
        mode: 'open', reference
    });
});
it('최초 원문과 독립 참조를 둘 다 보관·readback한 뒤에만 apply를 전송한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    expect(entry.observedLocalText).toBe(localStorage.getItem(entry.key));
    expect(entry.observedReferenceText).toBe(localStorage.getItem(entry.key + ':reference'));
    mocks.call.mockResolvedValue({
        data: result(entry)
    });
    expect(await workOrderWrites.command(scope, entry, 'apply')).toMatchObject({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        mode: 'apply', request
    });
    expect(await workOrderWrites.read(scope)).toEqual([]);
});
it('같은 plan의 변경 원문을 덮어쓰지 않는다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    await expect(workOrderWrites.prepare(scope, {
        ...request, groups: ['다른 그룹']
    })).rejects.toThrow();
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
    expect(mocks.call).not.toHaveBeenCalled();
});
it('보관 실패는 업무 전송0이고 남은 참조는 복구 목록에 남긴다', async () => {
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (!key.endsWith(':reference'))
            throw Error('보관 실패');
        return set.call(this, key, value);
    });
    await expect(workOrderWrites.prepare(scope, request)).rejects.toThrow('보관 실패');
    vi.restoreAllMocks();
    expect(mocks.call).not.toHaveBeenCalled();
    const [entry] = await workOrderWrites.read(scope);
    expect(entry).toMatchObject({
        status: 'missing', reference
    });
    expect(entry.observedReferenceText).not.toBeNull();
});
it('조회와 중단은 보관 hash를 서버 인자로 보내거나 업무 apply를 호출하지 않는다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockResolvedValue({
        data: result(entry, 'unknown')
    });
    await workOrderWrites.command(scope, entry, 'inspect');
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        mode: 'inspect', reference
    });
    mocks.call.mockClear();
    mocks.call.mockResolvedValue({
        data: result(entry, 'cancelled')
    });
    expect(await workOrderWrites.command(scope, entry, 'cancel')).toMatchObject({
        terminal: true, outcome: {
            status: 'cancelled'
        }
    });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        mode: 'cancel', reference
    });
});
it('실제 다른 hash 성공은 현재 성공 승격·자동 정리0', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockResolvedValue({
        data: result(entry, 'applied', 'b'.repeat(64))
    });
    expect(await workOrderWrites.command(scope, entry, 'inspect')).toMatchObject({
        terminal: false, copyMismatch: true, result: {
            status: 'applied'
        }
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
});
it('손상 본문과 유효 참조는 조회 가능하지만 현재 saved로 처리하지 않는다', async () => {
    const original = await workOrderWrites.prepare(scope, request);
    localStorage.setItem(original.key, '손상');
    const [entry] = await workOrderWrites.read(scope);
    mocks.call.mockResolvedValue({
        data: result(original)
    });
    expect(await workOrderWrites.command(scope, entry, 'inspect')).toMatchObject({
        terminal: false, copyMismatch: true
    });
    expect(mocks.call).toHaveBeenCalledWith({
        mode: 'inspect', reference
    });
    expect(localStorage.getItem(entry.key)).toBe('손상');
});
it('원문 없는 이력 완료는 현재 입력 saved0·없는 정리 요구0', async () => {
    const original = await workOrderWrites.prepare(scope, request);
    localStorage.clear();
    const entry = {
        ...original, request: null, requestHash: null, referenceHash: null, observedLocalText: null, observedReferenceText: null
    };
    mocks.call.mockResolvedValue({
        data: result(original)
    });
    const observed = await workOrderWrites.command(scope, entry, 'inspect');
    expect(observed).toMatchObject({
        terminal: false, outcome: {
            status: 'rejected'
        }
    });
    expect(observed.outcome).toHaveProperty('nextAction', expect.stringContaining('새 업무'));
});
it('표시 후 참조 A→B 교체는 RPC0·B 사본 정리0', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    localStorage.setItem(entry.key + ':reference', 'B');
    expect(await workOrderWrites.discard(scope, entry)).toMatchObject({
        status: 'blocked'
    });
    expect(mocks.call).not.toHaveBeenCalled();
    expect(localStorage.getItem(entry.key + ':reference')).toBe('B');
});
it('서버 조회 await 중 body 또는 sidecar 교체도 CAS 정리0', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockImplementation(async () => {
        localStorage.setItem(entry.key + ':reference', 'B');
        return {
            data: result(entry)
        };
    });
    expect(await workOrderWrites.discard(scope, entry)).toMatchObject({
        status: 'blocked'
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
    expect(localStorage.getItem(entry.key + ':reference')).toBe('B');
});
it('unknown은 명시 사본 정리도 거절하고 서버 중단을 먼저 안내한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockResolvedValue({
        data: result(entry, 'unknown')
    });
    expect(await workOrderWrites.discard(scope, entry)).toMatchObject({
        status: 'blocked', message: expect.stringContaining('먼저 미처리 요청 중단')
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
});
it('다른 hash라도 실제 terminal 재조회 뒤 명시 관측 사본만 정리한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockResolvedValue({
        data: result(entry, 'applied', 'c'.repeat(64))
    });
    expect(await workOrderWrites.discard(scope, entry)).toMatchObject({
        status: 'cleared'
    });
    expect(localStorage.getItem(entry.key)).toBeNull();
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        mode: 'inspect', reference
    });
});
it('UID 교체는 송신전0이고 늦은 ACK도 사본을 지우지 않는다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.auth.currentUser.uid = 'other';
    await workOrderWrites.command(scope, entry, 'apply');
    expect(mocks.call).not.toHaveBeenCalled();
    mocks.auth.currentUser.uid = 'uid';
    mocks.call.mockImplementation(async () => {
        mocks.auth.currentUser.uid = 'other';
        return {
            data: result(entry)
        };
    });
    expect(await workOrderWrites.command(scope, entry, 'apply')).toMatchObject({
        terminal: false, outcome: {
            status: 'unknown'
        }
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
});
it('사본 정리 실패 partial은 실제 업무 완료와 현재 창 종결을 분리한다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    mocks.call.mockResolvedValue({
        data: result(entry)
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw Error('정리 실패');
    });
    expect(await workOrderWrites.command(scope, entry, 'inspect')).toMatchObject({
        terminal: false, outcome: {
            status: 'partial'
        }
    });
    remove.mockRestore();
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
});
it('본인 bounded 이력의 빈 페이지와 cursor를 보존하고 다른 UID 결과는 거절한다', async () => {
    mocks.call.mockResolvedValueOnce({
        data: {
            version: 1, ...scope, entries: [], nextCursor: 'a'.repeat(64)
        }
    });
    expect(await workOrderWrites.history(scope)).toMatchObject({
        entries: [], nextCursor: 'a'.repeat(64)
    });
    mocks.call.mockResolvedValueOnce({
        data: {
            version: 1, ...scope, actorUid: 'other', entries: [], nextCursor: null
        }
    });
    await expect(workOrderWrites.history(scope)).rejects.toThrow();
});
it('다른 회사 key는 보관 원문 확인과 정리 대상이 아니다', async () => {
    const entry = await workOrderWrites.prepare(scope, request);
    const foreign = {
        ...entry, key: workOrderKey({
            ...scope, companyId: 'punghoe'
        }, {
            ...reference, companyId: 'punghoe'
        })
    };
    expect(await workOrderWrites.discard(scope, foreign)).toMatchObject({
        status: 'blocked'
    });
    expect(mocks.call).not.toHaveBeenCalled();
});
