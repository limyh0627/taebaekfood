import { encodeCatalogValue, decodeCatalogValue, type CatalogValue } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
import { documentId } from './documentId';
export type { CatalogValue } from './catalogOrderReferenceProof';
export const PARTNER_EDIT_FIELDS = ['name', 'ownerName', 'bizNo', 'tel', 'mobile', 'phone', 'fax', 'email', 'partnerType', 'type', 'defaultShipMethod', 'address', 'addressDetail', 'shipTos', 'note'] as const;
export type PartnerEditField = typeof PARTNER_EDIT_FIELDS[number];
export const PARTNER_EDIT_OPERATIONS = 'partnerEditOperations';
export interface PartnerEditReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
}
export interface PartnerEditRequest {
    version: 1;
    reference: PartnerEditReference;
    expectedVersion: string;
    patch: PartnerEditPatch;
}
export interface PartnerEditOpenResult {
    reference: PartnerEditReference;
    actorUid: string;
    opening: CatalogValue;
    expectedVersion: string;
}
export interface PartnerEditResult {
    version: 1;
    reference: PartnerEditReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export interface PartnerEditHistoryResult {
    version: 1;
    companyId: PartnerEditReference['companyId'];
    actorUid: string;
    entries: {
        result: PartnerEditResult;
        createdAt: string;
    }[];
    nextCursor: string | null;
}
export type PartnerEditCommand = {
    mode: 'open';
    reference: PartnerEditReference;
    opening: CatalogValue;
} | {
    mode: 'apply';
    request: PartnerEditRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: PartnerEditReference;
} | {
    mode: 'listHistory';
    companyId: PartnerEditReference['companyId'];
    cursor?: string;
};
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('거래처 요청 형식을 확인해 주세요.');
}
export function normalizePartnerEditReference(v: unknown): PartnerEditReference {
    exact(v, ['companyId', 'planId', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(v.companyId)) || !cleanupValidId(v.planId) || !documentId(v.targetId))
        throw Error('거래처 요청 번호를 확인해 주세요.');
    return { companyId: v.companyId as PartnerEditReference['companyId'], planId: v.planId, targetId: v.targetId };
}
function version(v: unknown): string {
    if (typeof v !== 'string' || !/^\d+:\d{9}$/.test(v))
        throw Error('확인한 거래처 버전을 보존해 주세요.');
    return v;
}
export type PartnerEditShipTo = {
    id: string;
    name?: unknown;
    archived?: unknown;
    defaultShipMethod?: unknown;
};
export type PartnerEditPatch = Partial<Record<Exclude<PartnerEditField, 'shipTos'>, string>> & {
    shipTos?: PartnerEditShipTo[];
};
const own = (row: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(row, key);
const SHIP_FIELDS = ['id', 'name', 'archived', 'defaultShipMethod'] as const;
/** 배송지의 미지 필드는 최초 서버 문서에서 보존하고 공개 편집 필드만 송신한다. */
export function partnerEditShipTos(rows: unknown): PartnerEditShipTo[] {
    if (!Array.isArray(rows))
        throw Error('배송지 원문 목록을 확인해 주세요.');
    return rows.map(row => { if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id)
        throw Error('배송지 번호를 확인해 주세요.'); return Object.fromEntries(SHIP_FIELDS.filter(key => own(row, key) && row[key] !== undefined).map(key => [key, row[key]])) as PartnerEditShipTo; });
}
/** 조회는 저장 검증이 아니다. 옛 배송지의 이상값도 그대로 대조하되 미소유 필드는 내보내지 않는다. */
function projectShipTos(value: unknown): unknown {
    return Array.isArray(value) ? value.map(row => row && typeof row === 'object'
        ? Object.fromEntries(SHIP_FIELDS.filter(key => own(row, key)).map(key => [key, (row as Record<string, unknown>)[key]]))
        : row) : value;
}
const visibleValue = (key: string, value: unknown) => key === 'shipTos' ? projectShipTos(value) : value;
export function partnerEditOpening(row: object): CatalogValue {
    return encodeCatalogValue(Object.fromEntries([...PARTNER_EDIT_FIELDS, 'companyId', 'archived'].filter(key => own(row, key)).map(key => [key, visibleValue(key, (row as Record<string, unknown>)[key])])));
}
export function decodePartnerEditOpening(value: unknown): Record<string, unknown> {
    const raw = decodeCatalogValue(value, { special: () => undefined, timestamp: (seconds, nanoseconds) => ({ seconds, nanoseconds }), reference: path => ({ path }), geo: (latitude, longitude) => ({ latitude, longitude }), bytes: values => values });
    exact(raw, [...PARTNER_EDIT_FIELDS, 'companyId', 'archived']);
    return raw;
}
function opening(value: unknown): CatalogValue { decodePartnerEditOpening(value); return value as CatalogValue; }
export function partnerEditPatch(initial: Record<string, unknown>, form: Record<string, unknown>): PartnerEditPatch {
    const patch: Record<string, unknown> = {};
    for (const key of PARTNER_EDIT_FIELDS)
        if (own(form, key) && form[key] !== undefined && JSON.stringify(encodeCatalogValue(visibleValue(key, form[key]))) !== JSON.stringify(encodeCatalogValue(visibleValue(key, own(initial, key) && initial[key] !== undefined ? initial[key] : null)))) {
            patch[key] = key === 'shipTos' ? partnerEditShipTos(form[key]) : form[key];
        }
    return patch as PartnerEditPatch;
}
export function normalizePartnerEditRequest(v: unknown): PartnerEditRequest {
    exact(v, ['version', 'reference', 'expectedVersion', 'patch']);
    if (v.version !== 1)
        throw Error('거래처 요청 버전을 확인해 주세요.');
    exact(v.patch, PARTNER_EDIT_FIELDS);
    const patch: PartnerEditPatch = {};
    for (const k of PARTNER_EDIT_FIELDS) {
        if (v.patch[k] === undefined)
            continue;
        if (k === 'shipTos') {
            const rows = partnerEditShipTos(v.patch[k]);
            if ((v.patch[k] as Record<string, unknown>[]).some(row => Object.keys(row).some(key => !SHIP_FIELDS.includes(key as typeof SHIP_FIELDS[number]))))
                throw Error('배송지의 공개 편집 필드만 보내 주세요.');
            patch.shipTos = rows;
        }
        else {
            if (typeof v.patch[k] !== 'string')
                throw Error('거래처 입력값을 확인해 주세요.');
            patch[k] = v.patch[k];
        }
    }
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > 256 * 1024)
        throw Error('거래처 요청 원문이 너무 큽니다.');
    if (!Object.keys(patch).length)
        throw Error('변경한 거래처가 없습니다.');
    return { version: 1, reference: normalizePartnerEditReference(v.reference), expectedVersion: version(v.expectedVersion), patch };
}
export const serializePartnerEditRequest = (v: PartnerEditRequest) => JSON.stringify(normalizePartnerEditRequest(v));
export function normalizePartnerEditOpenRequest(v: unknown) {
    exact(v, ['mode', 'reference', 'opening']);
    if (v.mode !== 'open')
        throw Error('거래처 열기 요청을 확인해 주세요.');
    return { mode: 'open' as const, reference: normalizePartnerEditReference(v.reference), opening: opening(v.opening) };
}
function binding(v: Record<string, unknown>, ref: PartnerEditReference, uid: string) {
    if (JSON.stringify(normalizePartnerEditReference(v.reference)) !== JSON.stringify(normalizePartnerEditReference(ref)) || v.actorUid !== uid)
        throw Error('다른 회사 또는 계정의 결과입니다.');
}
export function normalizePartnerEditOpenResult(v: unknown, ref: PartnerEditReference, uid: string): PartnerEditOpenResult { exact(v, ['reference', 'actorUid', 'opening', 'expectedVersion']); binding(v, ref, uid); return { reference: normalizePartnerEditReference(v.reference), actorUid: uid, opening: opening(v.opening), expectedVersion: version(v.expectedVersion) }; }
export function normalizePartnerEditResult(v: unknown, ref: PartnerEditReference, uid: string, hash?: string): PartnerEditResult {
    exact(v, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    binding(v, ref, uid);
    if (v.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(v.status)) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash)) || (hash !== undefined && v.requestHash !== null && v.requestHash !== hash))
        throw Error('거래처 처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizePartnerEditReference(v.reference), actorUid: uid, status: v.status as PartnerEditResult['status'], requestHash: v.requestHash as string | null, message: v.message };
}
export function normalizePartnerEditHistoryResult(v: unknown, companyId: PartnerEditReference['companyId'], uid: string): PartnerEditHistoryResult {
    exact(v, ['version', 'companyId', 'actorUid', 'entries', 'nextCursor']);
    if (v.version !== 1 || v.companyId !== companyId || v.actorUid !== uid || !Array.isArray(v.entries) || v.entries.length > 50 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(v.nextCursor))))
        throw Error('거래처 처리이력을 확인하지 못했습니다.');
    return { version: 1, companyId, actorUid: uid, nextCursor: v.nextCursor as string | null, entries: v.entries.map(e => {
            exact(e, ['result', 'createdAt']);
            if (typeof e.createdAt !== 'string' || !e.createdAt)
                throw Error('처리 시각을 확인하지 못했습니다.');
            const ref = normalizePartnerEditReference((e.result as PartnerEditResult)?.reference);
            if (ref.companyId !== companyId)
                throw Error('다른 회사의 처리이력입니다.');
            return { result: normalizePartnerEditResult(e.result, ref, uid), createdAt: e.createdAt };
        }) };
}
