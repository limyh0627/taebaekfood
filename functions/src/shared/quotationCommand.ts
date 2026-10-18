import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { documentId } from './documentId';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const QUOTATION_OPERATIONS = 'quotationOperations';
export const QUOTATION_FIELDS = ['id', 'companyId', 'quoteNo', 'date', 'validUntil', 'partnerId', 'partnerName', 'recipientPhone', 'attention', 'deliveryTerms', 'paymentTerms', 'lines', 'totalSupply', 'totalTax', 'totalAmount', 'totalCost', 'note', 'createdAt', 'createdBy'] as const;
export interface QuotationReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
}
export interface QuotationRequest {
    version: 1;
    reference: QuotationReference;
    action: 'create' | 'update' | 'delete';
    expectedVersion: string | null;
    snapshot?: CatalogValue;
}
export interface QuotationResult {
    version: 1;
    reference: QuotationReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export interface QuotationOpenResult {
    reference: QuotationReference;
    actorUid: string;
    snapshot: CatalogValue;
    expectedVersion: string;
}
export type QuotationCommand = {
    mode: 'open';
    reference: QuotationReference;
    opening: CatalogValue;
} | {
    mode: 'apply';
    request: QuotationRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: QuotationReference;
    requestHash?: string;
};
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> { if (!record(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw Error('견적 요청 형식을 확인해 주세요.'); }
/** 화면이 소유한 상위 필드만 비교하고 줄의 미지 필드는 원형대로 보존한다. */
export function quotationSnapshot(row: object, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    return encodeCatalogValue(Object.fromEntries(QUOTATION_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, (row as Record<string, unknown>)[key]])), codec);
}
export function quotationOpening(row: object, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    const fields = QUOTATION_FIELDS.filter(key => key !== 'id' && key !== 'companyId');
    return encodeCatalogValue(Object.fromEntries(fields.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, (row as Record<string, unknown>)[key]])), codec);
}
export function normalizeQuotationReference(value: unknown): QuotationReference {
    exact(value, ['companyId', 'planId', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !documentId(value.targetId))
        throw Error('견적의 회사·요청 번호·대상을 확인해 주세요.');
    return { companyId: value.companyId as QuotationReference['companyId'], planId: value.planId, targetId: value.targetId };
}
const validationCodec: CatalogValueAdapter = { special: () => undefined, timestamp: () => ({}), reference: () => ({}), geo: () => ({}), bytes: () => ({}) };
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const nativeVersion = (value: unknown): value is string => typeof value === 'string' && /^\d+:\d{9}$/.test(value);
export function normalizeQuotationOpening(value: unknown): CatalogValue {
    const raw = decodeCatalogValue(value, validationCodec);
    exact(raw, QUOTATION_FIELDS.filter(key => key !== 'id' && key !== 'companyId'));
    return value as CatalogValue;
}
/** 열림·복제는 과거 원문을 보존한다. 새 저장의 필수 필드 검사는 별도로 수행한다. */
export function decodeQuotationOpenSnapshot(value: CatalogValue, codec: CatalogValueAdapter = validationCodec): Record<string, unknown> {
    const raw = decodeCatalogValue(value, codec);
    exact(raw, QUOTATION_FIELDS);
    return raw;
}
export function decodeQuotationSnapshot(value: CatalogValue, codec: CatalogValueAdapter = validationCodec): Record<string, unknown> {
    const raw = decodeCatalogValue(value, codec);
    exact(raw, QUOTATION_FIELDS);
    for (const key of ['id', 'companyId', 'quoteNo', 'date', 'partnerId', 'partnerName', 'createdAt'])
        if (typeof raw[key] !== 'string')
            throw Error('견적의 기본 필드 형식을 확인해 주세요.');
    for (const key of ['validUntil', 'recipientPhone', 'attention', 'deliveryTerms', 'paymentTerms', 'note', 'createdBy'])
        if (key in raw && typeof raw[key] !== 'string')
            throw Error('견적의 선택 필드 형식을 확인해 주세요.');
    for (const key of ['totalSupply', 'totalTax', 'totalAmount'])
        if (!finite(raw[key]))
            throw Error('견적 합계 형식을 확인해 주세요.');
    if ('totalCost' in raw && !finite(raw.totalCost))
        throw Error('견적 원가 형식을 확인해 주세요.');
    if (!Array.isArray(raw.lines))
        throw Error('견적 품목 형식을 확인해 주세요.');
    for (const line of raw.lines) {
        if (!record(line) || typeof line.name !== 'string' || typeof line.spec !== 'string' || !finite(line.qty) || !finite(line.price))
            throw Error('견적 품목의 이름·규격·수량·단가 형식을 확인해 주세요.');
        for (const key of ['itemId', 'unit', 'note'])
            if (key in line && typeof line[key] !== 'string')
                throw Error('견적 품목의 선택 필드 형식을 확인해 주세요.');
        if ('cost' in line && !finite(line.cost) || 'isTaxExempt' in line && typeof line.isTaxExempt !== 'boolean')
            throw Error('견적 품목의 원가·과세 형식을 확인해 주세요.');
    }
    return raw;
}
export function normalizeQuotationRequest(value: unknown): QuotationRequest {
    exact(value, ['version', 'reference', 'action', 'expectedVersion', 'snapshot']);
    if (value.version !== 1 || !['create', 'update', 'delete'].includes(String(value.action)))
        throw Error('견적 처리 종류를 확인해 주세요.');
    const reference = normalizeQuotationReference(value.reference), action = value.action as QuotationRequest['action'];
    if (action === 'create' ? value.expectedVersion !== null : !nativeVersion(value.expectedVersion))
        throw Error('열 때 확인한 견적 원문 버전을 보존해 주세요.');
    const result: QuotationRequest = { version: 1, reference, action, expectedVersion: value.expectedVersion as string | null };
    if (action === 'delete') {
        if (Object.prototype.hasOwnProperty.call(value, 'snapshot'))
            throw Error('삭제 요청에 견적 저장 내용을 함께 보낼 수 없습니다.');
    }
    else {
        const raw = decodeQuotationSnapshot(value.snapshot as CatalogValue);
        if (raw.id !== reference.targetId || raw.companyId !== reference.companyId)
            throw Error('견적 내용의 회사·문서 번호가 대상과 다릅니다.');
        result.snapshot = value.snapshot as CatalogValue;
    }
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        throw Error('견적 요청 원문이 너무 큽니다.');
    return result;
}
export const serializeQuotationRequest = (value: QuotationRequest): string => JSON.stringify(normalizeQuotationRequest(value));
export function normalizeQuotationOpenResult(value: unknown, reference: QuotationReference, actorUid: string): QuotationOpenResult {
    exact(value, ['reference', 'actorUid', 'snapshot', 'expectedVersion']);
    const actual = normalizeQuotationReference(value.reference);
    if (JSON.stringify(actual) !== JSON.stringify(normalizeQuotationReference(reference)) || value.actorUid !== actorUid)
        throw Error('다른 회사·계정·대상의 견적 열림 응답입니다.');
    const raw = decodeQuotationOpenSnapshot(value.snapshot as CatalogValue);
    if (raw.id !== actual.targetId || raw.companyId !== actual.companyId || !nativeVersion(value.expectedVersion))
        throw Error('견적 열림 원문의 대상·회사·버전을 확인해 주세요.');
    return { reference: actual, actorUid, snapshot: value.snapshot as CatalogValue, expectedVersion: value.expectedVersion };
}
export function normalizeQuotationResult(value: unknown, reference: QuotationReference, actorUid: string, expectedHash?: string): QuotationResult {
    exact(value, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    const actual = normalizeQuotationReference(value.reference);
    if (value.version !== 1 || JSON.stringify(actual) !== JSON.stringify(normalizeQuotationReference(reference)) || value.actorUid !== actorUid || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !value.message || (value.requestHash === null ? !['cancelled', 'unknown'].includes(String(value.status)) : typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)) || expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash)
        throw Error('견적 응답의 회사·계정·대상·처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: actual, actorUid, status: value.status as QuotationResult['status'], requestHash: value.requestHash as string | null, message: value.message };
}
