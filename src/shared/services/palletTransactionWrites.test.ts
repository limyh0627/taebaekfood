/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor', getIdTokenResult: vi.fn() } }, call: vi.fn() }));
vi.mock('../firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
import writes from './palletTransactionWrites';
import { serializePalletTransactionRequest, type PalletStockEditRequest, type PalletExchangeCompletionRequest, type PalletTransactionRequest, type PalletTransactionResult } from '../palletTransactionCommand';
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
    expect(own).toHaveBeenCalledWith(null, entry);
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
    expect(own).toHaveBeenCalledWith(next, legacy);
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
function completion(operationId = 'complete', sourceTransactionId = 'source'): PalletExchangeCompletionRequest {
    return { version: 2, action: 'complete-exchange', reference: { companyId: 'taebaek', operationId, transactionId: 'return-' + operationId }, sourceTransactionId,
        source: { partnerId: 'partner', palletId: 'pallet', type: 'out', quantity: 5, date: '2026-10-20', note: '원 교체 지급', status: '교체중', exchangeReturnQty: 0 }, expectedVersion: '1:000000000', returnDate: '2026-10-21' };
}
function openInput() { const input = completion(); return { reference: input.reference, sourceTransactionId: input.sourceTransactionId, source: input.source }; }
it('기존 v1 wrapper·정규 본문·prefix와 해시는 확장 뒤에도 같은 bytes다', async () => {
    const input = request();
    const canonical = JSON.stringify(input);
    expect(serializePalletTransactionRequest(input)).toBe(canonical);
    const entry = await writes.prepare(scope, input, current);
    expect(entry.bodyRaw).toBe(JSON.stringify({ version: 1, actorUid: 'actor', request: input }));
    expect(entry.key.startsWith('pallet-transaction-v1:taebaek:actor:')).toBe(true);
    expect(JSON.parse(entry.referenceRaw!).version).toBe(1);
    expect((await writes.read(scope))[0].bodyRaw).toBe(entry.bodyRaw);
});
it('교체 readonly 준비는 고정 선택 source를 보내며 보관·apply를 하지 않는다', async () => {
    const input = openInput();
    m.call.mockResolvedValueOnce({ data: { ...input, actorUid: 'actor', expectedVersion: '7:000000001' } });
    const result = await writes.openExchange(scope, input, current);
    expect(result.expectedVersion).toBe('7:000000001');
    expect(localStorage.length).toBe(0);
    expect(m.call.mock.calls[0][0]).toEqual({ mode: 'open-exchange', ...input });
});
it.each(['actor', 'ref', 'source-id', 'source-body'] as const)('교체 open 응답의 %s가 다르면 신선한 version을 채택하지 않는다', async (variant) => {
    const input = openInput();
    const response = { ...structuredClone(input), actorUid: 'actor', expectedVersion: '7:000000001' };
    if (variant === 'actor')
        response.actorUid = 'other';
    if (variant === 'ref')
        response.reference.operationId = 'other';
    if (variant === 'source-id')
        response.sourceTransactionId = 'other';
    if (variant === 'source-body')
        response.source.quantity = 6;
    m.call.mockResolvedValueOnce({ data: response });
    await expect(writes.openExchange(scope, input, current)).rejects.toThrow('다릅니다');
    expect(localStorage.length).toBe(0);
});
it('교체 open await 중 UID 교체는 응답 version을 반환하지 않는다', async () => {
    const input = openInput();
    const wait = deferred<{
        data: unknown;
    }>();
    m.call.mockReturnValueOnce(wait.promise);
    const task = writes.openExchange(scope, input, current);
    await vi.waitFor(() => expect(m.call).toHaveBeenCalledOnce());
    m.auth.currentUser.uid = 'other';
    wait.resolve({ data: { ...input, actorUid: 'actor', expectedVersion: '1:000000000' } });
    await expect(task).rejects.toThrow('바뀌');
    expect(localStorage.length).toBe(0);
});
it('교체 완료 source·회수0·날짜·native와 target을 고정하고 lost 뒤 같은 v2만 재송신한다', async () => {
    const input = completion();
    let entry = await writes.prepare(scope, input, current);
    expect(entry.transaction).toBeNull();
    expect(entry.summary).toMatchObject({ action: 'complete-exchange', quantity: 5, returnQty: 0, date: '2026-10-21', sourceTransactionId: 'source' });
    m.call.mockRejectedValueOnce(Error('교체 응답 유실'));
    await expect(writes.command(scope, entry, 'apply', current, undefined, next => { entry = next!; })).rejects.toThrow('유실');
    const [reloaded] = await writes.read(scope);
    expect(reloaded.lastAttempt?.message).toBe('교체 응답 유실');
    m.call.mockResolvedValueOnce({ data: result(reloaded) });
    const observed = await writes.command(scope, reloaded, 'apply', current);
    expect(observed.terminal).toBe(true);
    expect(m.call.mock.calls.map(call => call[0])).toEqual([{ mode: 'apply', request: input }, { mode: 'apply', request: input }]);
    expect(writes.projection(reloaded, observed.result).currentState).toContain('교체 완료와 회수');
    expect(localStorage.getItem(entry.key)).not.toBeNull();
});
it('다음날 새 target·op·native도 같은 원교체 요청이면 기존 entry를 선택하고 새 보관을 막는다', async () => {
    const first = await writes.prepare(scope, completion(), current);
    const next = completion('other');
    next.returnDate = '2026-10-22';
    next.expectedVersion = '2:000000000';
    expect(writes.findMatchingExchange(await writes.read(scope), 'source')?.key).toBe(first.key);
    await expect(writes.prepare(scope, next, current)).rejects.toThrow('같은 내용');
    expect(m.call).not.toHaveBeenCalled();
    expect(localStorage.getItem(first.key)).toBe(first.bodyRaw);
});
it('다른 source의 교체와 일반 등록은 별도 업무로 보관할 수 있다', async () => {
    await writes.prepare(scope, completion(), current);
    await writes.prepare(scope, completion('other', 'other-source'), current);
    await seed();
    expect(await writes.read(scope)).toHaveLength(3);
    expect(m.call).not.toHaveBeenCalled();
});
it('v1 본문과 v2 sidecar 충돌은 각 결과를 확인해야 정리하며 양쪽 업무를 자동 전송하지 않는다', async () => {
    const a = await seed();
    const b = await writes.prepare(scope, completion(), current);
    localStorage.setItem(a.key + ':reference', b.referenceRaw!);
    const entry = (await writes.read(scope)).find(value => value.key === a.key)!;
    expect(entry.references).toHaveLength(2);
    expect(writes.projection(entry).canRetry).toBe(false);
    m.call.mockResolvedValueOnce({ data: result(a) }).mockResolvedValueOnce({ data: result(b, 'unknown') });
    await expect(writes.discard(scope, entry, current)).rejects.toThrow('아직');
    expect(localStorage.getItem(a.key)).toBe(a.bodyRaw);
    m.call.mockResolvedValueOnce({ data: result(a) }).mockResolvedValueOnce({ data: result(b, 'cancelled') });
    await writes.discard(scope, entry, current);
    expect(m.call.mock.calls.every(call => call[0].mode === 'inspect')).toBe(true);
    expect(localStorage.getItem(b.key)).toBe(b.bodyRaw);
});
it('v2 본문만 남은 legacy도 wrapper1 bytes 그대로 명시 ref 복원하며 apply0이다', async () => {
    const entry = await writes.prepare(scope, completion(), current);
    localStorage.removeItem(entry.key + ':reference');
    const [legacy] = await writes.read(scope);
    const restored = await writes.upgrade(scope, legacy, current);
    expect(restored.request?.version).toBe(2);
    expect(restored.bodyRaw).toBe(entry.bodyRaw);
    expect(m.call).not.toHaveBeenCalled();
});
function stockEdit(operationId = 'edit', patch: PalletStockEditRequest['patch'] = { name: '새 이름' }): PalletStockEditRequest {
    return { version: 3, action: 'edit-pallet', reference: { kind: 'pallet-edit', companyId: 'taebaek', operationId, palletId: 'stock' }, original: { name: '원 이름', total: 10, damaged: 1 }, expectedVersion: '1:000000000', patch };
}
it('수정 open은 최초3값을 고정하며 선택 당시 total10과 응답 total7을 합치지 않는다', async () => {
    const input = stockEdit();
    m.call.mockResolvedValueOnce({ data: { reference: input.reference, original: { ...input.original, total: 7 }, actorUid: 'actor', expectedVersion: '2:000000000' } });
    await expect(writes.openEdit(scope, { reference: input.reference, original: input.original }, current)).rejects.toThrow('다릅니다');
    expect(m.call.mock.calls[0][0]).toEqual({ mode: 'open-edit', reference: input.reference, original: input.original });
    expect(localStorage.length).toBe(0);
});
it.each(['actor', 'ref'] as const)('수정 open 응답의 %s 불일치는 채택하지 않는다', async (variant) => {
    const input = stockEdit();
    const response = { reference: { ...input.reference }, original: input.original, actorUid: 'actor', expectedVersion: input.expectedVersion };
    if (variant === 'actor')
        response.actorUid = 'other';
    else
        response.reference.palletId = 'other';
    m.call.mockResolvedValueOnce({ data: response });
    await expect(writes.openEdit(scope, input, current)).rejects.toThrow('다릅니다');
    expect(localStorage.length).toBe(0);
});
it('수정 open 대기 중 owner 변경은 fresh native 응답도 버린다', async () => {
    const input = stockEdit();
    const wait = deferred<{
        data: unknown;
    }>();
    m.call.mockReturnValueOnce(wait.promise);
    let active = true;
    const task = writes.openEdit(scope, input, () => active);
    await vi.waitFor(() => expect(m.call).toHaveBeenCalledOnce());
    active = false;
    wait.resolve({ data: { reference: input.reference, original: input.original, actorUid: 'actor', expectedVersion: input.expectedVersion } });
    await expect(task).rejects.toThrow('바뀌');
    expect(localStorage.length).toBe(0);
});
it('v3 수정은 별도 key와 edit요약을 쓰고 lost 후 original·dirty·native를 그대로 재전송한다', async () => {
    const input = stockEdit();
    let entry = await writes.prepare(scope, input, current);
    const before = entry;
    expect(decodeURIComponent(entry.key)).toContain('["pallet-edit","edit","stock"]');
    expect(entry.transaction).toBeNull();
    expect(entry.summary).toEqual({ action: 'edit-pallet', palletId: 'stock', original: input.original, patch: input.patch });
    m.call.mockRejectedValueOnce(Error('수정 응답 유실'));
    const own = vi.fn((next, previous) => { expect(previous.bodyRaw).toBe(before.bodyRaw); expect(previous.referenceRaw).toBe(before.referenceRaw); entry = next; });
    await expect(writes.command(scope, entry, 'apply', current, undefined, own)).rejects.toThrow('유실');
    expect(own).toHaveBeenCalledOnce();
    expect(entry.referenceRaw).not.toBe(before.referenceRaw);
    expect(entry.bodyRaw).toBe(before.bodyRaw);
    m.call.mockResolvedValueOnce({ data: result(entry) });
    const outcome = await writes.command(scope, entry, 'apply', current);
    expect(m.call.mock.calls.map(call => call[0])).toEqual([{ mode: 'apply', request: input }, { mode: 'apply', request: input }]);
    expect(writes.projection(entry, outcome.result).currentState).toContain('재고 수정');
});
it('같은pallet 같은dirty값은 op/native/original이 달라도 남은 요청을 선택하고 다른dirty는 허용한다', async () => {
    const input = stockEdit('edit', { total: 12, name: '변경' });
    const first = await writes.prepare(scope, input, current);
    const next = stockEdit('new', { name: '변경', total: 12 });
    next.expectedVersion = '2:000000000';
    next.original.total = 9;
    expect(writes.findMatchingEdit(await writes.read(scope), { palletId: 'stock', patch: next.patch })?.key).toBe(first.key);
    await expect(writes.prepare(scope, next, current)).rejects.toThrow('같은 내용');
    await writes.prepare(scope, stockEdit('different', { name: '다른 변경' }), current);
    expect(await writes.read(scope)).toHaveLength(2);
    expect(m.call).not.toHaveBeenCalled();
});
it('old3ref와editref는 op가 같아도 key와참조 의미를 섞지 않는다', async () => {
    const old = await seed('edit');
    const edited = await writes.prepare(scope, stockEdit(), current);
    expect(old.key).not.toBe(edited.key);
    expect(edited.reference).toEqual(stockEdit().reference);
    expect(old.reference).toEqual(request('edit').reference);
    m.call.mockResolvedValueOnce({ data: result(edited, 'unknown') });
    await writes.command(scope, edited, 'inspect', current);
    expect(m.call.mock.calls[0][0].reference).toEqual(stockEdit().reference);
});
it('v1 body+edit sidecar 충돌은 둘다terminal 조회 뒤에만 양CAS정리한다', async () => {
    const old = await seed();
    const edit = await writes.prepare(scope, stockEdit(), current);
    localStorage.setItem(old.key + ':reference', edit.referenceRaw!);
    const entry = (await writes.read(scope)).find(value => value.key === old.key)!;
    expect(entry.references).toHaveLength(2);
    expect(writes.projection(entry).canRetry).toBe(false);
    m.call.mockResolvedValueOnce({ data: result(old) }).mockResolvedValueOnce({ data: result(edit, 'unknown') });
    await expect(writes.discard(scope, entry, current)).rejects.toThrow('아직');
    m.call.mockResolvedValueOnce({ data: result(old) }).mockResolvedValueOnce({ data: result(edit, 'cancelled') });
    await writes.discard(scope, entry, current);
    expect(localStorage.getItem(edit.key)).toBe(edit.bodyRaw);
});
it('수정 body-only legacy는 wrapper1을 바꾸지 않고 editref만 명시복원한다', async () => {
    const entry = await writes.prepare(scope, stockEdit(), current);
    localStorage.removeItem(entry.key + ':reference');
    const [legacy] = await writes.read(scope);
    const restored = await writes.upgrade(scope, legacy, current);
    expect(restored.reference).toEqual(stockEdit().reference);
    expect(restored.bodyRaw).toBe(entry.bodyRaw);
    expect(restored.request?.version).toBe(3);
    expect(m.call).not.toHaveBeenCalled();
});
it('수정 ref-only 손상도 결과확인과 미처리중단 뒤 명시정리하며 apply0이다', async () => {
    const entry = await writes.prepare(scope, stockEdit(), current);
    localStorage.setItem(entry.key, '{손상');
    const [broken] = await writes.read(scope);
    await expect(writes.command(scope, broken, 'apply', current)).rejects.toThrow('일치');
    m.call.mockResolvedValueOnce({ data: result(entry, 'unknown') });
    await writes.command(scope, broken, 'inspect', current);
    m.call.mockResolvedValueOnce({ data: result(entry, 'cancelled') });
    const stopped = await writes.command(scope, broken, 'cancel', current);
    expect(writes.projection(broken, stopped.result).canDiscard).toBe(true);
    m.call.mockResolvedValueOnce({ data: result(entry, 'cancelled') });
    await writes.discard(scope, broken, current);
    expect(m.call.mock.calls.map(call => call[0].mode)).toEqual(['inspect', 'cancel', 'inspect']);
});
