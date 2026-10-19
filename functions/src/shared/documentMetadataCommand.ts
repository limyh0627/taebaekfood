import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const DOCUMENT_OPERATIONS = 'documentMetadataOperations';
export const DOCUMENT_UPLOADS = 'documentUploadReservations';
export const DOCUMENT_PATHS = 'documentStoragePaths';
export interface DocumentMetadataReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    documentId: string;
}
export interface DocumentMetadataScope {
    companyId: string;
    actorUid: string;
    employeeId: string;
}
export interface UploadIdentity {
    uploadId: string;
    path: string;
    sha256: string;
    size: number;
    contentType: string;
}
export function documentUploadPath(companyId: string, uploadId: string, fileName: string): string {
    if (!['taebaek', 'punghoe'].includes(companyId) || !cleanupValidId(uploadId))
        throw Error('업로드 회사와 예약 번호를 확인해 주세요.');
    const name = fileName.replace(/[\/#?%]/g, '_');
    if (!name || name === '.' || name === '..')
        throw Error('업로드 파일명을 확인해 주세요.');
    return `companies/${companyId}/file-cabinet/uploads/${uploadId}/${name}`;
}
export interface DocumentCreateMetadata {
    category: string;
    subCategory: string;
    fileName: string;
    note: string;
    uploadedBy: string;
    uploadedAt: string;
}
export type DocumentMetadataRequest = {
    version: 1;
    reference: DocumentMetadataReference;
    action: 'create';
    metadata: DocumentCreateMetadata;
    upload: UploadIdentity;
} | {
    version: 1;
    reference: DocumentMetadataReference;
    action: 'delete';
    expectedVersion: string;
} | {
    version: 1;
    reference: DocumentMetadataReference;
    action: 'note';
    expectedVersion: string;
    note: string;
};
export interface DocumentMetadataResult {
    version: 1;
    reference: DocumentMetadataReference;
    actorUid: string;
    employeeId: string;
    requestHash: string | null;
    status: 'active' | 'applied' | 'rejected' | 'cancelled' | 'unknown';
    uploadStatus: 'not-required' | 'reserved' | 'absent' | 'unverified' | 'verified';
    cleanupStatus: 'not-required' | 'pending' | 'deleted' | 'absent' | 'retained-shared' | 'retained-replaced';
    message: string;
}
export interface DocumentMetadataOpenResult {
    reference: DocumentMetadataReference;
    actorUid: string;
    employeeId: string;
    snapshot: CatalogValue;
    expectedVersion: string;
}
export interface DocumentMetadataPendingResult {
    version: 1;
    companyId: 'taebaek' | 'punghoe';
    actorUid: string;
    employeeId: string;
    entries: {
        result: DocumentMetadataResult;
        label: string;
    }[];
    nextCursor: string | null;
}
export type DocumentMetadataCommand = {
    mode: 'listPending';
    companyId: 'taebaek' | 'punghoe';
    cursor?: string;
} | {
    mode: 'reserveUpload' | 'apply';
    request: DocumentMetadataRequest;
} | {
    mode: 'open';
    reference: DocumentMetadataReference;
    opening: CatalogValue;
} | {
    mode: 'inspect' | 'cancel' | 'cleanup';
    reference: DocumentMetadataReference;
};
export const DOCUMENT_FIELDS = ['category', 'subCategory', 'fileName', 'storagePath', 'downloadUrl', 'size', 'contentType', 'note', 'uploadedBy', 'uploadedAt'] as const;
const own = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
    if (!own(v) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('문서 요청 형식을 확인해 주세요.');
}
export function normalizeDocumentMetadataReference(v: unknown): DocumentMetadataReference {
    exact(v, ['companyId', 'planId', 'documentId']);
    if (!['taebaek', 'punghoe'].includes(String(v.companyId)) || !cleanupValidId(v.planId) || !cleanupValidId(v.documentId))
        throw Error('문서의 회사·요청 번호·문서 번호를 확인해 주세요.');
    return {
        companyId: v.companyId as DocumentMetadataReference['companyId'], planId: v.planId, documentId: v.documentId
    };
}
export function documentMetadataOpening(row: object, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    return encodeCatalogValue(Object.fromEntries(DOCUMENT_FIELDS.filter(k => Object.prototype.hasOwnProperty.call(row, k)).map(k => [k, (row as Record<string, unknown>)[k]])), codec);
}
const validationCodec: CatalogValueAdapter = {
    special: () => undefined, timestamp: () => ({}), reference: () => ({}), geo: () => ({}), bytes: () => ({})
};
export function normalizeDocumentMetadataOpening(value: unknown): CatalogValue {
    exact(decodeCatalogValue(value, validationCodec), DOCUMENT_FIELDS);
    return value as CatalogValue;
}
export function normalizeDocumentMetadataRequest(v: unknown): DocumentMetadataRequest {
    exact(v, ['version', 'reference', 'action', 'metadata', 'upload', 'expectedVersion', 'note']);
    const reference = normalizeDocumentMetadataReference(v.reference);
    if (v.version !== 1 || !['create', 'delete', 'note'].includes(String(v.action)))
        throw Error('문서 처리 종류를 확인해 주세요.');
    if (v.action === 'create') {
        if ('expectedVersion' in v || 'note' in v)
            throw Error('새 문서 요청의 원문을 확인해 주세요.');
        exact(v.metadata, ['category', 'subCategory', 'fileName', 'note', 'uploadedBy', 'uploadedAt']);
        exact(v.upload, ['uploadId', 'path', 'sha256', 'size', 'contentType']);
        const m = v.metadata, u = v.upload;
        if (['category', 'subCategory', 'fileName', 'note', 'uploadedBy', 'uploadedAt'].some(k => typeof m[k] !== 'string') || !String(m.category).trim() || !String(m.subCategory).trim() || !String(m.fileName).trim() || !Number.isFinite(Date.parse(String(m.uploadedAt))))
            throw Error('문서의 분류·파일명·최초 등록 시각을 확인해 주세요.');
        const prefix = `companies/${reference.companyId}/file-cabinet/uploads/${u.uploadId}/`;
        if (!cleanupValidId(u.uploadId) || typeof u.path !== 'string' || !u.path.startsWith(prefix) || u.path !== documentUploadPath(reference.companyId, String(u.uploadId), String(m.fileName)) || !u.path.slice(prefix.length) || u.path.slice(prefix.length).includes('/') || !(/^[a-f0-9]{64}$/).test(String(u.sha256)) || typeof u.size !== 'number' || !Number.isSafeInteger(u.size) || u.size < 0 || u.size > 30 * 1024 * 1024 || typeof u.contentType !== 'string' || !u.contentType)
            throw Error('업로드 원문의 경로·SHA256·크기·파일 형식을 확인해 주세요.');
        return {
            version: 1, reference, action: 'create', metadata: {
                category: m.category as string, subCategory: m.subCategory as string, fileName: m.fileName as string, note: m.note as string, uploadedBy: m.uploadedBy as string, uploadedAt: m.uploadedAt as string
            }, upload: {
                uploadId: u.uploadId, path: u.path, sha256: u.sha256 as string, size: u.size, contentType: u.contentType
            }
        };
    }
    if ('metadata' in v || 'upload' in v || typeof v.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(v.expectedVersion))
        throw Error('열 때 확인한 문서 버전을 보존해 주세요.');
    if (v.action === 'delete') {
        if ('note' in v)
            throw Error('삭제 요청에 메모 변경을 포함할 수 없습니다.');
        return {
            version: 1, reference, action: 'delete', expectedVersion: v.expectedVersion
        };
    }
    if (typeof v.note !== 'string')
        throw Error('문서 메모를 확인해 주세요.');
    return {
        version: 1, reference, action: 'note', expectedVersion: v.expectedVersion, note: v.note
    };
}
export const serializeDocumentMetadataRequest = (v: DocumentMetadataRequest): string => JSON.stringify(normalizeDocumentMetadataRequest(v));
export function normalizeDocumentMetadataResult(v: unknown, reference: DocumentMetadataReference, actorUid: string, employeeId: string, expectedHash?: string): DocumentMetadataResult {
    exact(v, ['version', 'reference', 'actorUid', 'employeeId', 'requestHash', 'status', 'uploadStatus', 'cleanupStatus', 'message']);
    const actual = normalizeDocumentMetadataReference(v.reference);
    if (v.version !== 1 || JSON.stringify(actual) !== JSON.stringify(normalizeDocumentMetadataReference(reference)) || v.actorUid !== actorUid || v.employeeId !== employeeId || !['active', 'applied', 'rejected', 'cancelled', 'unknown'].includes(String(v.status)) || !['not-required', 'reserved', 'absent', 'unverified', 'verified'].includes(String(v.uploadStatus)) || !['not-required', 'pending', 'deleted', 'absent', 'retained-shared', 'retained-replaced'].includes(String(v.cleanupStatus)) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !(/^[a-f0-9]{64}$/).test(v.requestHash)))
        throw Error('문서 응답의 회사·계정·직원·요청 근거를 확인하지 못했습니다.');
    if (expectedHash !== undefined && v.requestHash !== null && v.requestHash !== expectedHash)
        throw Error('문서 응답의 최초 원문 해시가 다릅니다.');
    return v as unknown as DocumentMetadataResult;
}
export function normalizeDocumentMetadataOpenResult(v: unknown, reference: DocumentMetadataReference, actorUid: string, employeeId: string): DocumentMetadataOpenResult {
    exact(v, ['reference', 'actorUid', 'employeeId', 'snapshot', 'expectedVersion']);
    if (JSON.stringify(normalizeDocumentMetadataReference(v.reference)) !== JSON.stringify(normalizeDocumentMetadataReference(reference)) || v.actorUid !== actorUid || v.employeeId !== employeeId || typeof v.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(v.expectedVersion))
        throw Error('문서 열림 응답의 대상·계정·버전을 확인해 주세요.');
    normalizeDocumentMetadataOpening(v.snapshot);
    return v as unknown as DocumentMetadataOpenResult;
}
export function normalizeDocumentMetadataPendingResult(value: unknown, companyId: string, actorUid: string, employeeId: string): DocumentMetadataPendingResult {
    exact(value, ['version', 'companyId', 'actorUid', 'employeeId', 'entries', 'nextCursor']);
    if (value.version !== 1 || value.companyId !== companyId || value.actorUid !== actorUid || value.employeeId !== employeeId || !Array.isArray(value.entries) || value.entries.length > 50 || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(value.nextCursor))))
        throw Error('문서 미완료 목록의 회사·계정·직원·페이지 근거를 확인하지 못했습니다.');
    const entries = value.entries.map(entry => {
        exact(entry, ['result', 'label']);
        if (typeof entry.label !== 'string' || !entry.label)
            throw Error('미완료 문서의 파일명·문서 번호를 확인하지 못했습니다.');
        const ref = normalizeDocumentMetadataReference((entry.result as DocumentMetadataResult)?.reference);
        if (ref.companyId !== companyId)
            throw Error('다른 회사의 문서 목록입니다.');
        const result = normalizeDocumentMetadataResult(entry.result, ref, actorUid, employeeId);
        if (result.status !== 'active' && result.cleanupStatus !== 'pending')
            throw Error('미완료 상태가 아닌 문서 응답입니다.');
        return {
            result, label: entry.label
        };
    });
    return {
        version: 1, companyId: companyId as 'taebaek' | 'punghoe', actorUid, employeeId, entries, nextCursor: value.nextCursor as string | null
    };
}
