import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, authReady, storage } from '../../../shared/firebase';
import { cabinetStoragePath } from '../../../shared/companyStoragePath';
import type { CabinetDoc, CompanyId } from '../../../shared/types';
/** 이 오류만 해당 단계의 업무 I/O가 시작되지 않았다는 근거다. SDK 실패 코드는 추정하지 않는다. */
export class DocumentTransferNotStartedError extends Error {
    readonly code = 'document-transfer/not-started';
    constructor(message: string) { super(message); this.name = 'DocumentTransferNotStartedError'; }
}
export const isDocumentTransferNotStarted = (error: unknown): error is DocumentTransferNotStartedError => error instanceof DocumentTransferNotStartedError;
export interface DocumentTransferScope {
    companyId: CompanyId;
    actorUid: string;
    employeeId: string;
}
export interface DocumentTransferContext {
    scope: DocumentTransferScope;
    isCurrent: () => boolean;
}
export interface DocumentTransferPlan {
    readonly scope: Readonly<DocumentTransferScope>;
    readonly companyId: CompanyId;
    readonly documentId: string;
    readonly path: string;
    readonly file: File;
    readonly fileName: string;
    readonly category: string;
    readonly subCategory: string;
    readonly uploadedAt: string;
    readonly uploadedBy: string;
    readonly size: number;
    readonly contentType: string;
    readonly note: string;
}
export type DocumentTransferDocument = CabinetDoc;
export interface DocumentTransferPlanOptions {
    id?: () => string;
    now?: () => Date;
}
export interface DocumentUploadIdentity {
    uploadId: string;
    path: string;
    sha256: string;
    size: number;
    contentType: string;
}
/** 새로 고른 File은 이름이 아니라 최초 요청의 바이트 증거와 대조한다. */
export async function documentFileSha256(file: File): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
        .map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function assertDocumentFileIdentity(file: File, identity: DocumentUploadIdentity): Promise<void> {
    if (file.size !== identity.size || (file.type || 'application/octet-stream') !== identity.contentType
        || await documentFileSha256(file) !== identity.sha256)
        throw new DocumentTransferNotStartedError('처음 선택한 파일과 내용·크기·형식이 다릅니다. 같은 원본 파일을 선택해 주세요.');
}
/** File과 분류·ID·경로·날짜는 첫 단계 전에 고정한다. 재개에서 새 자료로 바꾸지 않는다. */
export function createDocumentTransferPlan(scope: DocumentTransferScope, file: File, category: string, subCategory: string, uploadedBy: string, options: DocumentTransferPlanOptions = {}): DocumentTransferPlan {
    if (!category || !subCategory)
        throw new DocumentTransferNotStartedError('업로드할 대분류와 중분류를 선택해 주세요.');
    if (!['taebaek', 'punghoe'].includes(scope.companyId) || !scope.actorUid || !scope.employeeId)
        throw new DocumentTransferNotStartedError('업로드 회사와 로그인 계정을 확인해 주세요.');
    const documentId = options.id?.() ?? `doc-${crypto.randomUUID()}`, date = options.now?.() ?? new Date();
    if (!documentId || documentId.includes('/') || !Number.isFinite(date.getTime()))
        throw new DocumentTransferNotStartedError('고정 문서 번호와 업로드 날짜를 확인해 주세요.');
    const safeName = file.name.replace(/[#?%]/g, '_');
    return Object.freeze({ scope: Object.freeze({ ...scope }), companyId: scope.companyId, documentId, path: cabinetStoragePath(scope.companyId, category, subCategory, `${date.getTime()}_${documentId}_${safeName}`), file, fileName: file.name, category, subCategory, uploadedAt: date.toISOString(), uploadedBy, size: file.size, contentType: file.type || 'application/octet-stream', note: '' });
}
function assertPath(path: string, companyId: CompanyId): void {
    const prefix = `companies/${companyId}/file-cabinet/`;
    if (typeof path !== 'string' || !path.startsWith(prefix) || path.length === prefix.length || path.endsWith('/'))
        throw new DocumentTransferNotStartedError('현재 회사 문서함에 속한 파일 경로만 처리할 수 있습니다.');
}
function sameScope(left: DocumentTransferScope, right: DocumentTransferScope): boolean { return left.companyId === right.companyId && left.actorUid === right.actorUid && left.employeeId === right.employeeId; }
export function createDocumentTransferPort() {
    const assertVisible = (context: DocumentTransferContext): void => {
        if (!context.isCurrent() || !context.scope.actorUid || auth.currentUser?.uid !== context.scope.actorUid)
            throw new DocumentTransferNotStartedError('회사 또는 로그인 화면이 바뀌어 다음 단계를 시작하지 않았습니다.');
    };
    const assertCurrent = async (context: DocumentTransferContext): Promise<void> => {
        try {
            assertVisible(context);
            await authReady;
            assertVisible(context);
            const user = auth.currentUser!;
            const { claims } = await user.getIdTokenResult();
            assertVisible(context);
            if (claims.companyId !== context.scope.companyId || claims.isAdmin !== true || typeof claims.employeeId !== 'string' || !claims.employeeId.trim() || claims.employeeId !== context.scope.employeeId)
                throw new DocumentTransferNotStartedError('현재 회사의 관리자 직원 로그인 정보를 확인해 주세요.');
        }
        catch (error) {
            if (isDocumentTransferNotStarted(error))
                throw error;
            throw new DocumentTransferNotStartedError('로그인 권한을 확인하지 못해 작업을 시작하지 않았습니다. 다시 로그인한 뒤 시도해 주세요.');
        }
    };
    const assertPlan = (plan: DocumentTransferPlan, context: DocumentTransferContext) => {
        if (!sameScope(plan.scope, context.scope) || plan.companyId !== context.scope.companyId)
            throw new DocumentTransferNotStartedError('다른 회사·계정의 업로드 작업입니다.');
        assertPath(plan.path, context.scope.companyId);
    };
    return {
        assertCurrent,
        async uploadReservedFile(file: File, identity: DocumentUploadIdentity, context: DocumentTransferContext): Promise<void> {
            assertPath(identity.path, context.scope.companyId);
            await assertDocumentFileIdentity(file, identity);
            await assertCurrent(context);
            assertVisible(context);
            await uploadBytes(ref(storage, identity.path), file, {
                contentType: identity.contentType,
                customMetadata: { uploadId: identity.uploadId, sha256: identity.sha256, actorUid: context.scope.actorUid, employeeId: context.scope.employeeId }
            });
        },
        async getFileUrl(plan: DocumentTransferPlan, context: DocumentTransferContext): Promise<string> {
            assertPlan(plan, context);
            await assertCurrent(context);
            assertVisible(context);
            return getDownloadURL(ref(storage, plan.path));
        },
    };
}
