import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, authReady, storage } from '../../../shared/firebase';
import { addItem, deleteItem } from '../../../shared/services/firebaseService';
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
        } catch (error) {
            if (isDocumentTransferNotStarted(error)) throw error;
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
        async uploadFile(plan: DocumentTransferPlan, context: DocumentTransferContext): Promise<void> {
            assertPlan(plan, context);
            await assertCurrent(context);
            assertVisible(context);
            await uploadBytes(ref(storage, plan.path), plan.file);
        },
        async getFileUrl(plan: DocumentTransferPlan, context: DocumentTransferContext): Promise<string> {
            assertPlan(plan, context);
            await assertCurrent(context);
            assertVisible(context);
            return getDownloadURL(ref(storage, plan.path));
        },
        async createMetadata(plan: DocumentTransferPlan, url: string, context: DocumentTransferContext): Promise<void> {
            assertPlan(plan, context);
            await assertCurrent(context);
            assertVisible(context);
            // 이 일반 writer의 응답 유실은 서버 영수증으로 확정할 수 없다. 호출자가 자동 재송신하지 않는다.
            await addItem('fileCabinetDocs', { id: plan.documentId, companyId: plan.companyId, category: plan.category, subCategory: plan.subCategory, fileName: plan.fileName, storagePath: plan.path, downloadUrl: url, size: plan.size, contentType: plan.contentType, note: plan.note, uploadedBy: plan.uploadedBy, uploadedAt: plan.uploadedAt });
        },
        async deleteMetadata(document: DocumentTransferDocument, context: DocumentTransferContext): Promise<void> {
            if (document.companyId !== context.scope.companyId)
                throw new DocumentTransferNotStartedError('현재 회사의 서류 정보만 삭제할 수 있습니다.');
            assertPath(document.storagePath, context.scope.companyId);
            await assertCurrent(context);
            assertVisible(context);
            await deleteItem('fileCabinetDocs', document.id);
        },
        async cleanupStorage(path: string, context: DocumentTransferContext): Promise<void> {
            assertPath(path, context.scope.companyId);
            await assertCurrent(context);
            assertVisible(context);
            try {
                await deleteObject(ref(storage, path));
            }
            catch (error) {
                if ((error as {
                    code?: string;
                })?.code !== 'storage/object-not-found')
                    throw error;
            }
        }
    };
}
