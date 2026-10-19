export type PartnerAdvanceRecoveryReference = {
    companyId: 'taebaek' | 'punghoe';
    partnerId: string;
    operationId: string;
};
export type PartnerAdvanceRecoveryResult = {
    version: 1;
    reference: PartnerAdvanceRecoveryReference;
    actorId: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    action?: 'apply' | 'cancel';
    requestHash: string | null;
    message: string;
    statementId?: string;
    docNo?: string;
    amount?: number;
    date?: string;
};
export type PartnerAdvanceRecoveryHistoryResult = {
    version: 1;
    companyId: PartnerAdvanceRecoveryReference['companyId'];
    partnerId: string;
    actorId: string;
    entries: PartnerAdvanceRecoveryResult[];
    nextCursor: string | null;
};
export type PartnerAdvanceRecoveryCommand = {
    mode: 'inspect' | 'stop';
    reference: PartnerAdvanceRecoveryReference;
} | {
    mode: 'listHistory';
    companyId: PartnerAdvanceRecoveryReference['companyId'];
    partnerId: string;
    cursor?: string;
};
const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('상계 복구 응답 형식이 다릅니다.');
    return value as Record<string, unknown>;
};
const key = (value: unknown, max: number): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
export function normalizePartnerAdvanceRecoveryReference(value: unknown): PartnerAdvanceRecoveryReference {
    const row = record(value);
    if (!['taebaek', 'punghoe'].includes(row.companyId as string) || !key(row.partnerId, 150) || !key(row.operationId, 120))
        throw new Error('상계 요청 식별 정보를 확인해 주세요.');
    return { companyId: row.companyId as PartnerAdvanceRecoveryReference['companyId'], partnerId: row.partnerId, operationId: row.operationId };
}
export function normalizePartnerAdvanceRecoveryResult(value: unknown, reference: PartnerAdvanceRecoveryReference, actorId: string): PartnerAdvanceRecoveryResult {
    const row = record(value), actual = normalizePartnerAdvanceRecoveryReference(row.reference);
    if (row.version !== 1 || actual.companyId !== reference.companyId || actual.partnerId !== reference.partnerId || actual.operationId !== reference.operationId || row.actorId !== actorId
        || !['applied', 'rejected', 'cancelled', 'unknown'].includes(row.status as string) || typeof row.message !== 'string'
        || !(row.requestHash === null || typeof row.requestHash === 'string' && /^[a-f0-9]{64}$/.test(row.requestHash)))
        throw new Error('상계 결과의 회사·작성자·요청이 다릅니다.');
    if (row.action !== undefined && row.action !== 'apply' && row.action !== 'cancel')
        throw new Error('상계 처리 종류가 다릅니다.');
    if ((row.status === 'applied' || row.status === 'rejected') && (row.requestHash === null || row.action === undefined))
        throw new Error('상계 원문 증거가 없습니다.');
    if (row.status === 'applied' && (!key(row.statementId, 180) || typeof row.docNo !== 'string' || !row.docNo))
        throw new Error('상계 전표 증거가 없습니다.');
    const result: PartnerAdvanceRecoveryResult = { version: 1, reference: actual, actorId, status: row.status as PartnerAdvanceRecoveryResult['status'], requestHash: row.requestHash as string | null, message: row.message };
    if (row.action !== undefined)
        result.action = row.action as 'apply' | 'cancel';
    for (const field of ['statementId', 'docNo', 'date'] as const) {
        if (row[field] !== undefined) {
            if (typeof row[field] !== 'string')
                throw new Error('상계 표시 정보가 다릅니다.');
            result[field] = row[field];
        }
    }
    if (row.amount !== undefined) {
        if (!Number.isSafeInteger(row.amount) || (row.amount as number) <= 0)
            throw new Error('상계 금액 증거가 다릅니다.');
        result.amount = row.amount as number;
    }
    return result;
}
export function normalizePartnerAdvanceRecoveryHistoryResult(value: unknown, scope: {
    companyId: PartnerAdvanceRecoveryReference['companyId'];
    partnerId: string;
    actorId: string;
}): PartnerAdvanceRecoveryHistoryResult {
    const row = record(value);
    if (row.version !== 1 || row.companyId !== scope.companyId || row.partnerId !== scope.partnerId || row.actorId !== scope.actorId || !Array.isArray(row.entries) || row.entries.length > 50 || !(row.nextCursor === null || key(row.nextCursor, 2048)))
        throw new Error('상계 처리 이력의 범위가 다릅니다.');
    return { version: 1, ...scope, entries: row.entries.map(value => { const ref = normalizePartnerAdvanceRecoveryReference(record(value).reference); if (ref.companyId !== scope.companyId || ref.partnerId !== scope.partnerId)
            throw new Error('다른 거래처 이력입니다.'); return normalizePartnerAdvanceRecoveryResult(value, ref, scope.actorId); }), nextCursor: row.nextCursor as string | null };
}
/** 기존 상계 requestHash와 같은 canonical JSON이며 해시는 기존 정본에서 계산한다. */
export function serializePartnerAdvanceRecoveryRequest(value: {
    companyId: string;
    actorId: string;
    action: 'apply' | 'cancel';
    command: unknown;
}): string {
    const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
        : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : input;
    return JSON.stringify(canonical(value));
}
