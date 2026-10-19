import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const DOCUMENT_CATEGORY_OPERATIONS = 'documentCategoryOperations';
export const DOCUMENT_CATEGORY_FENCES = 'documentCategoryFences';
export const DOCUMENT_DEFAULT_CATEGORIES = ['직원용', '업무용', '거래처용'] as const;
export interface DocumentCategoryReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
}
export interface DocumentCategoryScope {
    companyId: string;
    actorUid: string;
    employeeId: string;
}
interface Base {
    version: 1;
    reference: DocumentCategoryReference;
}
export type DocumentCategoryRequest = (Base & {
    action: 'createCategory';
    categoryId: string;
    name: string;
    order: number;
    createdAt: string;
}) | (Base & {
    action: 'createSubCategory';
    subCategoryId: string;
    category: string;
    name: string;
    order: number;
    createdAt: string;
}) | (Base & {
    action: 'deleteCategory' | 'deleteSubCategory';
    targetId: string;
    opening: CatalogValue;
}) | (Base & {
    action: 'seedDefaults';
    categoryIds: [
        string,
        string,
        string
    ];
    createdAt: string;
}) | (Base & {
    action: 'ensurePath';
    categoryId: string;
    subCategoryId: string;
    category: string;
    subCategory: string;
    createdAt: string;
});
export interface DocumentCategoryResult {
    version: 1;
    reference: DocumentCategoryReference;
    actorUid: string;
    employeeId: string;
    requestHash: string | null;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    message: string;
}
export interface DocumentCategoryPendingResult {
    version: 1;
    companyId: 'taebaek' | 'punghoe';
    actorUid: string;
    employeeId: string;
    entries: {
        result: DocumentCategoryResult;
        label: string;
    }[];
    nextCursor: string | null;
}
export type DocumentCategoryCommand = {
    mode: 'apply';
    request: DocumentCategoryRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: DocumentCategoryReference;
} | {
    mode: 'listPending';
    companyId: 'taebaek' | 'punghoe';
    cursor?: string;
};
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('문서 분류 요청 형식을 확인해 주세요.');
}
const codec: CatalogValueAdapter = {
    special: () => undefined, timestamp: () => ({}), reference: () => ({}), geo: () => ({}), bytes: () => ({})
};
export function documentCategoryOpening(row: object, kind: 'category' | 'subCategory'): CatalogValue {
    const fields = kind === 'category' ? ['name'] : ['category', 'name'];
    return encodeCatalogValue(Object.fromEntries(fields.filter(k => Object.prototype.hasOwnProperty.call(row, k)).map(k => [k, (row as Record<string, unknown>)[k]])));
}
export function normalizeDocumentCategoryReference(v: unknown): DocumentCategoryReference {
    exact(v, ['companyId', 'planId']);
    if (!['taebaek', 'punghoe'].includes(String(v.companyId)) || !cleanupValidId(v.planId))
        throw Error('분류의 회사·요청 번호를 확인해 주세요.');
    return {
        companyId: v.companyId as DocumentCategoryReference['companyId'], planId: v.planId
    };
}
export function normalizeDocumentCategoryRequest(v: unknown): DocumentCategoryRequest {
    exact(v, ['version', 'reference', 'action', 'categoryId', 'subCategoryId', 'targetId', 'name', 'category', 'subCategory', 'order', 'createdAt', 'categoryIds', 'opening']);
    const reference = normalizeDocumentCategoryReference(v.reference), base = {
        version: 1 as const, reference
    };
    const fields: Record<string, string[]> = {
        createCategory: ['categoryId', 'name', 'order', 'createdAt'], createSubCategory: ['subCategoryId', 'category', 'name', 'order', 'createdAt'], deleteCategory: ['targetId', 'opening'], deleteSubCategory: ['targetId', 'opening'], seedDefaults: ['categoryIds', 'createdAt'], ensurePath: ['categoryId', 'subCategoryId', 'category', 'subCategory', 'createdAt']
    };
    if (v.version !== 1 || typeof v.action !== 'string' || !Object.prototype.hasOwnProperty.call(fields, v.action) || Object.keys(v).some(k => !['version', 'reference', 'action', ...fields[v.action as string]].includes(k)))
        throw Error('분류 처리 종류와 원문 필드를 확인해 주세요.');
    if (fields[v.action].some(k => !Object.prototype.hasOwnProperty.call(v, k)))
        throw Error('최초 분류 요청의 필수 필드를 보존해 주세요.');
    for (const key of fields[v.action]) {
        const value = v[key];
        if (key.endsWith('Id') && !cleanupValidId(value))
            throw Error('분류의 고정 번호를 확인해 주세요.');
        if (['name', 'category', 'subCategory'].includes(key) && (typeof value !== 'string' || !value.trim()))
            throw Error('분류 이름을 입력해 주세요.');
    }
    if ('createdAt' in v && (typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))))
        throw Error('최초 분류 작성 시각을 보존해 주세요.');
    if ('order' in v && (typeof v.order !== 'number' || !Number.isSafeInteger(v.order) || v.order < 0))
        throw Error('분류 표시 순서를 확인해 주세요.');
    if (v.action === 'seedDefaults' && (!Array.isArray(v.categoryIds) || v.categoryIds.length !== 3 || v.categoryIds.some(id => !cleanupValidId(id)) || new Set(v.categoryIds).size !== 3))
        throw Error('기본 분류의 고정 번호 세 개를 확인해 주세요.');
    if (v.action === 'deleteCategory' || v.action === 'deleteSubCategory') {
        const raw = decodeCatalogValue(v.opening, codec);
        exact(raw, v.action === 'deleteCategory' ? ['name'] : ['category', 'name']);
        if (typeof raw.name !== 'string' || !raw.name || (v.action === 'deleteSubCategory' && (typeof raw.category !== 'string' || !raw.category)))
            throw Error('선택한 분류의 원래 이름을 확인해 주세요.');
    }
    const result = {
        ...base, action: v.action, ...Object.fromEntries(fields[v.action].map(k => [k, v[k]]))
    } as DocumentCategoryRequest;
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024)
        throw Error('분류 요청 원문이 너무 큽니다.');
    return result;
}
export const serializeDocumentCategoryRequest = (v: DocumentCategoryRequest) => JSON.stringify(normalizeDocumentCategoryRequest(v));
export function normalizeDocumentCategoryResult(v: unknown, reference: DocumentCategoryReference, actorUid: string, employeeId: string, expectedHash?: string): DocumentCategoryResult {
    exact(v, ['version', 'reference', 'actorUid', 'employeeId', 'requestHash', 'status', 'message']);
    const actual = normalizeDocumentCategoryReference(v.reference);
    if (v.version !== 1 || JSON.stringify(actual) !== JSON.stringify(normalizeDocumentCategoryReference(reference)) || v.actorUid !== actorUid || v.employeeId !== employeeId || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(v.status)) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash)) || (expectedHash !== undefined && v.requestHash !== null && expectedHash !== v.requestHash))
        throw Error('분류 처리 응답의 회사·계정·직원·원문 근거를 확인하지 못했습니다.');
    return v as unknown as DocumentCategoryResult;
}
export function normalizeDocumentCategoryPendingResult(v: unknown, companyId: string, actorUid: string, employeeId: string): DocumentCategoryPendingResult {
    exact(v, ['version', 'companyId', 'actorUid', 'employeeId', 'entries', 'nextCursor']);
    if (v.version !== 1 || v.companyId !== companyId || v.actorUid !== actorUid || v.employeeId !== employeeId || !Array.isArray(v.entries) || v.entries.length > 50 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(v.nextCursor))))
        throw Error('분류 처리 목록의 조회 범위를 확인하지 못했습니다.');
    const entries = v.entries.map(entry => {
        exact(entry, ['result', 'label']);
        const ref = normalizeDocumentCategoryReference((entry.result as DocumentCategoryResult)?.reference);
        if (ref.companyId !== companyId || typeof entry.label !== 'string' || !entry.label)
            throw Error('분류 처리 목록의 회사·이름을 확인해 주세요.');
        return {
            result: normalizeDocumentCategoryResult(entry.result, ref, actorUid, employeeId), label: entry.label
        };
    });
    return {
        version: 1, companyId: companyId as DocumentCategoryPendingResult['companyId'], actorUid, employeeId, entries, nextCursor: v.nextCursor as string | null
    };
}
export const decodeDocumentCategoryOpening = (value: CatalogValue): Record<string, unknown> => decodeCatalogValue(value, codec) as Record<string, unknown>;
