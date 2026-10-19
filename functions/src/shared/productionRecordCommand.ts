import { cleanupValidId } from './partnerItemCleanup';
import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
export type { CatalogValue } from './catalogOrderReferenceProof';
export const PRODUCTION_RECORD_OPERATIONS = 'productionRecordOperations';
export const PRODUCTION_RECORD_FIELDS = ['date', 'itemId', 'itemName', 'finishedQty', 'wipUsed', 'wipItemId', 'wipItemName', 'cost', 'note', 'createdBy', 'createdAt', 'orderId', 'lineId', 'generation', 'legacySourceCandidates', 'supersededBy'] as const;
export const PRODUCTION_SOURCE_FIELDS = ['status', 'partnerName', 'items', 'deliveredAt', 'createdAt', 'productionRecordIndex'] as const;
export interface ProductionRecordReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
}
export interface ProductionRecordBody {
    date: string;
    itemId: string;
    itemName: string;
    finishedQty: number;
    createdAt: string;
    wipUsed?: number;
    wipItemId?: string;
    wipItemName?: string;
    cost?: number;
    note?: string;
    createdBy?: string;
}
export interface ProductionRecordSource {
    orderId: string;
    evidence: CatalogValue;
}
export interface ProductionRecordSourceVersion extends ProductionRecordSource {
    expectedVersion: string;
}
export interface ProductionRecordOpenResult {
    reference: ProductionRecordReference;
    actorUid: string;
    opening: CatalogValue | null;
    expectedVersion: string | null;
    source?: ProductionRecordSourceVersion;
}
export type ProductionRecordRequest = {
    version: 1;
    reference: ProductionRecordReference;
    expectedVersion: string | null;
} & ({
    action: 'create';
    record: ProductionRecordBody;
} | {
    action: 'sync';
    record: ProductionRecordBody;
    source: ProductionRecordSourceVersion;
} | {
    action: 'date';
    date: string;
} | {
    action: 'delete';
});
export interface ProductionRecordResult {
    version: 1;
    reference: ProductionRecordReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export interface ProductionRecordHistoryResult {
    version: 1;
    companyId: ProductionRecordReference['companyId'];
    actorUid: string;
    entries: {
        result: ProductionRecordResult;
        action: 'create' | 'sync' | 'date' | 'delete' | 'cancel';
        createdAt: string;
    }[];
    nextCursor: string | null;
}
export type ProductionRecordCommand = {
    mode: 'open';
    reference: ProductionRecordReference;
    opening: CatalogValue | null;
    source?: ProductionRecordSource;
} | {
    mode: 'apply';
    request: ProductionRecordRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: ProductionRecordReference;
} | {
    mode: 'listHistory';
    companyId: ProductionRecordReference['companyId'];
    cursor?: string;
};
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
export const productionRecordValidId = (value: unknown): value is string => typeof value === 'string' && !!value && value.trim() === value && !/[\/\\\x00-\x1f]/.test(value) && value !== '.' && value !== '..' && new TextEncoder().encode(value).length <= 1500;
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key)))
        throw Error('생산기록 요청 형식을 확인해 주세요.');
}
function nativeVersion(value: unknown): string | null {
    if (value === null)
        return null;
    if (typeof value !== 'string' || !/^\d+:\d{9}$/.test(value))
        throw Error('생산기록 확인 버전을 보존해 주세요.');
    return value;
}
const adapter: CatalogValueAdapter = { special: () => undefined, timestamp: (seconds, nanoseconds) => ({ seconds, nanoseconds }), reference: path => ({ path }), geo: (latitude, longitude) => ({ latitude, longitude }), bytes: values => values };
function catalog(value: unknown): CatalogValue { decodeCatalogValue(value, adapter); return value as CatalogValue; }
export function productionRecordOpening(row: object | null | undefined, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue | null {
    if (row === null || row === undefined)
        return null;
    return encodeCatalogValue(Object.fromEntries(PRODUCTION_RECORD_FIELDS.filter(key => own(row, key)).map(key => [key, (row as Record<string, unknown>)[key]])), codec);
}
/** 존재·undefined·null을 구분하고 주문 품목의 배열 순서도 최초 표시 원문 그대로 고정한다. */
export function productionRecordSourceEvidence(row: object, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    const raw = row as Record<string, unknown>;
    return encodeCatalogValue(PRODUCTION_SOURCE_FIELDS.map(key => ({ key, present: own(row, key), defined: own(row, key) && raw[key] !== undefined, value: own(row, key) && raw[key] !== undefined ? raw[key] : null })), codec);
}
function sourceEvidence(value: unknown): CatalogValue {
    const rows = decodeCatalogValue(value, adapter);
    if (!Array.isArray(rows) || rows.length !== PRODUCTION_SOURCE_FIELDS.length)
        throw Error('최초 주문의 생산 근거를 확인해 주세요.');
    rows.forEach((row, index) => {
        exact(row, ['key', 'present', 'defined', 'value']);
        if (row.key !== PRODUCTION_SOURCE_FIELDS[index] || typeof row.present !== 'boolean' || typeof row.defined !== 'boolean' || (!row.present && row.defined) || (!row.defined && row.value !== null))
            throw Error('최초 주문의 존재 구분과 배열 순서를 보존해 주세요.');
    });
    return value as CatalogValue;
}
export function normalizeProductionRecordReference(value: unknown): ProductionRecordReference {
    exact(value, ['companyId', 'planId', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !productionRecordValidId(value.targetId))
        throw Error('생산기록 회사와 요청·대상 번호를 확인해 주세요.');
    return { companyId: value.companyId as ProductionRecordReference['companyId'], planId: value.planId, targetId: value.targetId };
}
export function productionRecordBody(value: object): ProductionRecordBody {
    const fields = ['date', 'itemId', 'itemName', 'finishedQty', 'createdAt', 'wipUsed', 'wipItemId', 'wipItemName', 'cost', 'note', 'createdBy'];
    const raw = value as Record<string, unknown>;
    const body = Object.fromEntries(fields.filter(key => own(value, key) && raw[key] !== undefined).map(key => [key, raw[key]]));
    for (const key of ['date', 'itemId', 'itemName', 'createdAt'])
        if (typeof body[key] !== 'string')
            throw Error('생산기록 원문을 확인해 주세요.');
    if (!productionRecordValidId(body.itemId) || typeof body.finishedQty !== 'number' || !Number.isFinite(body.finishedQty))
        throw Error('생산 품목과 수량을 확인해 주세요.');
    for (const key of ['wipUsed', 'cost'])
        if (own(body, key) && (typeof body[key] !== 'number' || !Number.isFinite(body[key])))
            throw Error('반제품 수량과 원가를 확인해 주세요.');
    for (const key of ['wipItemId', 'wipItemName', 'note', 'createdBy'])
        if (own(body, key) && typeof body[key] !== 'string')
            throw Error('생산기록 선택 원문을 확인해 주세요.');
    return body as unknown as ProductionRecordBody;
}
function source(value: unknown, withVersion: true): ProductionRecordSourceVersion;
function source(value: unknown, withVersion: false): ProductionRecordSource;
function source(value: unknown, withVersion: boolean): ProductionRecordSource | ProductionRecordSourceVersion {
    exact(value, withVersion ? ['orderId', 'evidence', 'expectedVersion'] : ['orderId', 'evidence']);
    if (!productionRecordValidId(value.orderId))
        throw Error('원래 주문 번호를 확인해 주세요.');
    const base = { orderId: value.orderId, evidence: sourceEvidence(value.evidence) };
    if (!withVersion)
        return base;
    const version = nativeVersion(value.expectedVersion);
    if (version === null)
        throw Error('원래 주문의 확인 버전이 없습니다.');
    return { ...base, expectedVersion: version };
}
export function normalizeProductionRecordRequest(value: unknown): ProductionRecordRequest {
    // 영수증에도 최초 원문을 함께 보관하므로 Firestore 문서 한도에 여유를 둔다.
    if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024)
        throw Error('생산기록 요청이 너무 큽니다. 원문을 보존하고 처리 범위를 확인해 주세요.');
    exact(value, ['version', 'reference', 'action', 'expectedVersion', 'record', 'date', 'source']);
    if (value.version !== 1)
        throw Error('생산기록 요청 버전을 확인해 주세요.');
    const common = { version: 1 as const, reference: normalizeProductionRecordReference(value.reference), expectedVersion: nativeVersion(value.expectedVersion) };
    if (value.action === 'create' || value.action === 'sync') {
        if (common.expectedVersion !== null || own(value, 'date') || !value.record || (value.action === 'create' && own(value, 'source')))
            throw Error('새 생산기록은 부재 확인 원문으로만 생성합니다.');
        exact(value.record, ['date', 'itemId', 'itemName', 'finishedQty', 'createdAt', 'wipUsed', 'wipItemId', 'wipItemName', 'cost', 'note', 'createdBy']);
        const record = productionRecordBody(value.record);
        return value.action === 'sync' ? { ...common, action: 'sync', record, source: source(value.source, true) } : { ...common, action: 'create', record };
    }
    if (common.expectedVersion === null || own(value, 'record') || own(value, 'source'))
        throw Error('수정·삭제할 생산기록의 확인 버전이 없습니다.');
    if (value.action === 'date' && typeof value.date === 'string' && value.date)
        return { ...common, action: 'date', date: value.date };
    if (value.action === 'delete' && !own(value, 'date'))
        return { ...common, action: 'delete' };
    throw Error('생산기록 처리 종류를 확인해 주세요.');
}
export const serializeProductionRecordRequest = (value: ProductionRecordRequest): string => JSON.stringify(normalizeProductionRecordRequest(value));
export function normalizeProductionRecordOpenRequest(value: unknown): Extract<ProductionRecordCommand, {
    mode: 'open';
}> {
    exact(value, ['mode', 'reference', 'opening', 'source']);
    if (value.mode !== 'open')
        throw Error('생산기록 열기 형식을 확인해 주세요.');
    return { mode: 'open', reference: normalizeProductionRecordReference(value.reference), opening: value.opening === null ? null : catalog(value.opening), ...(own(value, 'source') ? { source: source(value.source, false) } : {}) };
}
function binding(value: Record<string, unknown>, ref: ProductionRecordReference, uid: string) {
    if (JSON.stringify(normalizeProductionRecordReference(value.reference)) !== JSON.stringify(normalizeProductionRecordReference(ref)) || value.actorUid !== uid)
        throw Error('다른 회사·계정·대상의 생산기록 응답입니다.');
}
export function normalizeProductionRecordOpenResult(value: unknown, ref: ProductionRecordReference, uid: string): ProductionRecordOpenResult {
    exact(value, ['reference', 'actorUid', 'opening', 'expectedVersion', 'source']);
    binding(value, ref, uid);
    const version = nativeVersion(value.expectedVersion);
    if ((value.opening === null) !== (version === null))
        throw Error('생산기록 존재 여부와 버전이 다릅니다.');
    return { reference: normalizeProductionRecordReference(value.reference), actorUid: uid, opening: value.opening === null ? null : catalog(value.opening), expectedVersion: version, ...(own(value, 'source') ? { source: source(value.source, true) } : {}) };
}
export function normalizeProductionRecordResult(value: unknown, ref: ProductionRecordReference, uid: string, expectedHash?: string): ProductionRecordResult {
    exact(value, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    binding(value, ref, uid);
    if (value.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !value.message || (value.requestHash === null ? !['unknown', 'cancelled'].includes(String(value.status)) : typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)) || (expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash))
        throw Error('생산기록 처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeProductionRecordReference(value.reference), actorUid: uid, status: value.status as ProductionRecordResult['status'], requestHash: value.requestHash as string | null, message: value.message };
}
export function normalizeProductionRecordHistoryResult(value: unknown, companyId: ProductionRecordReference['companyId'], uid: string): ProductionRecordHistoryResult {
    exact(value, ['version', 'companyId', 'actorUid', 'entries', 'nextCursor']);
    if (value.version !== 1 || value.companyId !== companyId || value.actorUid !== uid || !Array.isArray(value.entries) || value.entries.length > 50 || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(value.nextCursor))))
        throw Error('생산기록 처리이력을 확인하지 못했습니다.');
    return { version: 1, companyId, actorUid: uid, entries: value.entries.map(row => {
            exact(row, ['result', 'action', 'createdAt']);
            const ref = normalizeProductionRecordReference((row.result as ProductionRecordResult)?.reference);
            if (ref.companyId !== companyId || !['create', 'sync', 'date', 'delete', 'cancel'].includes(String(row.action)) || typeof row.createdAt !== 'string' || !row.createdAt)
                throw Error('생산기록 처리이력 범위가 다릅니다.');
            return { result: normalizeProductionRecordResult(row.result, ref, uid), action: row.action as ProductionRecordHistoryResult['entries'][number]['action'], createdAt: row.createdAt };
        }), nextCursor: value.nextCursor as string | null };
}
