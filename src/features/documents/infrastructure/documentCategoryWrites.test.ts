import { expect, it, vi } from 'vitest';
import { createDocumentCategoryWrites, type DocumentCategoryPort, type DocumentCategoryRequest, type DocumentCategoryResult } from './documentCategoryWrites';
import { serializeDocumentCategoryRequest } from '../../../shared/documentCategoryCommand';
vi.mock('../../../shared/firebase', () => ({ auth: {}, authReady: Promise.resolve(), functions: {} }));
const scope = { companyId: 'taebaek' as const, actorUid: 'actor', employeeId: 'employee' }, reference = { companyId: 'taebaek' as const, planId: 'plan' };
const request: DocumentCategoryRequest = { version: 1, reference, action: 'createCategory', categoryId: 'fixed-category', name: '원분류', order: 3, createdAt: '2026-10-19T00:00:00.000Z' };
const digest = async (input: DocumentCategoryRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeDocumentCategoryRequest(input))))].map(n => n.toString(16).padStart(2, '0')).join('');
function fixture() {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
    let result: Partial<DocumentCategoryResult> = { status: 'applied' };
    const command = vi.fn(async (_input: unknown): Promise<unknown> => ({ version: 1, reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash: await digest(request), message: '서버에서 확인한 결과', ...result }));
    const port: DocumentCategoryPort = { storage, command, assertScope: vi.fn(async () => { }), exclusive: vi.fn(async (_scope, work) => work()) };
    return { values, storage, port, command, writes: createDocumentCategoryWrites(port), respond: (next: Partial<DocumentCategoryResult>) => { result = { ...result, ...next }; } };
}
it('고정원문·독립참조 둘다readback후송신하고동일요청은원문그대로보낸다', async () => {
    const f = fixture(), entry = await f.writes.prepare(scope, request, '원분류 추가');
    expect(f.values.size).toBe(2);
    expect(entry.requestHash).toBe(await digest(request));
    const result = await f.writes.command(scope, reference, 'apply');
    expect(result.outcome.status).toBe('saved');
    expect(result.request).toEqual(request);
    expect(f.command).toHaveBeenCalledWith({ mode: 'apply', request });
    expect(f.values.size).toBe(0);
});
it('저장소쓰기·재읽기실패와형식오류는업무송신0이며남은사본은보존한다', async () => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(() => { });
    await expect(f.writes.prepare(scope, request, '원문')).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
    await expect(f.writes.prepare(scope, { ...request, name: '' }, '원문')).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
});
it('독립참조만남거나JSON손상이어도ref조회중단은가능하고apply는금지한다', async () => {
    for (const raw of [null, 'broken']) {
        const f = fixture(), entry = await f.writes.prepare(scope, request, '원문');
        if (raw === null)
            f.values.delete(entry.key);
        else
            f.values.set(entry.key, raw);
        const rows = await f.writes.list(scope);
        expect(rows).toHaveLength(1);
        expect(rows[0].readable).toBe(false);
        await expect(f.writes.command(scope, reference, 'apply')).rejects.toThrow();
        f.respond({ status: 'cancelled', requestHash: null });
        const result = await f.writes.command(scope, reference, 'cancel');
        expect(result.copyMismatch).toBe(true);
        expect(f.command).toHaveBeenLastCalledWith({ mode: 'cancel', reference });
        expect(f.values.size).toBeGreaterThan(0);
    }
});
it('다른유효hash와해시검증불가는서버applied를현재saved로승격·자동정리하지않는다', async () => {
    const f = fixture(), entry = await f.writes.prepare(scope, request, '원문');
    f.respond({ requestHash: 'b'.repeat(64) });
    const observed = await f.writes.command(scope, reference, 'inspect');
    expect(observed).toMatchObject({ copyMismatch: true, outcome: { status: 'rejected' } });
    expect(f.values.has(entry.key)).toBe(true);
    expect((await f.writes.discard(scope, reference, entry.observedLocalText)).status).toBe('cleared');
});
it('서버unknown은없음증거가아니며명시사본정리도거절한다', async () => {
    const f = fixture(), entry = await f.writes.prepare(scope, request, '원문');
    f.respond({ status: 'unknown', requestHash: null });
    expect((await f.writes.command(scope, reference, 'inspect')).outcome.status).toBe('unknown');
    expect((await f.writes.discard(scope, reference, entry.observedLocalText)).status).toBe('blocked');
    expect(f.values.size).toBe(2);
});
it('opaque cancelled nullhash를소비하고같은정상사본만정리한다', async () => {
    const f = fixture();
    await f.writes.prepare(scope, request, '원문');
    f.respond({ status: 'cancelled', requestHash: null });
    expect((await f.writes.command(scope, reference, 'apply')).outcome.status).toBe('cancelled');
    expect(f.values.size).toBe(0);
});
it('no-local서버applied는현재작성ACK가아니며참조조회만한다', async () => {
    const f = fixture(), result = await f.writes.command(scope, reference, 'inspect');
    expect(result.copyMismatch).toBe(true);
    expect(result.outcome.status).toBe('rejected');
    expect(f.command).toHaveBeenCalledWith({ mode: 'inspect', reference });
});
it('rawCAS는본문또는sidecar교체를보존하고업무를되돌리지않는다', async () => {
    for (const suffix of ['', ':ref']) {
        const f = fixture(), entry = await f.writes.prepare(scope, request, '원문');
        f.values.set(entry.key + suffix, '교체');
        expect((await f.writes.discard(scope, reference, entry.observedLocalText)).status).toBe('unknown');
        expect(f.values.get(entry.key + suffix)).toBe('교체');
        expect(f.command).toHaveBeenCalledWith({ mode: 'inspect', reference });
    }
});
it('주업무ACK뒤정리실패는partial·원인·다음행동을보존한다', async () => {
    const f = fixture();
    await f.writes.prepare(scope, request, '원문');
    f.storage.removeItem.mockImplementationOnce(() => { throw Error('quota'); });
    const result = await f.writes.command(scope, reference, 'inspect');
    expect(result).toMatchObject({ cleanupFailed: true, outcome: { status: 'partial', committedIds: ['plan'] } });
    expect(result.outcome.status === 'partial' && result.outcome.nextAction).toContain('다시 저장하지 말고');
});
it('저장key본문계획과회사UID직원응답결합이틀리면송신·자동정리하지않는다', async () => {
    const f = fixture(), entry = await f.writes.prepare(scope, request, '원문');
    const body = JSON.parse(f.values.get(entry.key)!);
    body.request.reference.planId = 'other';
    f.values.set(entry.key, JSON.stringify(body));
    expect((await f.writes.list(scope))[0].readable).toBe(false);
    await expect(f.writes.command(scope, reference, 'apply')).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
    for (const bad of [{ actorUid: 'other' }, { employeeId: 'other' }, { reference: { ...reference, planId: 'other' } }]) {
        f.respond(bad);
        await expect(f.writes.command(scope, reference, 'inspect')).rejects.toThrow();
        expect(f.values.has(entry.key)).toBe(true);
    }
});
it('송신중scope변경이면원문을유지하고다음I/O·정리0이다', async () => {
    const f = fixture();
    await f.writes.prepare(scope, request, '원문');
    let current = true;
    f.command.mockImplementationOnce(async () => { current = false; return { version: 1, reference, actorUid: 'actor', employeeId: 'employee', requestHash: await digest(request), status: 'applied', message: '확인' }; });
    await expect(f.writes.command(scope, reference, 'apply', () => current)).rejects.toThrow();
    expect(f.values.size).toBe(2);
});
it('서버목록빈페이지cursor와scope검증을보존하며가짜local원문은만들지않는다', async () => {
    const f = fixture(), cursor = 'c'.repeat(64);
    f.command.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor', employeeId: 'employee', entries: [], nextCursor: cursor });
    expect((await f.writes.listPending(scope)).nextCursor).toBe(cursor);
    expect(f.values.size).toBe(0);
    f.command.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'other', employeeId: 'employee', entries: [], nextCursor: null });
    await expect(f.writes.listPending(scope, cursor)).rejects.toThrow();
});
it('표시A뒤저장소B로바뀌면B서버완료도자동정리0이며명시재시도는새원문송신0이다', async () => {
    const f = fixture(), entry = await f.writes.prepare(scope, request, 'A표시');
    const body = JSON.parse(f.values.get(entry.key)!);
    body.request.name = 'B';
    body.description = 'B표시';
    body.requestHash = await digest(body.request);
    const sidecar = JSON.parse(f.values.get(entry.key + ':ref')!);
    sidecar.requestHash = body.requestHash;
    f.values.set(entry.key, JSON.stringify(body));
    f.values.set(entry.key + ':ref', JSON.stringify(sidecar));
    f.respond({ requestHash: body.requestHash });
    await expect(f.writes.command(scope, reference, 'apply', () => true, entry.observedLocalText)).rejects.toThrow('보관 원문이 바뀌어');
    expect(f.command).not.toHaveBeenCalled();
    const observation = await f.writes.command(scope, reference, 'inspect', () => true, entry.observedLocalText);
    expect(observation.copyMismatch).toBe(true);
    expect(f.values.get(entry.key)).toBe(JSON.stringify(body));
});
