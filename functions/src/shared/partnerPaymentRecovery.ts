import { documentId } from './documentId';
export interface PartnerPaymentReference {
    companyId: 'taebaek' | 'punghoe';
    partnerId: string;
    operationId: string;
}
export interface PartnerPaymentRecoveryResult {
    version: 1;
    reference: PartnerPaymentReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
    cashEntryId?: string;
    docNo?: string;
    createdAt?: string;
    tradeDate?: string;
    amount?: number;
    cashAccountId?: string;
}
export interface PartnerPaymentListResult {
    version: 1;
    companyId: PartnerPaymentReference['companyId'];
    partnerId: string;
    actorUid: string;
    entries: PartnerPaymentRecoveryResult[];
    nextCursor: string | null;
}
export type PartnerPaymentRecoveryCommand = {
    mode: 'inspect' | 'cancel';
    reference: PartnerPaymentReference;
    requestText?: string;
} | {
    mode: 'list';
    companyId: PartnerPaymentReference['companyId'];
    partnerId: string;
    cursor?: string;
};
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !fields.includes(key)))
        throw Error('수금·지불 복구 요청 형식을 확인해 주세요.');
}
export const paymentCalendarDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
export const paymentCreatedAt = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const operationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export function normalizePartnerPaymentReference(value: unknown): PartnerPaymentReference {
    exact(value, ['companyId', 'partnerId', 'operationId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !documentId(value.partnerId) || !operationId(value.operationId))
        throw Error('수금·지불 요청의 회사·거래처·번호를 확인해 주세요.');
    return { companyId: value.companyId as PartnerPaymentReference['companyId'], partnerId: value.partnerId, operationId: value.operationId };
}
export const canonicalPartnerPaymentValue = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalPartnerPaymentValue)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, canonicalPartnerPaymentValue(field)])) : value;
export function serializePartnerPaymentRequest(value: Record<string, unknown>): string {
    if (value.note !== undefined && typeof value.note !== 'string')
        throw Error('보관된 메모 형식이 다릅니다.');
    return JSON.stringify(canonicalPartnerPaymentValue({ ...value, note: typeof value.note === 'string' ? value.note.trim() : '' }));
}
export function normalizePartnerPaymentRecoveryCommand(value: unknown): PartnerPaymentRecoveryCommand {
    exact(value, ['mode', 'reference', 'requestText', 'companyId', 'partnerId', 'cursor']);
    if (value.mode === 'list') {
        exact(value, ['mode', 'companyId', 'partnerId', 'cursor']);
        const reference = normalizePartnerPaymentReference({ companyId: value.companyId, partnerId: value.partnerId, operationId: 'list' });
        if (value.cursor !== undefined && !operationId(value.cursor))
            throw Error('수금·지불 목록의 다음 위치를 확인해 주세요.');
        return { mode: 'list', companyId: reference.companyId, partnerId: reference.partnerId, ...(value.cursor ? { cursor: value.cursor as string } : {}) };
    }
    exact(value, ['mode', 'reference', 'requestText']);
    if (!['inspect', 'cancel'].includes(String(value.mode)))
        throw Error('수금·지불 복구 종류를 확인해 주세요.');
    const reference = normalizePartnerPaymentReference(value.reference);
    if (value.requestText !== undefined) {
        if (typeof value.requestText !== 'string' || new TextEncoder().encode(value.requestText).byteLength > 700000)
            throw Error('보관된 수금 원문을 확인해 주세요.');
        const request = JSON.parse(value.requestText);
        if (!request || typeof request !== 'object' || request.operationId !== reference.operationId || request.partnerId !== reference.partnerId)
            throw Error('보관된 수금 원문의 거래처·번호가 다릅니다.');
        serializePartnerPaymentRequest(request);
    }
    return { mode: value.mode as 'inspect' | 'cancel', reference, ...(value.requestText !== undefined ? { requestText: value.requestText as string } : {}) };
}
export function normalizePartnerPaymentRecoveryResult(value: unknown, reference: PartnerPaymentReference, actorUid: string): PartnerPaymentRecoveryResult {
    exact(value, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message', 'cashEntryId', 'docNo', 'createdAt', 'tradeDate', 'amount', 'cashAccountId']);
    if (value.version !== 1 || JSON.stringify(normalizePartnerPaymentReference(value.reference)) !== JSON.stringify(normalizePartnerPaymentReference(reference)) || value.actorUid !== actorUid
        || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !value.message
        || (value.requestHash === null ? !['cancelled', 'unknown'].includes(String(value.status)) : typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash))
        || (value.status === 'applied' ? value.cashEntryId !== reference.operationId || typeof value.docNo !== 'string' || !value.docNo : value.cashEntryId !== undefined || value.docNo !== undefined))
        throw Error('수금·지불 결과의 회사·사용자·처리 근거를 확인하지 못했습니다.');
    const displayKeys = ['createdAt', 'tradeDate', 'amount', 'cashAccountId'];
    if (displayKeys.some(key => value[key] !== undefined) && value.status !== 'applied')
        throw Error('검증되지 않은 금융 표시 정보입니다.');
    if (value.createdAt !== undefined && !paymentCreatedAt(value.createdAt))
        throw Error('처리 시각을 확인하지 못했습니다.');
    if (value.tradeDate !== undefined && !paymentCalendarDay(value.tradeDate)
        || value.amount !== undefined && (typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount <= 0)
        || value.cashAccountId !== undefined && !documentId(value.cashAccountId))
        throw Error('최초 금융 원문의 표시 정보를 확인하지 못했습니다.');
    return { version: 1, reference: normalizePartnerPaymentReference(value.reference), actorUid, status: value.status as PartnerPaymentRecoveryResult['status'], requestHash: value.requestHash as string | null, message: value.message,
        ...(value.status === 'applied' ? { cashEntryId: value.cashEntryId as string, docNo: value.docNo as string } : {}),
        ...Object.fromEntries(displayKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) };
}
export function normalizePartnerPaymentListResult(value: unknown, companyId: PartnerPaymentReference['companyId'], partnerId: string, actorUid: string): PartnerPaymentListResult {
    exact(value, ['version', 'companyId', 'partnerId', 'actorUid', 'entries', 'nextCursor']);
    if (value.version !== 1 || value.companyId !== companyId || value.partnerId !== partnerId || value.actorUid !== actorUid || !Array.isArray(value.entries) || value.entries.length > 20 || (value.nextCursor !== null && !operationId(value.nextCursor)))
        throw Error('현재 거래처의 수금·지불 목록을 확인하지 못했습니다.');
    const entries = value.entries.map(entry => { const reference = normalizePartnerPaymentReference(entry.reference); if (reference.companyId !== companyId || reference.partnerId !== partnerId)
        throw Error('다른 거래처 결과입니다.'); return normalizePartnerPaymentRecoveryResult(entry, reference, actorUid); });
    if (new Set(entries.map(entry => entry.reference.operationId)).size !== entries.length)
        throw Error('중복 처리 결과입니다.');
    return { version: 1, companyId, partnerId, actorUid, entries, nextCursor: value.nextCursor as string | null };
}
export const normalizePartnerPaymentResult = normalizePartnerPaymentRecoveryResult;
export const normalizePartnerPaymentList = normalizePartnerPaymentListResult;
