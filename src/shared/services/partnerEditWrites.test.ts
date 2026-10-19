/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'uid', getIdTokenResult: vi.fn() } }, call: vi.fn() }));
vi.mock('../firebase', () => ({ auth: mocks.auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }));
import { partnerEditWrites as writes, partnerEditKey, type PartnerEditEntry } from './partnerEditWrites';
import { partnerEditOpening, serializePartnerEditRequest, type PartnerEditRequest } from '../partnerEditCommand';
const scope = { companyId: 'taebaek' as const, actorUid: 'uid' };
const reference = { companyId: 'taebaek' as const, planId: 'plan', targetId: 'pr-target' };
const request: PartnerEditRequest = { version: 1, reference, expectedVersion: '1:000000000', patch: { note: '최초 비고' } };
const result = (entry: PartnerEditEntry, status: 'applied' | 'rejected' | 'cancelled' | 'unknown' = 'applied', hash = entry.requestHash) => ({ version: 1, reference: entry.reference, actorUid: 'uid', status, requestHash: status === 'cancelled' ? null : hash, message: '확인된 서버 처리 결과' });
const entry = () => writes.prepare(scope, structuredClone(request));
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser.uid = 'uid';
    mocks.auth.currentUser.getIdTokenResult.mockResolvedValue({ claims: { companyId: 'taebaek', employeeId: 'employee', isAdmin: false } });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, callback: () => unknown) => callback() } });
});
afterEach(() => vi.restoreAllMocks());
it('거래처 수정은 실제 Promise ACK를 기다리고 호출 전 원본을 고정한다', async () => {
    const row = await entry();
    let finish!: (value: unknown) => void;
    mocks.call.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const done = vi.fn(), task = writes.command(scope, row, 'apply').then(done);
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalled());
    expect(done).not.toHaveBeenCalled();
    finish({ data: result(row) });
    await task;
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, outcome: { status: 'saved' } }));
    expect(localStorage.getItem(row.key)).toBeNull();
    expect(localStorage.getItem(row.key + ':reference')).toBeNull();
});
it('공개 request가 바뀌어도 최초 관측 원문만 송신한다', async () => {
    const row = await entry();
    if (row.request)
        row.request.patch.note = '변경';
    mocks.call.mockResolvedValue({ data: result(row) });
    await writes.command(scope, row, 'apply');
    expect(mocks.call.mock.calls[0][0].request.patch.note).toBe('최초 비고');
});
it('거절 오류는 원인과 결과 미확정을 보존하고 같은 ID를 자동 재송신하지 않는다', async () => {
    const row = await entry();
    mocks.call.mockRejectedValue(Error('응답 유실'));
    expect(await writes.command(scope, row, 'apply')).toMatchObject({ terminal: false, outcome: { status: 'unknown', message: '응답 유실' } });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('미연결·사전 scope 교체는 쓰기 전 중단하고 void 반환은 성공 ACK가 아니다', async () => {
    const row = await entry();
    expect(await writes.command(scope, row, 'apply', () => false)).toMatchObject({ terminal: false, outcome: { status: 'rejected' } });
    expect(mocks.call).not.toHaveBeenCalled();
    mocks.call.mockResolvedValue({ data: undefined });
    expect(await writes.command(scope, row, 'apply')).toMatchObject({ terminal: false, outcome: { status: 'unknown' } });
});
it('원문과 독립참조 두 보관 readback이 실패하면 전송하지 않는다', async () => {
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (!key.endsWith(':reference'))
            throw Error('보관 실패');
        return set.call(this, key, value);
    });
    await expect(entry()).rejects.toThrow('보관 실패');
    expect(mocks.call).not.toHaveBeenCalled();
});
it('결과 확인은 reference-only이며 거래처 수정 apply를 재전송하지 않는다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: result(row) });
    await writes.command(scope, row, 'inspect');
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({ mode: 'inspect', reference });
});
it('손상본문은 유효한 독립 key로 실제결과 확인과 미처리중단을 허용한다', async () => {
    const row = await entry();
    localStorage.setItem(row.key, '{손상');
    const [damaged] = await writes.read(scope);
    expect(damaged.reference).toEqual(reference);
    expect(damaged.status).toBe('corrupt');
    mocks.call.mockResolvedValue({ data: result(row) });
    const found = await writes.command(scope, damaged, 'inspect');
    expect(found).toMatchObject({ copyMismatch: true, terminal: false });
    expect(localStorage.getItem(row.key)).toBe('{손상');
    mocks.call.mockResolvedValue({ data: result(row, 'cancelled') });
    await writes.command(scope, damaged, 'cancel');
    expect(mocks.call).toHaveBeenLastCalledWith({ mode: 'cancel', reference });
});
it('다른 유효 사본 hash는 현재 saved나 자동정리로 승격하지 않는다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: result(row, 'applied', 'b'.repeat(64)) });
    expect(await writes.command(scope, row, 'inspect')).toMatchObject({ terminal: false, copyMismatch: true, outcome: { status: 'rejected' } });
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('원문없는 과거 이력 조회는 새초안 저장완료가 아니며 없는 정리를 요구하지 않는다', async () => {
    const row: PartnerEditEntry = { key: partnerEditKey(scope, reference), reference, request: null, requestHash: null, referenceHash: null, observedLocalText: null, observedReferenceText: null, status: 'missing', description: '과거 기록' };
    mocks.call.mockResolvedValue({ data: result(row, 'applied', 'a'.repeat(64)) });
    const found = await writes.command(scope, row, 'inspect');
    expect(found).toMatchObject({ terminal: false, copyMismatch: true, outcome: { status: 'rejected' } });
    expect('nextAction' in found.outcome && found.outcome.nextAction).not.toContain('사본만');
});
it('opaque cancel null hash는 실제중단으로 소비하고 동일관측사본을 정리한다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: result(row, 'cancelled') });
    expect(await writes.command(scope, row, 'cancel')).toMatchObject({ terminal: true, outcome: { status: 'cancelled' } });
    expect(localStorage.getItem(row.key)).toBeNull();
});
it('unknown 조회는 미반영 단정이나 사본삭제가 아니고 명시정리는 거절한다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: result(row, 'unknown', null) });
    expect(await writes.command(scope, row, 'inspect')).toMatchObject({ terminal: false, outcome: { status: 'unknown' } });
    expect(await writes.discard(scope, row)).toMatchObject({ status: 'blocked' });
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('서버완료 뒤 기기사본정리 실패는 partial이며 완료창닫기 ACK가 아니다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: result(row) });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw Error('정리 실패');
    });
    expect(await writes.command(scope, row, 'inspect')).toMatchObject({ terminal: false, outcome: { status: 'partial', nextAction: expect.stringContaining('다시 보내지') } });
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('ACK 대기중 body만 사라지고 참조가 남으면 완료로 승격하지 않는다', async () => {
    const row = await entry();
    mocks.call.mockImplementation(async () => {
        localStorage.removeItem(row.key);
        return { data: result(row) };
    });
    expect(await writes.command(scope, row, 'apply')).toMatchObject({ terminal: false, outcome: { status: 'partial' } });
    expect(localStorage.getItem(row.key + ':reference')).toBe(row.observedReferenceText);
});
it('기기사본정리는 실제terminal 재조회 뒤 최초관측 body와sidecar 양CAS만 삭제한다', async () => {
    const row = await entry();
    mocks.call.mockImplementation(async () => {
        localStorage.setItem(row.key + ':reference', '교체');
        return { data: result(row) };
    });
    expect(await writes.discard(scope, row)).toMatchObject({ status: 'blocked' });
    expect(localStorage.getItem(row.key + ':reference')).toBe('교체');
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('sidecar-only 원관측이 바뀌면 RPC전부터 정리하지 않는다', async () => {
    const row = await entry();
    localStorage.removeItem(row.key);
    const [sidecar] = await writes.read(scope);
    localStorage.setItem(row.key + ':reference', '다른 사본');
    expect(await writes.discard(scope, sidecar)).toMatchObject({ status: 'blocked' });
    expect(mocks.call).not.toHaveBeenCalled();
});
it('완전식별불가 사본은 fake RPC 없이 명시한 이기기사본만 정리한다', async () => {
    const key = 'partner-edit-v1:taebaek:uid:식별불가';
    localStorage.setItem(key, '{손상');
    localStorage.setItem(key + ':reference', '참조손상');
    const [row] = await writes.read(scope);
    expect(row.reference).toBeNull();
    expect(await writes.discard(scope, row)).toMatchObject({ status: 'cleared', message: expect.stringContaining('서버 요청을 중단한 것은 아닙니다') });
    expect(mocks.call).not.toHaveBeenCalled();
});
it('해시 await 중 교체된 body는 송신 전에 차단한다', async () => {
    const row = await entry();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
        const hash = await digest(...args);
        localStorage.setItem(row.key, '교체원문');
        return hash;
    });
    expect(await writes.command(scope, row, 'apply')).toMatchObject({ terminal: false, outcome: { status: 'rejected' } });
    expect(mocks.call).not.toHaveBeenCalled();
});
it('거래처 수정의 늦은 ACK는 실제 응답 근거만 남기고 새 화면 성공으로 승격하지 않는다', async () => {
    const row = await writes.prepare(scope, structuredClone(request));
    mocks.call.mockImplementation(async () => {
        mocks.auth.currentUser.uid = 'other';
        return { data: result(row) };
    });
    expect(await writes.command(scope, row, 'apply')).toMatchObject({ terminal: false, outcome: { status: 'unknown' } });
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('다른 회사UIDtargetplan 응답은 실제성공으로 소비하지 않는다', async () => {
    const row = await entry();
    mocks.call.mockResolvedValue({ data: { ...result(row), reference: { ...reference, targetId: 'other' } } });
    expect(await writes.command(scope, row, 'inspect')).toMatchObject({ terminal: false, outcome: { status: 'unknown' } });
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('선택원문 open 응답을 최신다른본문 native로 재포장하지 않는다', async () => {
    const opening = partnerEditOpening({ id: reference.targetId, name: '최초' });
    mocks.call.mockResolvedValue({ data: { reference, actorUid: 'uid', opening: partnerEditOpening({ name: '다른' }), expectedVersion: '1:000000000' } });
    await expect(writes.open(scope, reference, opening)).rejects.toThrow('최초 거래처');
});
it('명시이력은 ownscope 빈페이지 cursor를 유지하고 다른scope 응답을 거절한다', async () => {
    const cursor = 'a'.repeat(64);
    mocks.call.mockResolvedValueOnce({ data: { version: 1, ...scope, entries: [], nextCursor: cursor } });
    expect(await writes.history(scope)).toMatchObject({ entries: [], nextCursor: cursor });
    expect(mocks.call).toHaveBeenLastCalledWith({ mode: 'listHistory', companyId: 'taebaek' });
    mocks.call.mockResolvedValueOnce({ data: { version: 1, ...scope, actorUid: 'other', entries: [], nextCursor: null } });
    await expect(writes.history(scope, cursor)).rejects.toThrow();
});
it('손상본문이라도 같은 target의 다른 plan 준비는 scope WebLock 안에서 차단한다', async () => {
    const row = await entry();
    localStorage.setItem(row.key, '{손상');
    await expect(writes.prepare(scope, { ...request, reference: { ...reference, planId: 'new-plan' } })).rejects.toThrow('이전 보관 요청');
    expect(localStorage.getItem(row.key)).toBe('{손상');
    expect(mocks.call).not.toHaveBeenCalled();
    const unrelated = await writes.prepare(scope, { ...request, reference: { ...reference, planId: 'other-plan', targetId: 'other-target' } });
    expect(unrelated.status).toBe('valid');
});
it('같은 key의 최초 원문은 재관측 허용하고 다른 body는 덮지 않는다', async () => {
    const row = await entry();
    expect(await entry()).toMatchObject({ observedLocalText: row.observedLocalText });
    await expect(writes.prepare(scope, { ...request, patch: { note: '다른' } })).rejects.toThrow('최초 원문이 다릅니다');
    expect(localStorage.getItem(row.key)).toBe(serializePartnerEditRequest(request));
});
it('영문 전송오류는 한국어 원인안내를 보태되 unknown상태와 원본증거를 유지한다', async () => {
    const row = await entry();
    mocks.call.mockRejectedValue(Object.assign(Error('unavailable'), { code: 'functions/unavailable' }));
    const found = await writes.command(scope, row, 'apply');
    expect(found).toMatchObject({ terminal: false, outcome: { status: 'unknown', message: expect.stringContaining('서버 연결이나 응답') } });
    expect('message' in found.outcome && found.outcome.message).toContain('unavailable');
    expect(localStorage.getItem(row.key)).toBe(row.observedLocalText);
});
it('최초 표시 이름은 업무 hash와 분리해 reload하며 메타교체도 CAS로 지키며 길이를 검사한다', async () => {
    const row = await writes.prepare(scope, structuredClone(request), () => true, '처음상호');
    expect(row.observedLocalText).toBe(serializePartnerEditRequest(request));
    expect((await writes.read(scope))[0].description).toBe('거래처 수정 · 처음상호');
    localStorage.setItem(row.key + ':reference', row.observedReferenceText!.replace('처음상호', '새사본상호'));
    expect(await writes.discard(scope, row)).toMatchObject({ status: 'blocked' });
    expect(mocks.call).not.toHaveBeenCalled();
    await expect(writes.prepare(scope, { ...request, reference: { ...reference, planId: 'other', targetId: 'other' } }, () => true, '가'.repeat(501))).rejects.toThrow('표시 이름');
});
