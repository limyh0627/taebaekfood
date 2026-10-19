import { encodeCatalogValue, decodeCatalogValue, type CatalogValue } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue } from './catalogOrderReferenceProof';
export const COMPANY_INFO_FIELDS = ['name', 'ceoName', 'bizNo', 'bizType', 'bizItem', 'address', 'phone', 'fax', 'email', 'bankAccount'] as const;
export type CompanyInfoField = typeof COMPANY_INFO_FIELDS[number];
export const COMPANY_INFO_OPERATIONS = 'companyInfoOperations';
export interface CompanyInfoReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
}
export interface CompanyInfoRequest {
    version: 1;
    reference: CompanyInfoReference;
    expectedVersion: string | null;
    patch: Partial<Record<CompanyInfoField, string>>;
}
export interface CompanyInfoOpenResult {
    reference: CompanyInfoReference;
    actorUid: string;
    opening: CatalogValue;
    expectedVersion: string | null;
}
export interface CompanyInfoResult {
    version: 1;
    reference: CompanyInfoReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export interface CompanyInfoHistoryResult {
    version: 1;
    companyId: CompanyInfoReference['companyId'];
    actorUid: string;
    entries: {
        result: CompanyInfoResult;
        createdAt: string;
    }[];
    nextCursor: string | null;
}
export type CompanyInfoCommand = {
    mode: 'open';
    reference: CompanyInfoReference;
    opening: CatalogValue;
} | {
    mode: 'apply';
    request: CompanyInfoRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: CompanyInfoReference;
} | {
    mode: 'listHistory';
    companyId: CompanyInfoReference['companyId'];
    cursor?: string;
};
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('회사정보 요청 형식을 확인해 주세요.');
}
export function normalizeCompanyInfoReference(v: unknown): CompanyInfoReference {
    exact(v, ['companyId', 'planId']);
    if (!['taebaek', 'punghoe'].includes(String(v.companyId)) || !cleanupValidId(v.planId))
        throw Error('회사정보 요청 번호를 확인해 주세요.');
    return { companyId: v.companyId as CompanyInfoReference['companyId'], planId: v.planId };
}
function version(v: unknown): string | null {
    if (v === null)
        return null;
    if (typeof v !== 'string' || !/^\d+:\d{9}$/.test(v))
        throw Error('확인한 회사정보 버전을 보존해 주세요.');
    return v;
}
export function companyInfoOpening(row: object | null | undefined): CatalogValue { return encodeCatalogValue(Object.fromEntries(COMPANY_INFO_FIELDS.filter(k => row && Object.prototype.hasOwnProperty.call(row, k)).map(k => [k, (row as Record<string, unknown>)[k]]))); }
function opening(v: unknown): CatalogValue {
    const no = () => { throw Error('회사정보 원문 형식을 확인해 주세요.'); };
    const raw = decodeCatalogValue(v, { special: () => undefined, timestamp: no, reference: no, geo: no, bytes: no });
    exact(raw, COMPANY_INFO_FIELDS);
    if (JSON.stringify(companyInfoOpening(raw)) !== JSON.stringify(v))
        no();
    return v as CatalogValue;
}
export function normalizeCompanyInfoRequest(v: unknown): CompanyInfoRequest {
    exact(v, ['version', 'reference', 'expectedVersion', 'patch']);
    if (v.version !== 1)
        throw Error('회사정보 요청 버전을 확인해 주세요.');
    exact(v.patch, COMPANY_INFO_FIELDS);
    const patch: CompanyInfoRequest['patch'] = {};
    for (const k of COMPANY_INFO_FIELDS) {
        if (v.patch[k] === undefined)
            continue;
        if (typeof v.patch[k] !== 'string')
            throw Error('회사정보 입력값을 확인해 주세요.');
        patch[k] = v.patch[k];
    }
    if (!Object.keys(patch).length)
        throw Error('변경한 회사정보가 없습니다.');
    return { version: 1, reference: normalizeCompanyInfoReference(v.reference), expectedVersion: version(v.expectedVersion), patch };
}
export const serializeCompanyInfoRequest = (v: CompanyInfoRequest) => JSON.stringify(normalizeCompanyInfoRequest(v));
export function normalizeCompanyInfoOpenRequest(v: unknown) {
    exact(v, ['mode', 'reference', 'opening']);
    if (v.mode !== 'open')
        throw Error('회사정보 열기 요청을 확인해 주세요.');
    return { mode: 'open' as const, reference: normalizeCompanyInfoReference(v.reference), opening: opening(v.opening) };
}
function binding(v: Record<string, unknown>, ref: CompanyInfoReference, uid: string) {
    if (JSON.stringify(normalizeCompanyInfoReference(v.reference)) !== JSON.stringify(normalizeCompanyInfoReference(ref)) || v.actorUid !== uid)
        throw Error('다른 회사 또는 계정의 결과입니다.');
}
export function normalizeCompanyInfoOpenResult(v: unknown, ref: CompanyInfoReference, uid: string): CompanyInfoOpenResult { exact(v, ['reference', 'actorUid', 'opening', 'expectedVersion']); binding(v, ref, uid); return { reference: normalizeCompanyInfoReference(v.reference), actorUid: uid, opening: opening(v.opening), expectedVersion: version(v.expectedVersion) }; }
export function normalizeCompanyInfoResult(v: unknown, ref: CompanyInfoReference, uid: string, hash?: string): CompanyInfoResult {
    exact(v, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    binding(v, ref, uid);
    if (v.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(v.status)) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash)) || (hash !== undefined && v.requestHash !== null && v.requestHash !== hash))
        throw Error('회사정보 처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeCompanyInfoReference(v.reference), actorUid: uid, status: v.status as CompanyInfoResult['status'], requestHash: v.requestHash as string | null, message: v.message };
}
export function normalizeCompanyInfoHistoryResult(v: unknown, companyId: CompanyInfoReference['companyId'], uid: string): CompanyInfoHistoryResult {
    exact(v, ['version', 'companyId', 'actorUid', 'entries', 'nextCursor']);
    if (v.version !== 1 || v.companyId !== companyId || v.actorUid !== uid || !Array.isArray(v.entries) || v.entries.length > 50 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(v.nextCursor))))
        throw Error('회사정보 처리이력을 확인하지 못했습니다.');
    return { version: 1, companyId, actorUid: uid, nextCursor: v.nextCursor as string | null, entries: v.entries.map(e => {
            exact(e, ['result', 'createdAt']);
            if (typeof e.createdAt !== 'string' || !e.createdAt)
                throw Error('처리 시각을 확인하지 못했습니다.');
            const ref = normalizeCompanyInfoReference((e.result as CompanyInfoResult)?.reference);
            if (ref.companyId !== companyId)
                throw Error('다른 회사의 처리이력입니다.');
            return { result: normalizeCompanyInfoResult(e.result, ref, uid), createdAt: e.createdAt };
        }) };
}
