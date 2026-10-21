/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor', getIdTokenResult: vi.fn() } }, call: vi.fn() }));
vi.mock('../firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
import writes from './palletTransactionWrites';
import type { PalletTransactionRequest, PalletTransactionResult } from '../palletTransactionCommand';
const scope = { companyId: 'taebaek' as const, actorUid: 'actor' };
const current = () => true;
const request = (operationId = 'op'): PalletTransactionRequest => ({ version: 1, reference: { companyId: 'taebaek', operationId, transactionId: 'tx-' + operationId }, transaction: { partnerId: 'partner', palletId: 'pallet', type: 'out', quantity: 3, date: '2026-10-21', note: '원문' + operationId } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    localStorage.clear();
    vi.clearAllMocks();
    m.auth.currentUser.uid = 'actor';
    m.auth.currentUser.getIdTokenResult.mockResolvedValue({ claims: { companyId: 'taebaek', employeeId: 'employee' } });
});
async function seed(op = 'op') { return writes.prepare(scope, request(op), current); }
function result(entry: Awaited<ReturnType<typeof seed>>, status: PalletTransactionResult['status'] = 'applied') {
    return { version: 1, reference: entry.reference!, actorUid: 'actor', status, requestHash: status === 'applied' ? entry.requestHash : null, message: '결과' };
}
it('보관과 readonly 준비는 거래를 쓰지 않고 전체 원문과 독립 참조를 남긴다', async () => {
    const entry = await seed();
    expect(entry.status).toBe('valid');
    expect(entry.bodyRaw).toContain('원문');
    expect(entry.referenceRaw).toContain('bodyDigest');
    expect(m.call).not.toHaveBeenCalled();
    m.call.mockResolvedValueOnce({ data: { reference: request().reference, actorUid: 'actor', palletId: 'pallet', originalTotal: 10, expectedVersion: '1:000000000' } });
    const opened = await writes.open(scope, request().reference, 'pallet', 10, current);
    expect(opened.expectedVersion).toBe('1:000000000');
    expect(m.call.mock.calls[0][0].mode).toBe('open');
});
it('응답 유실 후 reload 원인과 최신 자기 관측을 유지하고 같은 요청만 재전송한다', async () => {
    let entry = await seed();
    const original = entry.request;
    const own = vi.fn(next => { entry = next; });
    m.call.mockRejectedValueOnce(Error('응답 유실'));
    await expect(writes.command(scope, entry, 'apply', current, undefined, own)).rejects.toThrow('응답 유실');
    expect(own).toHaveBeenCalledOnce();
    const [reloaded] = await writes.read(scope);
    expect(reloaded.lastAttempt?.message).toBe('응답 유실');
    m.call.mockResolvedValueOnce({ data: result(reloaded) });
    await writes.command(scope, reloaded, 'apply', current);
    expect(m.call.mock.calls[1][0].request).toEqual(original);
    expect(localStorage.getItem(entry.key)).not.toBeNull();
});
it('apply 원문 해시가 다르면 완료로 승격하거나 정리하지 않는다', async () => {
    const entry = await seed();
    m.call.mockResolvedValueOnce({ data: { ...result(entry), requestHash: 'f'.repeat(64) } });
    await expect(writes.command(scope, entry, 'apply', current)).rejects.toThrow('원문');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
});
it('본문과 같은 ref라도 digest가 다르면 재시도 RPC를 보내지 않는다', async () => {
    const entry = await seed();
    const side = JSON.parse(entry.referenceRaw!);
    side.bodyDigest = '0'.repeat(64);
    localStorage.setItem(entry.key + ':reference', JSON.stringify(side));
    const [broken] = await writes.read(scope);
    expect(writes.projection(broken).canRetry).toBe(false);
    await expect(writes.command(scope, broken, 'apply', current)).rejects.toThrow('일치');
    expect(m.call).not.toHaveBeenCalled();
});
it('권한 await 중 다른 쌍으로 교체되면 새 쌍을 채택해 보내지 않는다', async () => {
    const entry = await seed();
    m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async () => { localStorage.setItem(entry.key, '다른 원문'); return { claims: { companyId: 'taebaek', employeeId: 'employee' } }; });
    await expect(writes.command(scope, entry, 'apply', current)).rejects.toThrow('바뀌');
    expect(m.call).not.toHaveBeenCalled();
});
it('동일 tick 두 요청은 하나만 송신하고 나머지를 큐에 넣지 않는다', async () => {
    const entry = await seed();
    const wait = deferred<{
        data: unknown;
    }>();
    m.call.mockReturnValueOnce(wait.promise);
    const first = writes.command(scope, entry, 'apply', current);
    const second = writes.command(scope, entry, 'apply', current);
    await expect(second).rejects.toThrow('처리 중');
    await vi.waitFor(() => expect(m.call).toHaveBeenCalledOnce());
    wait.resolve({ data: result(entry) });
    await first;
});
it('UID 또는 owner 변경 뒤 응답은 성공이나 자기 관측 콜백으로 전달하지 않는다', async () => {
    const entry = await seed();
    const wait = deferred<{
        data: unknown;
    }>();
    m.call.mockReturnValueOnce(wait.promise);
    let active = true;
    const own = vi.fn();
    const task = writes.command(scope, entry, 'apply', () => active, undefined, own);
    await vi.waitFor(() => expect(m.call).toHaveBeenCalledOnce());
    active = false;
    wait.resolve({ data: result(entry) });
    await expect(task).rejects.toThrow('바뀌');
    expect(own).not.toHaveBeenCalled();
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
});
it('손상 본문의 유효 ref는 조회·중단 가능하나 재송신은 하지 않는다', async () => {
    const entry = await seed();
    localStorage.setItem(entry.key, '손상');
    const [broken] = await writes.read(scope);
    m.call.mockResolvedValueOnce({ data: result(entry, 'unknown') });
    await writes.command(scope, broken, 'inspect', current);
    expect(m.call.mock.calls[0][0]).toEqual({ mode: 'inspect', reference: entry.reference });
    m.call.mockResolvedValueOnce({ data: result(entry, 'cancelled') });
    await writes.command(scope, broken, 'cancel', current);
    expect(writes.projection(broken).canRetry).toBe(false);
});
it('충돌 두 ref 중 하나가 unknown이면 정리하지 않고 둘 다 terminal일 때만 양사본을 정리한다', async () => {
    const a = await seed('a'), b = await seed('b');
    localStorage.setItem(a.key + ':reference', b.referenceRaw!);
    const entry = (await writes.read(scope)).find(row => row.key === a.key)!;
    expect(entry.references).toHaveLength(2);
    m.call.mockResolvedValueOnce({ data: result(a) }).mockResolvedValueOnce({ data: result(b, 'unknown') });
    await expect(writes.discard(scope, entry, current)).rejects.toThrow('아직');
    expect(localStorage.getItem(a.key)).toBe(a.bodyRaw);
    m.call.mockResolvedValueOnce({ data: result(a) }).mockResolvedValueOnce({ data: result(b, 'cancelled') });
    const own = vi.fn();
    await writes.discard(scope, entry, current, own);
    expect(own).toHaveBeenCalledWith(null);
    expect(localStorage.getItem(a.key)).toBeNull();
    expect(localStorage.getItem(b.key)).toBe(b.bodyRaw);
});
it('양손상 식별불가는 RPC 없이 관측 기기 사본만 정리한다', async () => {
    const entry = await seed();
    localStorage.setItem(entry.key, '{');
    localStorage.setItem(entry.key + ':reference', '{');
    const [broken] = await writes.read(scope);
    expect(writes.projection(broken).nextAction).toContain('서버 요청 취소는 아닙니다');
    await writes.discard(scope, broken, current);
    expect(m.call).not.toHaveBeenCalled();
});
it('정리 조회 중 sidecar 교체를 보존한다', async () => {
    const entry = await seed();
    m.call.mockImplementationOnce(async () => { localStorage.setItem(entry.key + ':reference', '새 참조'); return { data: result(entry) }; });
    await expect(writes.discard(scope, entry, current)).rejects.toThrow('바뀌');
    expect(localStorage.getItem(entry.key + ':reference')).toBe('새 참조');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
});
it('새 op 번호라도 같은 업무 입력의 보관 요청을 새로 송신하지 않는다', async () => {
    const entry = await seed();
    const next = request('new');
    next.transaction = request().transaction;
    expect(writes.findMatching(await writes.read(scope), next.transaction)?.key).toBe(entry.key);
    await expect(writes.prepare(scope, next, current)).rejects.toThrow('같은 내용');
    expect(m.call).not.toHaveBeenCalled();
});
it('본문만 남은 유효 원문은 명시 참조 복원만 하고 자동 송신하지 않는다', async () => {
    const entry = await seed();
    localStorage.removeItem(entry.key + ':reference');
    const [legacy] = await writes.read(scope);
    expect(writes.projection(legacy).canUpgradeReference).toBe(true);
    const own = vi.fn();
    const next = await writes.upgrade(scope, legacy, current, own);
    expect(next.status).toBe('valid');
    expect(next.bodyRaw).toBe(entry.bodyRaw);
    expect(own).toHaveBeenCalledWith(next);
    expect(m.call).not.toHaveBeenCalled();
});
it('이번 무쓰기 거절은 미래 중단 증거가 아니며 reload 뒤 원인을 유지한다', async () => {
    const entry = await seed();
    m.call.mockRejectedValueOnce(Object.assign(Error('원본 재고가 바뀌었습니다'), { details: { version: 1, operationStatus: 'rejected', writes: false, reference: entry.reference } }));
    await expect(writes.command(scope, entry, 'apply', current)).rejects.toThrow('원본 재고');
    const [next] = await writes.read(scope);
    expect(next.lastAttempt?.outcome).toBe('server-rejected');
    expect(writes.projection(next).isUnresolved).toBe(true);
    expect(writes.projection(next).canDiscard).toBe(false);
});
it('이미 중단된 요청의 typed 거절은 terminal만 확인하며 보관 사본을 자동 정리하지 않는다', async () => {
    const entry = await seed();
    m.call.mockRejectedValueOnce(Object.assign(Error('중단됨'), { details: { palletTransactionRecovery: result(entry, 'cancelled') } }));
    const observed = await writes.command(scope, entry, 'apply', current);
    expect(observed.terminal).toBe(true);
    expect(writes.projection(entry, observed.result).isUnresolved).toBe(false);
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
});
it('transfer open 응답은 선택 원재고와 실사용자까지 같아야 하고 준비만으로 보관하지 않는다', async () => {
    m.call.mockResolvedValueOnce({ data: { reference: request().reference, actorUid: 'actor', palletId: 'pallet', originalTotal: 11, expectedVersion: '1:000000000' } });
    await expect(writes.open(scope, request().reference, 'pallet', 10, current)).rejects.toThrow('원문');
    expect(localStorage.length).toBe(0);
});
it('transfer 재시도는 처음의 total/version/op를 고정하고 open을 다시 부르지 않는다', async () => {
    const input = request();
    input.transaction.isTransfer = true;
    input.transfer = { originalTotal: 20, expectedVersion: '1:000000000' };
    let entry = await writes.prepare(scope, input, current);
    m.call.mockRejectedValueOnce(Error('응답 유실'));
    await expect(writes.command(scope, entry, 'apply', current, undefined, next => { entry = next!; })).rejects.toThrow();
    m.call.mockResolvedValueOnce({ data: result(entry) });
    await writes.command(scope, entry, 'apply', current);
    expect(m.call.mock.calls.map(call => call[0])).toEqual([{ mode: 'apply', request: input }, { mode: 'apply', request: input }]);
});
it('동일 body와 ref를 가진 자기메타 readback 중 교체 사본을 새 관측으로 승격하지 않는다', async () => {
    const entry = await seed();
    const own = vi.fn();
    m.call.mockRejectedValueOnce(Error('응답 유실'));
    const original = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, 'setItem');
    set.mockImplementation(function (this: Storage, key, value) {
        original.call(this, key, value);
        if (key === entry.key + ':reference')
            original.call(this, key, '외부 참조');
    });
    try {
        await expect(writes.command(scope, entry, 'apply', current, undefined, own)).rejects.toThrow('바뀌');
        expect(own).not.toHaveBeenCalled();
        expect(localStorage.getItem(entry.key + ':reference')).toBe('외부 참조');
    }
    finally {
        set.mockRestore();
    }
});
it('조회는 과거 ref 결과이며 현재 다른 본문의 저장 성공으로 승격하지 않고 사본 정리는 허용한다', async () => {
    const entry = await seed();
    const past = { ...result(entry), requestHash: 'a'.repeat(64) };
    m.call.mockResolvedValueOnce({ data: past });
    const observed = await writes.command(scope, entry, 'inspect', current);
    expect(observed.result).toEqual(past);
    expect(observed.terminal).toBe(true);
    expect(writes.projection(entry, observed.result).referenceRows[0].cause).toContain('현재 입력이 저장됐다는 뜻은 아닙니다');
    m.call.mockResolvedValueOnce({ data: past });
    expect((await writes.command(scope, entry, 'cancel', current)).terminal).toBe(true);
    m.call.mockResolvedValueOnce({ data: past });
    await writes.discard(scope, entry, current);
    expect(localStorage.getItem(entry.key)).toBeNull();
    expect(m.call.mock.calls.map(call => call[0].mode)).toEqual(['inspect', 'cancel', 'inspect']);
});
it('지원하지 않는 wrapper version은 본문을 보존하고 ref 조회만 허용한다', async () => {
    const entry = await seed();
    const body = JSON.parse(entry.bodyRaw!);
    body.version = 2;
    const bodyRaw = JSON.stringify(body);
    const side = JSON.parse(entry.referenceRaw!);
    side.bodyDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyRaw))), n => n.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(entry.key, bodyRaw);
    localStorage.setItem(entry.key + ':reference', JSON.stringify(side));
    const [broken] = await writes.read(scope);
    expect(broken.status).toBe('corrupt');
    await expect(writes.command(scope, broken, 'apply', current)).rejects.toThrow('일치');
    expect(m.call).not.toHaveBeenCalled();
    m.call.mockResolvedValueOnce({ data: result(entry, 'unknown') });
    await writes.command(scope, broken, 'inspect', current);
    expect(m.call.mock.calls[0][0].mode).toBe('inspect');
    expect(localStorage.getItem(entry.key)).toBe(bodyRaw);
});
it('RPC 실패 뒤 원인 기록 quota 실패도 원래 원인과 기록 실패를 함께 알리고 양사본을 보존한다', async () => {
    const entry = await seed();
    m.call.mockRejectedValueOnce(Error('원래 RPC 응답 유실'));
    const original = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === entry.key + ':reference')
            throw new DOMException('용량 초과', 'QuotaExceededError');
        original.call(this, key, value);
    });
    const own = vi.fn();
    try {
        await expect(writes.command(scope, entry, 'apply', current, undefined, own)).rejects.toThrow(/원래 RPC 응답 유실.*원인 기록.*실패/s);
        expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
        expect(localStorage.getItem(entry.key + ':reference')).toBe(entry.referenceRaw);
        expect(own).not.toHaveBeenCalled();
    }
    finally {
        set.mockRestore();
    }
});
