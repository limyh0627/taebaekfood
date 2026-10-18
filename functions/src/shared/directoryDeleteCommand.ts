import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { documentId } from './documentId';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const DIRECTORY_DELETE_OPERATIONS = 'directoryDeleteOperations';
export interface DirectoryDeleteReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    kind: 'partner' | 'employee';
    targetId: string;
}
export interface DirectoryDeleteRequest {
    version: 1;
    reference: DirectoryDeleteReference;
    opening: CatalogValue;
    expectedVersion: string;
}
export interface DirectoryDeletePreview {
    reference: DirectoryDeleteReference;
    actorUid: string;
    opening: CatalogValue;
    expectedVersion: string;
}
export interface DirectoryDeleteResult {
    version: 1;
    reference: DirectoryDeleteReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export type DirectoryDeleteCommand = {
    mode: 'preview';
    reference: DirectoryDeleteReference;
    opening: CatalogValue;
} | {
    mode: 'apply';
    request: DirectoryDeleteRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: DirectoryDeleteReference;
    requestHash?: string;
};
function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !fields.includes(key))) {
        throw Error('삭제 요청 형식을 확인해 주세요.');
    }
}
export function directoryDeleteOpening(row: object, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    return encodeCatalogValue(Object.fromEntries(['name', 'companyId'].filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, (row as Record<string, unknown>)[key]])), codec);
}
function openingOf(value: unknown): CatalogValue {
    // 두 문자열 필드만 소유한다. 합성 ID나 다른 업무 필드는 삭제 근거로 승격하지 않는다.
    const codec: CatalogValueAdapter = { special: () => undefined, timestamp: () => { throw Error('삭제 원문 형식이 다릅니다.'); }, reference: () => { throw Error('삭제 원문 형식이 다릅니다.'); }, geo: () => { throw Error('삭제 원문 형식이 다릅니다.'); }, bytes: () => { throw Error('삭제 원문 형식이 다릅니다.'); } };
    const raw = decodeCatalogValue(value, codec);
    exact(raw, ['name', 'companyId']);
    if (JSON.stringify(directoryDeleteOpening(raw)) !== JSON.stringify(value))
        throw Error('삭제 대상을 열 때 확인한 이름·회사 원문을 보존해 주세요.');
    return value as CatalogValue;
}
export function normalizeDirectoryDeleteReference(value: unknown): DirectoryDeleteReference {
    exact(value, ['companyId', 'planId', 'kind', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !['partner', 'employee'].includes(String(value.kind)) || !documentId(value.targetId))
        throw Error('삭제 요청의 회사·종류·대상·번호를 확인해 주세요.');
    return { companyId: value.companyId as DirectoryDeleteReference['companyId'], planId: value.planId, kind: value.kind as DirectoryDeleteReference['kind'], targetId: value.targetId };
}
function versionOf(value: unknown): string {
    if (typeof value !== 'string' || !/^-?\d+:\d{9}$/.test(value) || Number(value.split(':')[1]) >= 1e9)
        throw Error('서버에서 확인한 삭제 대상 버전을 보존해 주세요.');
    return value;
}
export function normalizeDirectoryDeleteRequest(value: unknown): DirectoryDeleteRequest {
    exact(value, ['version', 'reference', 'opening', 'expectedVersion']);
    if (value.version !== 1)
        throw Error('삭제 요청 버전을 확인해 주세요.');
    const result: DirectoryDeleteRequest = { version: 1, reference: normalizeDirectoryDeleteReference(value.reference), opening: openingOf(value.opening), expectedVersion: versionOf(value.expectedVersion) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        throw Error('삭제 요청 원문이 너무 큽니다.');
    return result;
}
export function serializeDirectoryDeleteRequest(value: DirectoryDeleteRequest): string {
    return JSON.stringify(normalizeDirectoryDeleteRequest(value));
}
function bound(value: unknown, reference: DirectoryDeleteReference, actorUid: string): Record<string, unknown> {
    exact(value, ['version', 'reference', 'actorUid', 'opening', 'expectedVersion', 'status', 'requestHash', 'message']);
    const ref = normalizeDirectoryDeleteReference(value.reference);
    if (JSON.stringify(ref) !== JSON.stringify(normalizeDirectoryDeleteReference(reference)) || value.actorUid !== actorUid)
        throw Error('다른 회사·계정·대상의 삭제 응답입니다.');
    return value;
}
export function normalizeDirectoryDeletePreview(value: unknown, reference: DirectoryDeleteReference, actorUid: string): DirectoryDeletePreview {
    const raw = bound(value, reference, actorUid);
    exact(raw, ['reference', 'actorUid', 'opening', 'expectedVersion']);
    return { reference: normalizeDirectoryDeleteReference(raw.reference), actorUid, opening: openingOf(raw.opening), expectedVersion: versionOf(raw.expectedVersion) };
}
export function normalizeDirectoryDeleteResult(value: unknown, reference: DirectoryDeleteReference, actorUid: string, expectedHash?: string): DirectoryDeleteResult {
    const raw = bound(value, reference, actorUid);
    exact(raw, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    if (raw.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(raw.status)) || typeof raw.message !== 'string' || !raw.message || (raw.requestHash === null ? !['cancelled', 'unknown'].includes(String(raw.status)) : typeof raw.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.requestHash)) || (expectedHash !== undefined && raw.requestHash !== null && raw.requestHash !== expectedHash))
        throw Error('삭제 결과의 상태·원문 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeDirectoryDeleteReference(raw.reference), actorUid, status: raw.status as DirectoryDeleteResult['status'], requestHash: raw.requestHash as string | null, message: raw.message };
}
