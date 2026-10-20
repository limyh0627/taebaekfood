/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../firebase', () => ({ auth: {}, authReady: Promise.resolve(), functions: {} }));
vi.mock('./firebaseService', () => ({ activeReleaseId: async () => 'release', stripUndefined: (value: unknown) => JSON.parse(JSON.stringify(value)) }));
import { createStatementEditWrites, type StatementEditPort, type StatementEditEntry, type StatementEditFollowupPlan } from './statementEditWrites';
import type { IssuedStatement } from '../types';
const scope = { companyId: 'taebaek' as const, actorUid: 'actor' };
const original = { id: 'statement', companyId: 'taebaek', mutationRevision: 0, docNo: '원번호', tradeDate: '2026-10-01', items: [] } as unknown as IssuedStatement;
const plan: StatementEditFollowupPlan = { upserts: [], openings: [], costUpdates: [{ itemId: 'item', price: 20 }], skipIds: [], isLatest: true };
let port: StatementEditPort;
beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    localStorage.clear();
    port = { storage: localStorage, check: vi.fn(async (_scope, current) => { if (!current())
            throw Error('소유권 변경'); }), exclusive: async (_scope, work) => work(), call: vi.fn(), release: vi.fn(async () => 'release'), id: () => 'operation-123456', now: () => '2026-10-21T00:00:00Z' };
});
function result(entry: StatementEditEntry, status: 'applied' | 'cancelled' | 'unknown' = 'applied') {
    return { version: 1, reference: entry.reference, actorUid: scope.actorUid, status, requestHash: status === 'cancelled' ? null : entry.retained?.requestHash ?? entry.referenceHash, revision: status === 'applied' ? 1 : undefined, message: '결과 확인' };
}
it('첫 날짜 stamp와 원 revision·wire순서·독립참조를 송신 전에 고정한다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { tradeDate: '2026-10-02', memo: '원문' });
    expect(entry.retained?.wire.patch.issuedAt).toBeTruthy();
    expect(entry.retained?.wire.expectedRevision).toBe(0);
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
    expect(localStorage.getItem(entry.key + ':reference')).toBe(entry.observedReferenceText);
    vi.mocked(port.call).mockResolvedValue(result(entry));
    await service.apply(scope, entry);
    expect(port.call).toHaveBeenCalledExactlyOnceWith(entry.retained?.wire);
    const reload = (await service.readPending(scope))[0];
    expect(reload.retained?.wire).toEqual(entry.retained?.wire);
});
it('보관 readback 실패는 실제 RPC를 보내지 않는다', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { });
    try {
        await expect(createStatementEditWrites(port).prepare(scope, original, { memo: 'A' })).rejects.toThrow('보관');
        expect(port.call).not.toHaveBeenCalled();
    }
    finally {
        set.mockRestore();
    }
});
it('원문 객체가 교체되면 apply RPC 전에 거절한다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    entry.retained!.wire.patch.memo = 'B';
    await expect(service.apply(scope, entry)).rejects.toThrow('원문');
    expect(port.call).not.toHaveBeenCalled();
});
it('손상 본문도 독립 참조만으로 조회·중단하고 apply로 바꾸지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    localStorage.setItem(entry.key, '{');
    const broken = (await service.readPending(scope))[0];
    expect(broken.retained).toBeNull();
    expect(broken.reference).toEqual(entry.reference);
    vi.mocked(port.call).mockResolvedValue(result(entry, 'unknown'));
    await service.inspect(scope, broken);
    expect(port.call).toHaveBeenLastCalledWith({ mode: 'inspect', reference: entry.reference });
    vi.mocked(port.call).mockResolvedValue(result(entry, 'cancelled'));
    await service.cancel(scope, broken);
    expect(port.call).toHaveBeenLastCalledWith({ mode: 'cancel', reference: entry.reference });
});
it('본문·참조 둘 중 하나가 바뀌면 정리하지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    vi.mocked(port.call).mockImplementation(async () => { localStorage.setItem(entry.key + ':reference', '교체 사본'); return result(entry); });
    await expect(service.discardObserved(scope, entry)).rejects.toThrow('확정');
    expect(JSON.parse(localStorage.getItem(entry.key)!).wire).toEqual(entry.retained?.wire);
    expect(localStorage.getItem(entry.key + ':reference')).toBe('교체 사본');
});
it('본문만 없어지고 참조가 남은 ACK를 정리 완료로 승격하지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    vi.mocked(port.call).mockImplementation(async () => { localStorage.removeItem(entry.key); return result(entry); });
    const observation = await service.apply(scope, entry);
    expect(observation.copyMismatch).toBe(true);
    expect(observation.terminal).toBe(false);
    expect(localStorage.getItem(entry.key + ':reference')).toBe(entry.observedReferenceText);
});
it('body ACK와 후속 running/완료는 별도 영속하고 최초 계획 밖 진행은 거절한다', async () => {
    const service = createStatementEditWrites(port);
    let entry = await service.prepare(scope, original, { memo: 'A' }, plan);
    await expect(service.markFollowup(scope, entry, { stage: 'cost', index: 0, status: 'running' })).rejects.toThrow('결과');
    entry = await service.markFollowup(scope, entry, 'body-ack');
    await expect(service.markFollowup(scope, entry, { stage: 'cost', index: 0, status: 'acknowledged' })).rejects.toThrow('시작');
    entry = await service.markFollowup(scope, entry, { stage: 'cost', index: 0, status: 'running' });
    entry = await service.markFollowup(scope, entry, { stage: 'cost', index: 0, status: 'acknowledged' });
    expect((await service.readPending(scope))[0].retained?.progress).toEqual(entry.retained?.progress);
    expect(port.call).not.toHaveBeenCalled();
});
it('후속 마커 저장 실패를 성공으로 넘기지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, {}, plan);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { });
    try {
        await expect(service.markFollowup(scope, entry, 'body-ack')).rejects.toThrow('보관');
    }
    finally {
        set.mockRestore();
    }
});
it('다른 UID·회사 응답은 성공으로 소비하지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    vi.mocked(port.call).mockResolvedValue({ ...result(entry), actorUid: 'other' });
    await expect(service.inspect(scope, entry)).rejects.toThrow();
});
it('원문 없는 이력은 조회해도 현재 초안의 저장 완료로 승격하지 않는다', async () => {
    const service = createStatementEditWrites(port), local = await service.prepare(scope, original, { memo: 'A' });
    localStorage.clear();
    const entry = { ...local, retained: null, observedLocalText: null, observedReferenceText: null };
    vi.mocked(port.call).mockResolvedValue(result(local));
    const observation = await service.inspect(scope, entry);
    expect(observation.terminal).toBe(false);
    expect(observation.result.status).toBe('applied');
});
it('양사본 식별 불가 정보는 서버 취소 주장 없이 현재 관측값만 정리한다', async () => {
    const service = createStatementEditWrites(port), local = await service.prepare(scope, original, {});
    localStorage.setItem(local.key, '{');
    localStorage.setItem(local.key + ':reference', '{');
    const entry = (await service.readPending(scope))[0];
    expect(entry.reference).toBeNull();
    const result = await service.discardObserved(scope, entry);
    expect(result).toMatchObject({ localOnly: true, terminal: false });
    expect(result.message).toContain('서버 요청을 중단한 것은 아닙니다');
    expect(port.call).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
});
it('식별 불가 사본도 참조가 바뀌면 삭제하지 않는다', async () => {
    const service = createStatementEditWrites(port), local = await service.prepare(scope, original, {});
    localStorage.setItem(local.key, '{');
    localStorage.setItem(local.key + ':reference', '{');
    const entry = (await service.readPending(scope))[0];
    localStorage.setItem(local.key + ':reference', '새 사본');
    await expect(service.discardObserved(scope, entry)).rejects.toThrow('바뀌었습니다');
    expect(localStorage.getItem(local.key + ':reference')).toBe('새 사본');
    expect(port.call).not.toHaveBeenCalled();
});
it('동일 최초 원문이 남아 있으면 새 operation으로 중복 준비하지 않는다', async () => {
    let next = 0;
    port.id = () => `operation-${++next}`;
    const service = createStatementEditWrites(port);
    await service.prepare(scope, original, { memo: 'A' });
    await expect(service.prepare(scope, original, { memo: 'A' })).rejects.toThrow('같은 내용');
    expect(await service.readPending(scope)).toHaveLength(1);
    await service.prepare(scope, original, { memo: '다른 새 초안' });
    expect(await service.readPending(scope)).toHaveLength(2);
});
it('apply 직전 소유권 변경은 RPC0이며 최초 원문을 유지한다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    await expect(service.apply(scope, entry, () => false)).rejects.toThrow('소유권');
    expect(port.call).not.toHaveBeenCalled();
    expect(localStorage.getItem(entry.key)).toBe(entry.observedLocalText);
});
it('응답 유실 원인과 송신 단계를 reload 뒤에도 보존한다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    vi.mocked(port.call).mockRejectedValue(Error('연결이 끊겼습니다'));
    await expect(service.apply(scope, entry)).rejects.toThrow('연결');
    const reload = (await service.readPending(scope))[0];
    expect(reload.retained?.lastError).toBe('연결이 끊겼습니다');
    expect(reload.retained?.lastAttempt).toMatchObject({ mode: 'apply', phase: 'error' });
    expect(reload.retained?.wire).toEqual(entry.retained?.wire);
    expect(reload.retained?.requestHash).toBe(entry.retained?.requestHash);
});
it('원문 해시가 다른 과거 완료는 새 수정 성공이 아니지만 확인한 손상 사본만 정리할 수 있다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    vi.mocked(port.call).mockResolvedValue({ ...result(entry), requestHash: 'b'.repeat(64) });
    const observed = await service.inspect(scope, entry);
    expect(observed.copyMismatch).toBe(true);
    expect(observed.terminal).toBe(true);
    await service.discardObserved(scope, observed.entry);
    expect(localStorage.length).toBe(0);
});
it('정상 본문과 다른 해시의 독립참조는 재전송0이며 참조 조회·중단만 허용한다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    localStorage.setItem(entry.key + ':reference', JSON.stringify({ version: 1, reference: entry.reference, requestHash: 'b'.repeat(64) }));
    const conflict = (await service.readPending(scope))[0];
    expect(conflict.retained).toBeNull();
    await expect(service.apply(scope, conflict)).rejects.toThrow('최초 원문'); expect(port.call).not.toHaveBeenCalled();
    vi.mocked(port.call).mockResolvedValue(result(entry, 'unknown')); await service.inspect(scope, conflict); expect(port.call).toHaveBeenLastCalledWith({ mode: 'inspect', reference: entry.reference });
    vi.mocked(port.call).mockResolvedValue(result(entry, 'cancelled')); await service.cancel(scope, conflict); expect(port.call).toHaveBeenLastCalledWith({ mode: 'cancel', reference: entry.reference });
});
it('공개 entry 객체에 정상 본문을 다시 넣어도 관측 참조 해시가 다르면 RPC0이다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    localStorage.setItem(entry.key + ':reference', JSON.stringify({ version: 1, reference: entry.reference, requestHash: 'b'.repeat(64) }));
    const conflict = (await service.readPending(scope))[0]; conflict.retained = entry.retained;
    await expect(service.apply(scope, conflict)).rejects.toThrow('해시가 다릅니다'); expect(port.call).not.toHaveBeenCalled();
});
it('비협력 사본 교체가 메타 readback 직후 발생해도 새 쌍을 채택하여 송신하지 않는다', async () => {
    const service = createStatementEditWrites(port), entry = await service.prepare(scope, original, { memo: 'A' });
    const replacement = structuredClone(entry.retained!); replacement.wire.patch.memo = 'B'; replacement.inputPatch.memo = 'B';
    replacement.requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ statementId: replacement.wire.statementId, expectedRevision: replacement.wire.expectedRevision, patch: replacement.wire.patch })))), value => value.toString(16).padStart(2, '0')).join('');
    const bodyB = JSON.stringify(replacement), refB = JSON.stringify({ version: 1, reference: entry.reference, requestHash: replacement.requestHash });
    const read = Storage.prototype.getItem; let replaced = false;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        const value = read.call(this, key);
        if (!replaced && key === entry.key && value?.includes('"lastAttempt":{"mode":"apply","phase":"sending"')) {
            replaced = true; localStorage.setItem(entry.key, bodyB); localStorage.setItem(entry.key + ':reference', refB);
        }
        return value;
    });
    vi.mocked(port.call).mockResolvedValue({ ...result(entry), requestHash: replacement.requestHash });
    try {
        await expect(service.apply(scope, entry)).rejects.toThrow('바뀌었습니다'); expect(replaced).toBe(true); expect(port.call).not.toHaveBeenCalled();
        expect(localStorage.getItem(entry.key)).toBe(bodyB); expect(localStorage.getItem(entry.key + ':reference')).toBe(refB);
    } finally { spy.mockRestore(); }
});
