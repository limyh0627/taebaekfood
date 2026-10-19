// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CabinetDoc } from '../../../shared/types';
import { useDocumentTransfers } from './useDocumentTransfers';
import { createDocumentTransferPort, assertDocumentFileIdentity, DocumentTransferNotStartedError } from '../infrastructure/documentTransfers';
import type { DocumentMetadataEntry, DocumentMetadataObservation } from '../infrastructure/documentMetadataWrites';
import type { DocumentMetadataRequest, DocumentMetadataResult } from '../../../shared/documentMetadataCommand';
const auth = vi.hoisted(() => ({ currentUser: { uid: 'A' } }));
vi.mock('../../../shared/firebase', () => ({ auth }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true), appPrompt: vi.fn(async () => '메모') }));
vi.mock('../infrastructure/documentMetadataWrites', () => ({ documentMetadataWrites: {} }));
vi.mock('../infrastructure/documentTransfers', () => {
    class NotStarted extends Error {
    }
    return {
        DocumentTransferNotStartedError: NotStarted, isDocumentTransferNotStarted: (error: unknown) => error instanceof NotStarted,
        documentFileSha256: vi.fn(async () => 'a'.repeat(64)),
        assertDocumentFileIdentity: vi.fn(async () => { }),
        createDocumentTransferPort: () => ({ assertCurrent: vi.fn(async () => { }), uploadReservedFile: vi.fn(async () => { }), getFileUrl: vi.fn(async () => 'url') })
    };
});
const file = () => new File(['a'], '원문.pdf', { type: 'application/pdf' });
const doc = { id: 'doc', fileName: '삭제.pdf', storagePath: 'fixed/delete', category: '업무용', subCategory: '원문', companyId: 'taebaek' } as CabinetDoc;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
beforeEach(() => { auth.currentUser.uid = 'A'; vi.mocked(assertDocumentFileIdentity).mockReset().mockResolvedValue(undefined); });
function fixture() {
    const ports = createDocumentTransferPort(), entries = new Map<string, DocumentMetadataEntry>(), uploaded = new Set<string>();
    const upload = ports.uploadReservedFile;
    vi.mocked(upload).mockImplementation(async (_file, identity) => { uploaded.add(identity.uploadId); });
    const read = vi.fn(async (_scope: unknown, ref: {
        planId: string;
    }) => entries.get(ref.planId)!), list = vi.fn(async () => [...entries.values()]);
    const prepare = vi.fn(async (_scope: unknown, request: DocumentMetadataRequest, description: string) => { const entry: DocumentMetadataEntry = { key: request.reference.planId, reference: request.reference, request, requestHash: 'a'.repeat(64), description, readable: true, status: 'valid', observedLocalText: JSON.stringify(request) }; entries.set(entry.key, entry); return entry; });
    const statuses = new Map<string, Partial<DocumentMetadataResult>>();
    const command = vi.fn(async (_scope: unknown, ref: {
        planId: string;
    }, mode: string): Promise<DocumentMetadataObservation> => {
        const entry = entries.get(ref.planId)!, request = entry.request!;
        let state = statuses.get(ref.planId);
        if (mode === 'reserveUpload')
            state = { status: 'active', uploadStatus: 'reserved' };
        if (mode === 'apply')
            state = { status: 'applied', uploadStatus: request.action === 'create' ? 'verified' : 'not-required', cleanupStatus: request.action === 'delete' ? 'pending' : 'not-required' };
        if (mode === 'cancel')
            state = { status: 'cancelled', cleanupStatus: 'pending' };
        if (mode === 'cleanup')
            state = { ...state, status: state?.status ?? 'cancelled', cleanupStatus: 'deleted' };
        if (mode === 'inspect' && request.action === 'create' && uploaded.has(request.upload.uploadId) && state?.status === 'active')
            state = { ...state, uploadStatus: 'verified' };
        statuses.set(ref.planId, state ?? { status: 'unknown' });
        const result: DocumentMetadataResult = { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'unknown', uploadStatus: 'not-required', cleanupStatus: 'not-required', message: '실서버관측', ...state };
        if (['applied', 'cancelled', 'rejected'].includes(result.status) && result.cleanupStatus !== 'pending')
            entries.delete(entry.key);
        return { result, copyMismatch: false, cleanupFailed: false, message: result.message };
    });
    // 완료 뒤에도 read는 본문 없음을 반환해 서버 ACK와 기기 사본 잔존을 구분한다.
    read.mockImplementation(async (_scope, ref) => entries.get(ref.planId) ?? ({ key: ref.planId, reference: null, readable: false, status: 'corrupt', description: '終了', observedLocalText: 'null' }));
    const listPending = vi.fn(async (_scope: unknown, _cursor?: string, _current?: () => boolean) => ({ version: 1 as const, companyId: 'taebaek' as const, actorUid: 'A', employeeId: 'employee', entries: [] as {
            result: DocumentMetadataResult;
            label: string;
        }[], nextCursor: null as string | null }));
    const metadata = { prepare, read, list, listPending, command, open: vi.fn(async () => ({ expectedVersion: '1:000000000', snapshot: [] })), discard: vi.fn(async () => ({ status: 'cleared' as const, message: '기기 사본만 정리' })) };
    const options = { companyId: 'taebaek' as const, employeeId: 'employee', actorUid: 'A', uploadedBy: '작성자', ports, metadata: metadata as unknown as NonNullable<Parameters<typeof useDocumentTransfers>[0]['metadata']> };
    return { ports, metadata, options, entries, statuses, uploaded };
}
it('업로드 실패는 같은 File·ID·경로·분류 원문으로 재시도한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('upload'));
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    const input = file();
    await act(() => result.current.startUploads([input], '원분류', '원중분류'));
    const job = result.current.jobs[0];
    expect(job.stage).toBe('unknown');
    await act(() => result.current.resume(job.jobId));
    const calls = vi.mocked(f.ports.uploadReservedFile).mock.calls;
    expect(calls[1][0]).toBe(input);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(f.metadata.prepare).toHaveBeenCalledOnce();
    expect(f.metadata.prepare.mock.calls[0][1]).toMatchObject({ metadata: { category: '원분류', subCategory: '원중분류' } });
    expect(result.current.jobs).toHaveLength(0);
});
it('URL 실패는 업로드 ACK를 재송신하지 않는다', async () => {
    const f = fixture(), original = f.metadata.command.getMockImplementation()!;
    let once = true;
    f.metadata.command.mockImplementation(async (...args) => {
        if (args[2] === 'inspect' && f.uploaded.size && once) {
            once = false;
            throw Error('객체주소 검증 응답 유실');
        }
        return original(...args);
    });
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    const id = result.current.jobs[0].jobId;
    await act(() => result.current.resume(id));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
    expect(f.ports.getFileUrl).not.toHaveBeenCalled();
    expect(result.current.jobs).toHaveLength(0);
});
it('목록 등록 미확정은 재송신하지 않고 무관 파일은 허용한다', async () => {
    const f = fixture(), original = f.metadata.command.getMockImplementation()!;
    let first = true;
    f.metadata.command.mockImplementation(async (...args) => {
        if (args[2] === 'apply' && first) {
            first = false;
            f.statuses.set(args[1].planId, { status: 'applied', uploadStatus: 'verified' });
            throw Error('lost');
        }
        return original(...args);
    });
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    const id = result.current.jobs[0].jobId;
    expect(result.current.jobs[0].stage).toBe('unknown');
    await act(() => result.current.inspect(id));
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(1);
    await act(() => result.current.startUploads([file()], '다른', '분류'));
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(2);
    expect(result.current.jobs).toHaveLength(0);
});
it('삭제 metadata 미확정이면 파일을 지우거나 본문을 다시 삭제하지 않는다', async () => {
    const f = fixture(), original = f.metadata.command.getMockImplementation()!;
    f.metadata.command.mockImplementation(async (...args) => {
        if (args[2] === 'apply')
            throw Error('lost');
        return original(...args);
    });
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.deleteDocument(doc));
    await act(() => result.current.inspect(result.current.jobs[0].jobId));
    await act(() => result.current.deleteDocument(doc));
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(1);
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'cleanup')).toHaveLength(0);
});
it('삭제 ACK 뒤 파일 실패는 동일 경로 정리만 재시도한다', async () => {
    const f = fixture(), original = f.metadata.command.getMockImplementation()!;
    let first = true;
    f.metadata.command.mockImplementation(async (...args) => {
        if (args[2] === 'cleanup' && first) {
            first = false;
            throw Error('storage');
        }
        return original(...args);
    });
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.deleteDocument(doc));
    const id = result.current.jobs[0].jobId;
    expect(result.current.jobs[0]).toMatchObject({ stage: 'cleanup', canRetry: true });
    await act(() => result.current.retryCleanup(id));
    await act(() => result.current.retryCleanup(id));
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(1);
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'cleanup').map(c => c[1])).toEqual([f.metadata.prepare.mock.calls[0][1].reference, f.metadata.prepare.mock.calls[0][1].reference]);
});
it('삭제 확인 대기 중 UID 전환이면 송신하지 않는다', async () => {
    const f = fixture(), gate = deferred<boolean>();
    const { result, rerender } = renderHook(({ uid }) => useDocumentTransfers({ ...f.options, actorUid: uid, confirm: () => gate.promise }), { initialProps: { uid: 'A' } });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    let run!: Promise<void>;
    act(() => { run = result.current.deleteDocument(doc); });
    auth.currentUser.uid = 'B';
    rerender({ uid: 'B' });
    await act(async () => { gate.resolve(true); await run; });
    expect(f.metadata.open).not.toHaveBeenCalled();
    expect(f.metadata.command).not.toHaveBeenCalled();
});
it('늦은 업로드 ACK는 새 scope 후속 송신0·원 scope 복귀 뒤 URL부터 이어진다', async () => {
    const f = fixture(), gate = deferred<void>();
    vi.mocked(f.ports.uploadReservedFile).mockImplementationOnce(async (_file, identity) => { await gate.promise; f.uploaded.add(identity.uploadId); });
    const { result, rerender } = renderHook(({ uid }) => useDocumentTransfers({ ...f.options, actorUid: uid }), { initialProps: { uid: 'A' } });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    let run!: Promise<void>;
    act(() => { run = result.current.startUploads([file()], 'c', 's'); });
    await waitFor(() => expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce());
    auth.currentUser.uid = 'B';
    rerender({ uid: 'B' });
    await act(async () => { gate.resolve(); await run; });
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(0);
    expect(result.current.jobs).toHaveLength(0);
    auth.currentUser.uid = 'A';
    rerender({ uid: 'A' });
    await waitFor(() => expect(result.current.jobs[0]?.stage).toBe('metadata'));
    await act(() => result.current.resume(result.current.jobs[0].jobId));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
});
it('여러 파일은 각각의 busy로 처리되어 이전 finally가 새 작업을 풀지 않는다', async () => {
    const f = fixture(), old = deferred<void>(), fresh = deferred<void>();
    vi.mocked(f.ports.uploadReservedFile).mockImplementationOnce(async (_f, id) => { await old.promise; f.uploaded.add(id.uploadId); }).mockImplementationOnce(async (_f, id) => { await fresh.promise; f.uploaded.add(id.uploadId); });
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = result.current.startUploads([file()], 'c', 's'); });
    await waitFor(() => expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce());
    act(() => { b = result.current.startUploads([file()], 'c2', 's2'); });
    await waitFor(() => expect(f.ports.uploadReservedFile).toHaveBeenCalledTimes(2));
    await act(async () => { old.resolve(); await a; });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({ busy: true, category: 'c2' });
    await act(async () => { fresh.resolve(); await b; });
});
it('같은 UID의 직원 전환은 숨겨진 이전 작업의 직접 재시도도 차단한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('upload'));
    const { result, rerender } = renderHook(({ employeeId }) => useDocumentTransfers({ ...f.options, employeeId }), { initialProps: { employeeId: 'employee' } });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    const id = result.current.jobs[0].jobId;
    f.metadata.list.mockResolvedValueOnce([]);
    rerender({ employeeId: 'new' });
    expect(result.current.jobs).toHaveLength(0);
    await act(() => result.current.resume(id));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
    rerender({ employeeId: 'employee' });
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
});
it('URL ACK 뒤 미송신 metadata는 복귀 후 이어가고 URL을 다시 받지 않는다', async () => {
    const f = fixture(), gate = deferred<void>(), original = f.metadata.command.getMockImplementation()!;
    let paused = false;
    f.metadata.command.mockImplementation(async (...args) => {
        const response = await original(...args);
        if (args[2] === 'inspect' && f.uploaded.size && !paused) {
            paused = true;
            await gate.promise;
        }
        return response;
    });
    const { result, rerender } = renderHook(({ uid }) => useDocumentTransfers({ ...f.options, actorUid: uid }), { initialProps: { uid: 'A' } });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    let run!: Promise<void>;
    act(() => { run = result.current.startUploads([file()], 'c', 's'); });
    await waitFor(() => expect(paused).toBe(true));
    auth.currentUser.uid = 'B';
    rerender({ uid: 'B' });
    await act(async () => { gate.resolve(); await run; });
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(0);
    auth.currentUser.uid = 'A';
    rerender({ uid: 'A' });
    await waitFor(() => expect(result.current.jobs[0]?.stage).toBe('metadata'));
    await act(() => result.current.resume(result.current.jobs[0].jobId));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
    expect(result.current.jobs).toHaveLength(0);
});
it('목록 송신 전 검증 거절은 원인과 미송신 단계를 유지한다', async () => {
    const f = fixture();
    f.metadata.prepare.mockRejectedValueOnce(new DocumentTransferNotStartedError('관리자 직원 정보를 확인해 주세요.'));
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    expect(f.metadata.command).not.toHaveBeenCalled();
    expect(f.ports.uploadReservedFile).not.toHaveBeenCalled();
    expect(result.current.message).toContain('관리자 직원 정보');
    await act(() => result.current.startUploads([file()], 'c', 's'));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
});
it('최초 보관조회 대기·실패 동안 새송신0이며 명시재조회뒤만 작성한다', async () => {
    const f = fixture(), gate = deferred<DocumentMetadataEntry[]>();
    f.metadata.list.mockImplementationOnce(() => gate.promise);
    const { result } = renderHook(() => useDocumentTransfers(f.options));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    expect(f.metadata.prepare).not.toHaveBeenCalled();
    await act(async () => { gate.resolve([]); });
    await waitFor(() => expect(result.current.readLoading).toBe(false));
    await act(() => result.current.startUploads([file()], 'c', 's'));
    expect(f.metadata.prepare).toHaveBeenCalledOnce();
});
it('재시작은 File없이 서버조회부터 하고 같은SHA 파일명시재선택뒤만 전송한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const first = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(first.result.current.readLoading).toBe(false));
    await act(() => first.result.current.startUploads([file()], 'c', 's'));
    first.unmount();
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    const id = view.result.current.jobs[0].jobId;
    expect(view.result.current.jobs[0].requiresFile).toBe(true);
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
    vi.mocked(assertDocumentFileIdentity).mockRejectedValueOnce(new DocumentTransferNotStartedError('다른 파일'));
    await act(() => view.result.current.resume(id, new File(['wrong'], '원문.pdf')));
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.jobs[0].requiresFile).toBe(true);
    expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce();
    await act(() => view.result.current.resume(id, file()));
    expect(f.ports.uploadReservedFile).toHaveBeenCalledTimes(2);
});
it('inspect는verified라도 자동apply0이며 부분정리실패의 원인과복구를 유지한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], 'c', 's'));
    const id = view.result.current.jobs[0].jobId;
    f.statuses.set(id, { status: 'active', uploadStatus: 'verified' });
    await act(() => view.result.current.inspect(id));
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(0);
    const entry = f.entries.get(id)!;
    f.metadata.command.mockResolvedValueOnce({ result: { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'applied', uploadStatus: 'verified', cleanupStatus: 'not-required', message: '업무완료' }, copyMismatch: false, cleanupFailed: true, message: '업무완료 / 사본정리 실패. 다시 저장하지 마세요.' });
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.jobs[0]).toMatchObject({ canRetry: false, canDiscard: true });
    expect(view.result.current.jobs[0].message).toContain('사본정리 실패');
});
it('같은ID 다른사본·손상 서버applied는 현재완료가 아니며 명시정리만한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], 'c', 's'));
    const job = view.result.current.jobs[0], entry = f.entries.get(job.jobId)!;
    f.metadata.command.mockResolvedValueOnce({ result: { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'applied', uploadStatus: 'verified', cleanupStatus: 'not-required', message: '서버다른원문완료' }, copyMismatch: true, cleanupFailed: false, message: '다른 사본이 서버에 완료됨' });
    await act(() => view.result.current.inspect(job.jobId));
    expect(view.result.current.jobs).toHaveLength(1);
    expect(view.result.current.jobs[0].canRetry).toBe(false);
    await act(() => view.result.current.discardCopy(job.jobId, entry.observedLocalText));
    expect(f.metadata.discard).toHaveBeenCalledWith(expect.anything(), entry.reference, entry.observedLocalText, expect.any(Function), entry.key);
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(0);
});
it('이전render의 저장·삭제함수를 같은UID 다른회사직원에서 호출해도송신0이다', async () => {
    const f = fixture(), view = renderHook(({ employeeId }) => useDocumentTransfers({ ...f.options, employeeId }), { initialProps: { employeeId: 'employee' } });
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    const old = view.result.current;
    view.rerender({ employeeId: 'other' });
    await act(() => old.startUploads([file()], 'c', 's'));
    await act(() => old.deleteDocument(doc));
    expect(f.metadata.prepare).not.toHaveBeenCalled();
    expect(f.metadata.open).not.toHaveBeenCalled();
});
it('삭제확인대기 동기중복은하나만열고 회사직원변경후결과는폐기한다', async () => {
    const f = fixture(), gate = deferred<boolean>(), confirm = vi.fn(() => gate.promise), view = renderHook(({ employeeId }) => useDocumentTransfers({ ...f.options, employeeId, confirm }), { initialProps: { employeeId: 'employee' } });
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = view.result.current.deleteDocument(doc); b = view.result.current.deleteDocument(doc); });
    expect(confirm).toHaveBeenCalledOnce();
    view.rerender({ employeeId: 'other' });
    await act(async () => { gate.resolve(true); await Promise.all([a, b]); });
    expect(f.metadata.open).not.toHaveBeenCalled();
});
it('빈서버페이지의cursor를유지하고원문없는active는조회중단만허용한다', async () => {
    const f = fixture(), ref = { companyId: 'taebaek' as const, documentId: 'server-doc', planId: 'server-plan' };
    const result: DocumentMetadataResult = { version: 1, reference: ref, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'active', uploadStatus: 'reserved', cleanupStatus: 'not-required', message: '예약만 존재' };
    f.metadata.listPending.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [], nextCursor: 'cursor' }).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [{ result, label: '서버 원본.pdf' }], nextCursor: null });
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    expect(view.result.current.historyMore).toBe(true);
    expect(view.result.current.message).toContain('0건');
    await act(() => view.result.current.nextPage());
    expect(f.metadata.listPending).toHaveBeenLastCalledWith(expect.anything(), 'cursor', expect.any(Function));
    expect(view.result.current.jobs[0]).toMatchObject({ fileName: '서버 원본.pdf', canRetry: false, canCancel: true, canDiscard: false, observedLocalText: null });
    expect(f.metadata.prepare).not.toHaveBeenCalled();
    f.metadata.command.mockResolvedValueOnce({ result, copyMismatch: false, cleanupFailed: false, message: '예약' });
    await act(() => view.result.current.resume(view.result.current.jobs[0].jobId));
    expect(f.metadata.command.mock.calls.map(c => c[2])).toEqual(['inspect']);
});
it('no-local applied cleanup pending은copyMismatch관측뒤에도정리만가능하고새apply0이다', async () => {
    const f = fixture(), ref = { companyId: 'taebaek' as const, documentId: 'server-doc', planId: 'server-plan' }, result: DocumentMetadataResult = { version: 1, reference: ref, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'applied', uploadStatus: 'verified', cleanupStatus: 'pending', message: '문서완료 파일정리필요' };
    f.metadata.listPending.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [{ result, label: '서버 정리.pdf' }], nextCursor: null });
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    const id = view.result.current.jobs[0].jobId;
    f.metadata.command.mockResolvedValueOnce({ result, copyMismatch: true, cleanupFailed: false, message: '원문없는 서버완료' });
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.jobs[0]).toMatchObject({ stage: 'cleanup', canRetry: true, canCancel: false, canDiscard: false });
    f.metadata.command.mockResolvedValueOnce({ result: { ...result, cleanupStatus: 'deleted' }, copyMismatch: true, cleanupFailed: false, message: '파일정리완료' });
    await act(() => view.result.current.retryCleanup(id));
    expect(view.result.current.jobs[0]).toMatchObject({ stage: 'terminal', canRetry: false });
    expect(f.metadata.command.mock.calls.map(c => c[2])).toEqual(['inspect', 'cleanup']);
    expect(f.metadata.prepare).not.toHaveBeenCalled();
});
it('로컬과서버동일ref는한행이며회사직원전환뒤옛페이지응답은폐기한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const view = renderHook(({ employeeId }) => useDocumentTransfers({ ...f.options, employeeId }), { initialProps: { employeeId: 'employee' } });
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], 'c', 's'));
    const entry = [...f.entries.values()][0], result: DocumentMetadataResult = { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'active', uploadStatus: 'reserved', cleanupStatus: 'not-required', message: '보관' };
    f.metadata.listPending.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [{ result, label: '동일원문' }], nextCursor: 'next' });
    await act(() => view.result.current.refresh());
    expect(view.result.current.jobs).toHaveLength(1);
    const gate = deferred<Awaited<ReturnType<typeof f.metadata.listPending>>>();
    f.metadata.listPending.mockImplementationOnce(() => gate.promise);
    let old!: Promise<void>;
    act(() => { old = view.result.current.nextPage(); });
    f.metadata.list.mockResolvedValueOnce([]);
    view.rerender({ employeeId: 'other' });
    await act(async () => { gate.resolve({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [{ result, label: '옛자료' }], nextCursor: 'old' }); await old; });
    expect(view.result.current.jobs).toHaveLength(0);
    expect(view.result.current.historyMore).toBe(false);
});
it('같은key A에서B로교체한관측은이름분류와정리raw를함께바꾸고옛File은재사용하지않는다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], 'A분류', 'A중분류'));
    const id = view.result.current.jobs[0].jobId, entry = f.entries.get(id)!;
    if (entry.request?.action !== 'create')
        throw Error('create fixture');
    const changed: DocumentMetadataEntry = { ...entry, description: 'B 원문.pdf', requestHash: 'b'.repeat(64), observedLocalText: 'B-관측원문', request: { ...entry.request, metadata: { ...entry.request.metadata, fileName: 'B 원문.pdf', category: 'B분류', subCategory: 'B중분류' }, upload: { ...entry.request.upload, sha256: 'b'.repeat(64) } } };
    f.entries.set(id, changed);
    const result: DocumentMetadataResult = { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'applied', uploadStatus: 'verified', cleanupStatus: 'not-required', message: 'A서버완료' };
    f.metadata.command.mockResolvedValueOnce({ result: { ...result, status: 'active', requestHash: 'b'.repeat(64), uploadStatus: 'reserved' }, copyMismatch: false, cleanupFailed: false, message: 'B예약' });
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.jobs[0]).toMatchObject({ fileName: 'B 원문.pdf', category: 'B분류', subCategory: 'B중분류', observedLocalText: 'B-관측원문', requiresFile: true });
    f.metadata.command.mockResolvedValueOnce({ result, copyMismatch: true, cleanupFailed: false, message: '다른 원문 완료' });
    await act(() => view.result.current.inspect(id));
    await act(() => view.result.current.discardCopy(id, view.result.current.jobs[0].observedLocalText!));
    expect(f.metadata.discard).toHaveBeenCalledWith(expect.anything(), entry.reference, 'B-관측원문', expect.any(Function), entry.key);
});
it('다른사본서버rejected라도남은파일정리는가능하고업무apply와사본삭제는하지않는다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], 'c', 's'));
    const id = view.result.current.jobs[0].jobId, entry = f.entries.get(id)!, result: DocumentMetadataResult = { version: 1, reference: entry.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'rejected', uploadStatus: 'verified', cleanupStatus: 'pending', message: '등록거절·파일정리필요' };
    f.metadata.command.mockResolvedValueOnce({ result, copyMismatch: true, cleanupFailed: false, message: '다른 원문 서버거절' });
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.jobs[0]).toMatchObject({ stage: 'cleanup', canRetry: true, canDiscard: false, canCancel: false });
    f.metadata.command.mockResolvedValueOnce({ result: { ...result, cleanupStatus: 'deleted' }, copyMismatch: true, cleanupFailed: false, message: '파일정리만완료' });
    await act(() => view.result.current.retryCleanup(id));
    expect(view.result.current.jobs[0]).toMatchObject({ stage: 'terminal', canRetry: false, canDiscard: true });
    expect(f.metadata.discard).not.toHaveBeenCalled();
    expect(f.metadata.command.mock.calls.filter(c => c[2] === 'apply')).toHaveLength(0);
});
it('정상 완료·거절·중단 이력만 있으면 실패0이고 처리 기록으로만 보여준다', async () => {
    const f = fixture();
    const entries = (['applied', 'rejected', 'cancelled'] as const).map((status, index) => ({
        label: `처리 기록 ${index}`,
        result: { version: 1 as const, reference: { companyId: 'taebaek' as const, documentId: `done-${index}`, planId: `done-plan-${index}` }, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status, uploadStatus: 'verified' as const, cleanupStatus: 'not-required' as const, message: '서버 결과: 처리가 끝났습니다.' }
    }));
    f.metadata.listPending.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries, nextCursor: null });
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    expect(view.result.current.failureCount).toBe(0);
    expect(view.result.current.failureRows).toHaveLength(0);
    expect(view.result.current.historyRows).toHaveLength(3);
    expect(view.result.current.historyRows.map(row => row.currentState)).toEqual(['문서 처리가 완료됐습니다.', '문서 요청이 거절됐습니다.', '문서 요청을 중단했습니다.']);
    expect(view.result.current.historyRows.every(row => !row.cause.includes('서버 결과:'))).toBe(true);
    expect(view.result.current.jobs[0].message).toBe('서버 결과: 처리가 끝났습니다.');
    expect(f.metadata.prepare).not.toHaveBeenCalled();
});
it('정상 전송 중에는 실패0이고 멈춘 파일만 실패로 집계하며 원인과 다음 행동을 표시한다', async () => {
    const f = fixture(), gate = deferred<void>();
    vi.mocked(f.ports.uploadReservedFile).mockImplementationOnce(async () => { await gate.promise; throw Error('연결이 끊겼습니다.'); });
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    let run!: Promise<void>;
    act(() => { run = view.result.current.startUploads([file()], '업무용', '원문'); });
    await waitFor(() => expect(f.ports.uploadReservedFile).toHaveBeenCalledOnce());
    expect(view.result.current.failureCount).toBe(0);
    expect(view.result.current.historyRows[0].currentState).toBe('문서 요청을 처리하고 있습니다.');
    await act(async () => { gate.resolve(); await run; });
    expect(view.result.current.failureCount).toBe(1);
    expect(view.result.current.failureRows[0].cause).toContain('연결이 끊겼습니다.');
    expect(view.result.current.failureRows[0].nextAction).toContain('같은 요청의 결과');
});
it('서버에서 발견한 미완료와 실제 남은 파일 정리만 실패이고 정리 완료 후에는 기록이 된다', async () => {
    const f = fixture();
    const make = (planId: string, status: DocumentMetadataResult['status'], cleanupStatus: DocumentMetadataResult['cleanupStatus']): DocumentMetadataResult => ({ version: 1, reference: { companyId: 'taebaek', documentId: planId, planId }, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status, uploadStatus: 'verified', cleanupStatus, message: '문서 처리는 끝났고 다른 문서의 파일을 보존했습니다.' });
    const active = make('active', 'active', 'not-required'), pending = make('cleanup', 'rejected', 'pending'), shared = make('shared', 'applied', 'retained-shared');
    f.metadata.listPending.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [{ result: active, label: '미완료' }, { result: pending, label: '정리 필요' }, { result: shared, label: '보존 완료' }], nextCursor: null });
    const view = renderHook(() => useDocumentTransfers(f.options));
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    expect(view.result.current.failureCount).toBe(2);
    expect(view.result.current.historyRows.map(row => row.job.fileName)).toEqual(['보존 완료']);
    const row = view.result.current.failureRows.find(row => row.job.documentId === 'cleanup')!;
    expect(row.currentState).toContain('거절');
    expect(row.nextAction).toContain('파일 정리만');
    for (const status of ['unknown', 'active'] as const) {
        f.metadata.command.mockResolvedValueOnce({ result: { ...pending, status }, copyMismatch: true, cleanupFailed: false, message: '파일 정리 상태를 확인하고 있습니다.' });
        await act(() => view.result.current.inspect(row.job.jobId));
        const unresolved = view.result.current.failureRows.find(value => value.job.jobId === row.job.jobId)!;
        expect(unresolved.currentState).toBe('문서 처리 결과 확인과 남은 파일 정리가 필요합니다.');
        expect(unresolved.currentState).not.toContain('끝났');
    }
    f.metadata.command.mockResolvedValueOnce({ result: { ...pending, cleanupStatus: 'deleted' }, copyMismatch: true, cleanupFailed: false, message: '남은 파일을 정리했습니다.' });
    await act(() => view.result.current.retryCleanup(row.job.jobId));
    expect(view.result.current.failureCount).toBe(1);
    expect(view.result.current.historyRows).toHaveLength(2);
    expect(f.metadata.command.mock.calls.map(call => call[2])).toEqual(['inspect', 'inspect', 'cleanup']);
});
it('다른 원문 완료의 기기 사본은 실패로 남기고 표시 문구만 바꾸며 회사직원 전환 때 숨긴다', async () => {
    const f = fixture();
    vi.mocked(f.ports.uploadReservedFile).mockRejectedValueOnce(Error('연결 끊김'));
    const view = renderHook(({ employeeId }) => useDocumentTransfers({ ...f.options, employeeId }), { initialProps: { employeeId: 'employee' } });
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(() => view.result.current.startUploads([file()], '업무', '원문'));
    const job = view.result.current.jobs[0];
    const result: DocumentMetadataResult = { version: 1, reference: job.reference!, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'applied', uploadStatus: 'verified', cleanupStatus: 'not-required', message: '문서 등록 완료' };
    const raw = '서버 결과: 문서 등록 완료\n기기 원문이 달라 이 사본을 정리하지 않았습니다.';
    f.metadata.command.mockResolvedValueOnce({ result, copyMismatch: true, cleanupFailed: false, message: raw });
    await act(() => view.result.current.inspect(job.jobId));
    expect(view.result.current.failureCount).toBe(1);
    expect(view.result.current.failureRows[0].currentState).toContain('기기에 남은 사본');
    expect(view.result.current.failureRows[0].cause).not.toContain('서버 결과:');
    expect(view.result.current.failureRows[0].cause).toContain('기기 원문이 달라');
    expect(view.result.current.jobs[0].message).toBe(raw);
    expect(f.metadata.discard).not.toHaveBeenCalled();
    auth.currentUser.uid = 'B';
    view.rerender({ employeeId: 'other' });
    expect(view.result.current.failureCount).toBe(0);
    expect(view.result.current.historyRows).toHaveLength(0);
});
