import { it, expect, vi } from 'vitest';
import { createDocumentMetadataWrites, type DocumentMetadataPort, type DocumentMetadataRequest, type DocumentMetadataResult } from './documentMetadataWrites';
import { serializeDocumentMetadataRequest, documentUploadPath } from '../../../shared/documentMetadataCommand';
vi.mock('../../../shared/firebase', () => ({ auth: {}, authReady: Promise.resolve(), functions: {} }));
const scope = { companyId: 'taebaek' as const, actorUid: 'actor', employeeId: 'employee' };
const reference = { companyId: 'taebaek' as const, documentId: 'document', planId: 'plan' };
const request: DocumentMetadataRequest = { version: 1, reference, action: 'create', metadata: { category: '업무', subCategory: '일지', fileName: '원본.pdf', note: '', uploadedBy: '최초 이름', uploadedAt: '2026-10-19T00:00:00.000Z' }, upload: { uploadId: 'upload', path: documentUploadPath('taebaek', 'upload', '원본.pdf'), sha256: 'a'.repeat(64), size: 3, contentType: 'application/pdf' } };
const sha = async (v: DocumentMetadataRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeDocumentMetadataRequest(v))))].map(n => n.toString(16).padStart(2, '0')).join('');
function fixture() {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
    let response: Partial<DocumentMetadataResult> = { status: 'active', uploadStatus: 'reserved', cleanupStatus: 'not-required' };
    const command = vi.fn(async () => ({ version: 1, reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash: await sha(request), message: '서버가 확인한 결과', ...response }));
    const port: DocumentMetadataPort = { storage, command, assertScope: vi.fn(async () => { }), exclusive: vi.fn(async (_scope, work) => work()) };
    return { values, storage, port, command, writer: createDocumentMetadataWrites(port), respond: (next: Partial<DocumentMetadataResult>) => { response = { ...response, ...next }; } };
}
it('원문과 독립참조를 읽기 대조한 뒤만 송신하고 URL/generation은 최초hash에 넣지 않는다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '최초 원본');
    expect(f.values.size).toBe(2);
    expect(entry.requestHash).toBe(await sha(request));
    await f.writer.command(scope, reference, 'reserveUpload');
    expect(f.command).toHaveBeenCalledWith({ mode: 'reserveUpload', request });
    expect(JSON.stringify(entry.request)).not.toMatch(/downloadUrl|generation/);
});
it('저장 readback 실패는 서버0이며 이미남은 사본은 목록에서 보존한다', async () => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(() => { });
    await expect(f.writer.prepare(scope, request, '원본')).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
});
it('독립참조만 남아도 같은ref 조회·중단하며 손상원문 재송신은 막는다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
    f.values.delete(entry.key);
    const rows = await f.writer.list(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reference, readable: false });
    await f.writer.command(scope, reference, 'inspect');
    expect(f.command).toHaveBeenLastCalledWith({ mode: 'inspect', reference });
    await expect(f.writer.command(scope, reference, 'apply')).rejects.toThrow();
});
it('다른 유효사본의 applied는 현재완료가 아니며 명시discard전 원문을 유지한다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
    f.respond({ status: 'applied', requestHash: 'b'.repeat(64), uploadStatus: 'verified', cleanupStatus: 'not-required' });
    const result = await f.writer.command(scope, reference, 'inspect');
    expect(result.copyMismatch).toBe(true);
    expect(f.values.has(entry.key)).toBe(true);
    const observed = (await f.writer.read(scope, reference)).observedLocalText;
    expect((await f.writer.discard(scope, reference, observed)).status).toBe('cleared');
    expect(f.values.size).toBe(0);
});
it('손상hash·JSON도 서버상태는 조회하되 자동정리하지 않는다', async () => {
    for (const raw of ['{broken', JSON.stringify({ version: 1, request, actorUid: 'actor', employeeId: 'employee', requestHash: 'b'.repeat(64), description: '손상' })]) {
        const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
        f.values.set(entry.key, raw);
        f.respond({ status: 'cancelled', requestHash: null });
        expect((await f.writer.command(scope, reference, 'cancel')).copyMismatch).toBe(true);
        expect(f.values.get(entry.key)).toBe(raw);
        expect((await f.writer.discard(scope, reference, (await f.writer.read(scope, reference)).observedLocalText)).status).toBe('cleared');
    }
});
it('no-local applied는 과거서버관측이며 현재작성ACK로 승격하지 않는다', async () => {
    const f = fixture();
    f.respond({ status: 'applied', uploadStatus: 'verified' });
    expect((await f.writer.command(scope, reference, 'inspect')).copyMismatch).toBe(true);
});
it('opaque cancelled nullhash는 미확정으로 바꾸지 않고 같은 원문을 종결한다', async () => {
    const f = fixture();
    await f.writer.prepare(scope, request, '원본');
    f.respond({ status: 'cancelled', requestHash: null });
    expect((await f.writer.command(scope, reference, 'apply')).result.status).toBe('cancelled');
    expect(f.values.size).toBe(0);
});
it('서버unknown은 명시사본정리도 거절하고 업무0을 추정하지 않는다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
    f.respond({ status: 'unknown', requestHash: null });
    expect((await f.writer.discard(scope, reference, entry.observedLocalText)).status).toBe('blocked');
    expect(f.values.size).toBe(2);
});
it('관측뒤바뀐 body 또는 sidecar는 사본정리 CAS가 보존한다', async () => {
    for (const suffix of ['', ':ref']) {
        const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
        f.values.set(entry.key + suffix, '새사본');
        f.respond({ status: 'cancelled', requestHash: null });
        expect((await f.writer.discard(scope, reference, entry.observedLocalText)).status).toBe('unknown');
        expect(f.values.get(entry.key + suffix)).toBe('새사본');
    }
});
it('samehash 완료 후 정리실패는 업무완료와 사본정리실패를 분리한다', async () => {
    const f = fixture();
    await f.writer.prepare(scope, request, '원본');
    f.respond({ status: 'applied', uploadStatus: 'verified' });
    f.storage.removeItem.mockImplementationOnce(() => { throw Error('quota'); });
    const result = await f.writer.command(scope, reference, 'inspect');
    expect(result.result.status).toBe('applied');
    expect(result.cleanupFailed).toBe(true);
    expect(result.message).toContain('다시 저장하지 말고');
});
it('단계관측도 같은lock과scope·원문CAS를 확인해 새사본을 덮지 않는다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원본');
    f.command.mockImplementationOnce(async () => { f.values.set(entry.key, '송신중 교체'); return { version: 1, reference, actorUid: 'actor', employeeId: 'employee', requestHash: await sha(request), status: 'active', uploadStatus: 'reserved', cleanupStatus: 'not-required', message: '예약' }; });
    await expect(f.writer.command(scope, reference, 'inspect')).rejects.toThrow('기기 사본이 바뀌어');
    expect(f.values.get(entry.key)).toBe('송신중 교체');
});
it('잘못된 UID·직원·ref 응답은 원문을 유지하고 완료로 보지 않는다', async () => {
    for (const bad of [{ actorUid: 'other' }, { employeeId: 'other' }, { reference: { ...reference, documentId: 'other' } }]) {
        const f = fixture();
        await f.writer.prepare(scope, request, '원본');
        f.respond({ status: 'applied', ...bad });
        await expect(f.writer.command(scope, reference, 'inspect')).rejects.toThrow();
        expect(f.values.size).toBe(2);
    }
});
it('파일정리 pending은 metadata applied와분리해보존하고서버cleanup만호출한다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원문');
    f.respond({ status: 'applied', uploadStatus: 'verified', cleanupStatus: 'pending' });
    const result = await f.writer.command(scope, reference, 'inspect');
    expect(result.result.status).toBe('applied');
    expect(f.values.has(entry.key)).toBe(true);
    f.respond({ cleanupStatus: 'retained-replaced' });
    await f.writer.command(scope, reference, 'cleanup');
    expect(f.command).toHaveBeenLastCalledWith({ mode: 'cleanup', reference });
    expect(f.values.size).toBe(0);
});
it('준비중scope변경과bodykey계획불일치는서버송신없이보존한다', async () => {
    const f = fixture(), entry = await f.writer.prepare(scope, request, '원문');
    const body = JSON.parse(f.values.get(entry.key)!);
    body.request.reference.planId = 'other';
    f.values.set(entry.key, JSON.stringify(body));
    expect((await f.writer.list(scope))[0].readable).toBe(false);
    await expect(f.writer.command(scope, reference, 'apply')).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
    await expect(f.writer.command(scope, reference, 'inspect', () => false)).rejects.toThrow();
    expect(f.values.size).toBe(2);
});
it('서버미완료조회는빈페이지cursor를보존하고회사UID직원응답을엄격검증한다', async () => {
    const f = fixture(), cursor = 'c'.repeat(64);
    f.command.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor', employeeId: 'employee', entries: [], nextCursor: cursor } as unknown as Awaited<ReturnType<typeof f.command>>);
    const page = await f.writer.listPending(scope);
    expect(page.nextCursor).toBe(cursor);
    expect(f.command).toHaveBeenLastCalledWith({ mode: 'listPending', companyId: 'taebaek' });
    f.command.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'other', employeeId: 'employee', entries: [], nextCursor: null } as unknown as Awaited<ReturnType<typeof f.command>>);
    await expect(f.writer.listPending(scope, cursor)).rejects.toThrow();
    expect(f.values.size).toBe(0);
});
it('본문과독립참조key구분은요청번호문자와충돌하지않는다', async () => {
    const f = fixture(), input = { ...request, reference: { ...reference, planId: 'ref' } };
    await f.writer.prepare(scope, input, '구분');
    const rows = await f.writer.list(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ readable: true, reference: input.reference });
});
