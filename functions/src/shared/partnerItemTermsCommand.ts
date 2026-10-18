import { encodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { documentId } from './documentId';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const PARTNER_ITEM_TERMS_OPERATIONS = 'partnerItemTermsOperations';
export interface PartnerItemTermsReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
    itemId: string;
    partnerId: string;
    direction: 'in' | 'out';
}
export interface PartnerItemTerms {
    price?: number;
    taxType?: '과세' | '면세' | null;
    Account_Code?: string;
}
export interface PartnerItemTermsEvidence {
    schemaVersion: 1;
    queries: {
        kind: 'bom' | 'links';
        itemId: string;
        count: number;
        digest: string;
    }[];
    documents: {
        kind: 'item' | 'partner' | 'tomb';
        id: string;
        digest: string;
    }[];
}
export interface PartnerItemTermsNotice {
    itemId: string;
    itemName: string;
    childId: string;
    childName: string;
    count: number;
}
export interface PartnerItemTermsPreviewInput extends PartnerItemTermsReference {
    version: 1;
    opening: CatalogValue | null;
    terms: PartnerItemTerms;
}
export interface PartnerItemTermsPreview extends PartnerItemTermsReference {
    version: 1;
    expected: CatalogValue | null;
    evidence: PartnerItemTermsEvidence;
    notices: PartnerItemTermsNotice[];
    noticeHash?: string;
}
export interface PartnerItemTermsRequest extends PartnerItemTermsReference {
    version: 1;
    expected: CatalogValue | null;
    terms: PartnerItemTerms;
    evidence: PartnerItemTermsEvidence;
    noticeHash?: string;
}
export type PartnerItemTermsCommand = {
    mode: 'preview';
    input: PartnerItemTermsPreviewInput;
} | {
    mode: 'apply';
    request: PartnerItemTermsRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: PartnerItemTermsReference;
    requestHash?: string;
};
export interface PartnerItemTermsResult extends PartnerItemTermsReference {
    actorUid: string;
    requestHash: string | null;
    status: 'applied' | 'duplicate' | 'rejected' | 'cancelled' | 'unknown';
    message: string;
}
export const PARTNER_ITEM_TERMS_FIELDS = ['itemId', 'partnerId', 'Direction', 'price', 'taxType', 'Account_Code'] as const;
const own = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, row[field]]));
export const partnerItemTermsOpening = (row: Record<string, unknown>, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue => encodeCatalogValue(own(row, PARTNER_ITEM_TERMS_FIELDS), codec);
export const partnerItemTermsExpected = (row: Record<string, unknown>, codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue => encodeCatalogValue(own(row, ['companyId', 'id', ...PARTNER_ITEM_TERMS_FIELDS]), codec);
export const partnerItemTermsCanonical = (value: unknown, codec?: Pick<CatalogValueAdapter, 'special'>): string => JSON.stringify(encodeCatalogValue(value, codec));
function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !fields.includes(field)))
    throw Error('거래조건 저장 형식을 확인해 주세요.'); }
const hashOk = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function normalizePartnerItemTermsReference(value: unknown): PartnerItemTermsReference {
    exact(value, ['companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !documentId(value.targetId) || !documentId(value.itemId) || !documentId(value.partnerId) || !['in', 'out'].includes(String(value.direction)))
        throw Error('거래조건의 회사·계획·품목·거래처를 확인해 주세요.');
    return { companyId: value.companyId as PartnerItemTermsReference['companyId'], planId: value.planId, targetId: value.targetId, itemId: value.itemId, partnerId: value.partnerId, direction: value.direction as 'in' | 'out' };
}
function termsOf(value: unknown): PartnerItemTerms {
    exact(value, ['price', 'taxType', 'Account_Code']);
    if (value.price !== undefined && (typeof value.price !== 'number' || !Number.isFinite(value.price)))
        throw Error('단가를 확인해 주세요.');
    if (value.taxType !== undefined && value.taxType !== null && !['과세', '면세'].includes(String(value.taxType)))
        throw Error('과세 여부를 확인해 주세요.');
    if (value.Account_Code !== undefined && typeof value.Account_Code !== 'string')
        throw Error('계정과목을 확인해 주세요.');
    return { ...(value.price !== undefined ? { price: Object.is(value.price,-0)?0:value.price as number } : {}), ...(value.taxType !== undefined ? { taxType: value.taxType as PartnerItemTerms['taxType'] } : {}), ...(value.Account_Code !== undefined ? { Account_Code: value.Account_Code as string } : {}) };
}
/** 기존 행을 펼치던 호출의 의미를 보존하되 포장·미지 필드를 RPC 입력에 섞지 않는다. */
export function termsFromOpening(opening:{price?:unknown;taxType?:unknown;Account_Code?:unknown}|null|undefined,changes:PartnerItemTerms):PartnerItemTerms {
    const merged:Record<string,unknown>={};
    for(const field of ['price','taxType','Account_Code'] as const){
        // 명시 undefined도 변경이다. 예전 값을 자동으로 되살리지 않는다.
        const source=Object.prototype.hasOwnProperty.call(changes,field)?changes:opening;
        if(source&&Object.prototype.hasOwnProperty.call(source,field)&&source[field]!==undefined)merged[field]=source[field];
    }
    return termsOf(merged);
}
function projection(value: unknown): CatalogValue | null { if (value === null)
    return null; if (!Array.isArray(value) || value[0] !== 'map')
    throw Error('선택한 거래조건의 원문을 확인해 주세요.'); return JSON.parse(JSON.stringify(value)) as CatalogValue; }
const referenceOf = (value: Record<string, unknown>) => normalizePartnerItemTermsReference({ companyId: value.companyId, planId: value.planId, targetId: value.targetId, itemId: value.itemId, partnerId: value.partnerId, direction: value.direction });
export function normalizePartnerItemTermsPreviewInput(value: unknown): PartnerItemTermsPreviewInput {
    exact(value, ['version', 'companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction', 'opening', 'terms']);
    if (value.version !== 1)
        throw Error('거래조건 계약 버전을 확인해 주세요.');
    return { version: 1, ...referenceOf(value), opening: projection(value.opening), terms: termsOf(value.terms) };
}
function evidenceOf(value: unknown): PartnerItemTermsEvidence {
    exact(value, ['schemaVersion', 'queries', 'documents']);
    if (value.schemaVersion !== 1 || !Array.isArray(value.queries) || !Array.isArray(value.documents))
        throw Error('거래조건 연결 근거를 확인해 주세요.');
    const queries = value.queries.map(row => { exact(row, ['kind', 'itemId', 'count', 'digest']); if (!['bom', 'links'].includes(String(row.kind)) || !documentId(row.itemId) || !Number.isSafeInteger(row.count) || (row.count as number) < 0 || !hashOk(row.digest))
        throw Error('연결 조회 근거를 확인해 주세요.'); return { kind: row.kind as 'bom' | 'links', itemId: row.itemId, count: row.count as number, digest: row.digest }; });
    const documents = value.documents.map(row => { exact(row, ['kind', 'id', 'digest']); if (!['item', 'partner', 'tomb'].includes(String(row.kind)) || !documentId(row.id) || !hashOk(row.digest))
        throw Error('연결 문서 근거를 확인해 주세요.'); return { kind: row.kind as 'item' | 'partner' | 'tomb', id: row.id, digest: row.digest }; });
    for (const keys of [queries.map(row => row.kind + '|' + row.itemId), documents.map(row => row.kind + '|' + row.id)])
        if (keys.some((key, index) => index > 0 && keys[index - 1] >= key))
            throw Error('연결 근거의 순서·중복을 확인해 주세요.');
    return { schemaVersion: 1, queries, documents };
}
export function normalizePartnerItemTermsRequest(value: unknown): PartnerItemTermsRequest {
    exact(value, ['version', 'companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction', 'expected', 'terms', 'evidence', 'noticeHash']);
    if (value.version !== 1 || value.noticeHash !== undefined && !hashOk(value.noticeHash))
        throw Error('거래조건 계약·안내 확인 근거를 확인해 주세요.');
    const result: PartnerItemTermsRequest = { version: 1, ...referenceOf(value), expected: projection(value.expected), terms: termsOf(value.terms), evidence: evidenceOf(value.evidence), ...(value.noticeHash ? { noticeHash: value.noticeHash as string } : {}) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        throw Error('거래조건 저장 근거가 너무 큽니다.');
    return result;
}
export const serializePartnerItemTermsRequest = (value: unknown): string => JSON.stringify(normalizePartnerItemTermsRequest(value));
export function serializePartnerItemTermsNotice(reference: PartnerItemTermsReference, expected: CatalogValue | null, terms: PartnerItemTerms, evidence: PartnerItemTermsEvidence, notices: PartnerItemTermsNotice[]): string { return partnerItemTermsCanonical({ version: 1, reference, expected, terms, evidence, notices }); }
function referenceMatches(value: Record<string, unknown>, reference: PartnerItemTermsReference): boolean { return Object.entries(reference).every(([key, expected]) => value[key] === expected); }
export function normalizePartnerItemTermsPreview(value: unknown, reference: PartnerItemTermsReference): PartnerItemTermsPreview {
    exact(value, ['version', 'companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction', 'expected', 'evidence', 'notices', 'noticeHash']);
    if (value.version !== 1 || !referenceMatches(value, reference) || !Array.isArray(value.notices))
        throw Error('거래조건 안내의 대상·회사를 확인해 주세요.');
    const notices = value.notices.map(row => { exact(row, ['itemId', 'itemName', 'childId', 'childName', 'count']); if (!documentId(row.itemId) || !documentId(row.childId) || typeof row.itemName !== 'string' || typeof row.childName !== 'string' || typeof row.count !== 'number' || !Number.isFinite(row.count) || row.count <= 1)
        throw Error('박스·낱개 안내 내용을 확인해 주세요.'); return row as unknown as PartnerItemTermsNotice; });
    if (notices.length ? !hashOk(value.noticeHash) : value.noticeHash !== undefined)
        throw Error('박스·낱개 안내 확인 근거가 다릅니다.');
    return { version: 1, ...reference, expected: projection(value.expected), evidence: evidenceOf(value.evidence), notices, ...(value.noticeHash ? { noticeHash: value.noticeHash as string } : {}) };
}
export function normalizePartnerItemTermsResult(value: unknown, reference: PartnerItemTermsReference, actorUid: string, expectedHash?: string): PartnerItemTermsResult {
    exact(value, ['companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction', 'actorUid', 'requestHash', 'status', 'message']);
    if (!referenceMatches(value, reference) || value.actorUid !== actorUid || !['applied', 'duplicate', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !(hashOk(value.requestHash) || value.requestHash === null) || value.requestHash === null && !['cancelled', 'unknown'].includes(String(value.status)) || value.status === 'unknown' && value.requestHash !== null || expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash)
        throw Error('거래조건 저장 결과의 회사·계정·원문을 확인해 주세요.');
    return { ...reference, actorUid, requestHash: value.requestHash as string | null, status: value.status as PartnerItemTermsResult['status'], message: value.message };
}
