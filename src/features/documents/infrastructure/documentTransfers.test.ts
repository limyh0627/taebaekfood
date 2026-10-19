import { beforeEach, it, expect, vi } from 'vitest';
import { cabinetStoragePath } from '../../../shared/companyStoragePath';
import { createDocumentTransferPlan, createDocumentTransferPort, documentFileSha256, assertDocumentFileIdentity, isDocumentTransferNotStarted, DocumentTransferNotStartedError, type DocumentTransferContext, type DocumentTransferDocument } from './documentTransfers';
const mocks = vi.hoisted(() => ({ auth: { currentUser: null as null | {
            uid: string;
            getIdTokenResult: () => Promise<{
                claims: Record<string, unknown>;
            }>;
        } }, token: vi.fn(), upload: vi.fn(), url: vi.fn(), remove: vi.fn(), add: vi.fn(), deleteMetadata: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: mocks.auth, authReady: Promise.resolve(), storage: {} }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ fullPath: path }), uploadBytes: (...args: unknown[]) => mocks.upload(...args), getDownloadURL: (...args: unknown[]) => mocks.url(...args), deleteObject: (...args: unknown[]) => mocks.remove(...args) }));
vi.mock('../../../shared/services/firebaseService', () => ({ addItem: (...args: unknown[]) => mocks.add(...args), deleteItem: (...args: unknown[]) => mocks.deleteMetadata(...args) }));
const scope = { companyId: 'taebaek' as const, actorUid: 'auth-A', employeeId: 'employee-A' };
const ctx = (): DocumentTransferContext => ({ scope: { ...scope }, isCurrent: () => true });
const plan = () => createDocumentTransferPlan(scope, new File(['data'], '원본?#%.pdf', { type: 'application/pdf' }), '업무용', '원본분류', '업로더', { id: () => 'fixed-doc', now: () => new Date('2026-10-19T00:00:00.000Z') });
const document = (): DocumentTransferDocument => ({ id: 'fixed-doc', companyId: 'taebaek', category: '업무용', subCategory: '원본분류', fileName: '원본.pdf', storagePath: plan().path, downloadUrl: 'https://example.com/file', size: 4, contentType: 'application/pdf', uploadedBy: '업로더', uploadedAt: '원날짜' });
const identity = async (file: File) => ({ uploadId: 'fixed-upload', path: 'companies/taebaek/file-cabinet/uploads/fixed-upload/file.pdf', sha256: await documentFileSha256(file), size: file.size, contentType: file.type || 'application/octet-stream' });
beforeEach(() => {
    vi.clearAllMocks();
    mocks.token.mockResolvedValue({ claims: { companyId: 'taebaek', employeeId: 'employee-A', isAdmin: true } });
    mocks.auth.currentUser = { uid: 'auth-A', getIdTokenResult: () => mocks.token() };
    mocks.upload.mockResolvedValue(undefined);
    mocks.url.mockResolvedValue('https://example.com/fixed');
    mocks.add.mockResolvedValue('fixed-doc');
    mocks.deleteMetadata.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
});
it('원File·분류·이름·시각·ID·cabinet 경로를 한 번 고정하고 입력 scope 변경과 분리한다', () => {
    const mutable = { ...scope }, file = new File(['원본'], '원본?#%.pdf');
    const fixed = createDocumentTransferPlan(mutable, file, '업무용', '원본분류', '작성자', { id: () => 'fixed-doc', now: () => new Date('2026-10-19T00:00:00.000Z') });
    mutable.actorUid = '다른UID';
    expect(fixed.file).toBe(file);
    expect(fixed.scope.actorUid).toBe('auth-A');
    expect(Object.isFrozen(fixed)).toBe(true);
    expect(fixed.path).toBe(cabinetStoragePath('taebaek', '업무용', '원본분류', '1792368000000_fixed-doc_원본___.pdf'));
    expect(fixed).toMatchObject({ fileName: '원본?#%.pdf', uploadedAt: '2026-10-19T00:00:00.000Z', uploadedBy: '작성자', category: '업무용', subCategory: '원본분류', documentId: 'fixed-doc' });
});
it('각 단계는 고정 자료를 실제 SDK 포트에 전달하고 다른 단계는 자동 실행하지 않는다', async () => {
    const port = createDocumentTransferPort(), fixed = plan(), context = ctx();
    const upload = await identity(fixed.file);
    await port.uploadReservedFile(fixed.file, upload, context);
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({ fullPath: upload.path }, fixed.file, { contentType: upload.contentType, customMetadata: { uploadId: upload.uploadId, sha256: upload.sha256, actorUid: scope.actorUid, employeeId: scope.employeeId } });
    expect(mocks.url).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    await port.getFileUrl(fixed, context);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.url).toHaveBeenCalledExactlyOnceWith({ fullPath: fixed.path });
    expect(port).not.toHaveProperty('createMetadata');
    expect(port).not.toHaveProperty('deleteMetadata');
    expect(port).not.toHaveProperty('cleanupStorage');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.deleteMetadata).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
});
it('실 UID·회사·직원ID·관리자 claim이 다르면 Storage와 metadata를 전송하지 않는다', async () => {
    const port = createDocumentTransferPort();
    for (const claims of [{ companyId: 'punghoe', employeeId: 'employee-A', isAdmin: true }, { companyId: 'taebaek', employeeId: 'auth-A', isAdmin: true }, { companyId: 'taebaek', employeeId: 'employee-A', isAdmin: false }, { companyId: 'taebaek', employeeId: '', isAdmin: true }]) {
        mocks.token.mockResolvedValue({ claims });
        const fixed = plan();
        await expect(port.uploadReservedFile(fixed.file, await identity(fixed.file), ctx())).rejects.toThrow();
    }
    mocks.auth.currentUser = { uid: 'other', getIdTokenResult: () => mocks.token() };
    await expect(port.assertCurrent(ctx())).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
});
it('authReady·token await 사이 UID 또는 owner가 바뀌면 다음 I/O를 시작하지 않는다', async () => {
    const port = createDocumentTransferPort(), context = ctx();
    const fixed = plan(), upload = await identity(fixed.file), pending = port.uploadReservedFile(fixed.file, upload, context);
    mocks.auth.currentUser = { uid: 'B', getIdTokenResult: () => mocks.token() };
    await expect(pending).rejects.toThrow();
    mocks.auth.currentUser = { uid: 'auth-A', getIdTokenResult: () => mocks.token() };
    mocks.token.mockImplementationOnce(async () => { mocks.auth.currentUser = { uid: 'B', getIdTokenResult: () => mocks.token() }; return { claims: { companyId: 'taebaek', employeeId: 'employee-A', isAdmin: true } }; });
    await expect(port.getFileUrl(plan(), context)).rejects.toThrow();
    let current = true;
    mocks.auth.currentUser = { uid: 'auth-A', getIdTokenResult: () => mocks.token() };
    mocks.token.mockImplementationOnce(async () => { current = false; return { claims: { companyId: 'taebaek', employeeId: 'employee-A', isAdmin: true } }; });
    await expect(port.assertCurrent({ scope, isCurrent: () => current })).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.url).not.toHaveBeenCalled();
    expect(mocks.deleteMetadata).not.toHaveBeenCalled();
});
it('각 단계 재개 전 다시 확인하고 실패를 삼키거나 metadata를 자동 재송신하지 않는다', async () => {
    const port = createDocumentTransferPort(), fixed = plan();
    await port.uploadReservedFile(fixed.file, await identity(fixed.file), ctx());
    mocks.auth.currentUser = { uid: 'B', getIdTokenResult: () => mocks.token() };
    await expect(port.getFileUrl(fixed, ctx())).rejects.toThrow();
    expect(mocks.url).not.toHaveBeenCalled();
    mocks.auth.currentUser = { uid: 'auth-A', getIdTokenResult: () => mocks.token() };
    mocks.upload.mockRejectedValueOnce(Error('upload 응답 유실'));
    await expect(port.uploadReservedFile(fixed.file, await identity(fixed.file), ctx())).rejects.toThrow('upload 응답 유실');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(2);
});
it('목록 삭제 전과 파일 정리 모두 빈 경로·다른 회사 prefix를 거절한다', async () => {
    const port = createDocumentTransferPort(), fixed = plan(), upload = await identity(fixed.file);
    for (const path of ['', 'companies/taebaek/file-cabinet/', 'companies/punghoe/file-cabinet/업무/일지/a.pdf', 'companies/taebaek/file-cabinet-other/a.pdf']) {
        await expect(port.uploadReservedFile(fixed.file, { ...upload, path }, ctx())).rejects.toThrow();
    }
    // 삭제와 정리는 서버의 원문/경로 검사를 거치므로 클라이언트 직접 삭제 포트 자체를 제공하지 않는다.
    expect(port).not.toHaveProperty('deleteMetadata');
    expect(port).not.toHaveProperty('cleanupStorage');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteMetadata).not.toHaveBeenCalled();
});
it('이미 없는 Storage 객체만 정리 성공으로 보고 다른 실패는 재시도 근거를 남기도록 전달한다', async () => {
    const port = createDocumentTransferPort(), fixed = plan(), upload = await identity(fixed.file);
    // 업로드 SDK의 not-found도 부재/정리 완료로 해석하지 않는다. 정리 판정은 서버 DTO가 담당한다.
    for (const code of ['storage/object-not-found', 'storage/unauthorized']) {
        mocks.upload.mockRejectedValueOnce({ code });
        await expect(port.uploadReservedFile(fixed.file, upload, ctx())).rejects.toMatchObject({ code });
    }
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteMetadata).not.toHaveBeenCalled();
});
it('송신 전 경로·권한 거절만 typed not-started이고 실제 metadata 오류는 미확정으로 그대로 전달한다', async () => {
    const port = createDocumentTransferPort();
    const fixed = plan(), upload = await identity(fixed.file);
    const pathError = await port.uploadReservedFile(fixed.file, { ...upload, path: '' }, ctx()).catch(error => error);
    expect(isDocumentTransferNotStarted(pathError)).toBe(true);
    expect(pathError.message).toContain('파일 경로');
    expect(mocks.deleteMetadata).not.toHaveBeenCalled();
    mocks.token.mockRejectedValueOnce(Error('token network'));
    const authError = await port.uploadReservedFile(fixed.file, upload, ctx()).catch(error => error);
    expect(authError).toBeInstanceOf(DocumentTransferNotStartedError);
    expect(mocks.add).not.toHaveBeenCalled();
    const sdkError = Object.assign(Error('실제 호출 응답 유실'), { code: 'document-transfer/not-started' });
    mocks.upload.mockRejectedValueOnce(sdkError);
    const actualError = await port.uploadReservedFile(fixed.file, upload, ctx()).catch(error => error);
    expect(actualError).toBe(sdkError);
    expect(isDocumentTransferNotStarted(actualError)).toBe(false);
    expect(mocks.upload).toHaveBeenCalledOnce();
});
it('이름이 같아도 SHA·크기·형식이 다르면 재선택 파일을 송신하지 않는다', async () => {
    const original = plan().file, upload = await identity(original);
    await expect(assertDocumentFileIdentity(new File(['data'], '다른이름.pdf', { type: original.type }), upload)).resolves.toBeUndefined();
    for (const candidate of [new File(['xxxx'], original.name, { type: original.type }), new File(['data'], original.name, { type: 'text/plain' }), new File(['d'], original.name, { type: original.type })])
        await expect(assertDocumentFileIdentity(candidate, upload)).rejects.toThrow('처음 선택한 파일');
    expect(mocks.upload).not.toHaveBeenCalled();
});
