export type OrderCopyRecoveryReference = {
    companyId: 'taebaek' | 'punghoe';
    requestId: string;
};
export type OrderCopyRecoveryResult = {
    version: 1;
    reference: OrderCopyRecoveryReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'stopped' | 'unknown';
    requestHash: string | null;
    message: string;
    orderId?: string;
    cardNo?: string;
    partnerName?: string;
    createdAt?: string;
};
export type OrderCopyRecoveryHistoryResult = {
    version: 1;
    companyId: OrderCopyRecoveryReference['companyId'];
    actorUid: string;
    entries: OrderCopyRecoveryResult[];
    nextCursor: string | null;
};
export type OrderCopyRecoveryCommand = {
    action: 'inspect' | 'stop';
    reference: OrderCopyRecoveryReference;
} | {
    action: 'listHistory';
    companyId: OrderCopyRecoveryReference['companyId'];
    cursor?: string;
};
const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('복사 주문 결과의 형식이 다릅니다.');
    return value as Record<string, unknown>;
};
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !value.includes('/');
export function normalizeOrderCopyRecoveryReference(value: unknown): OrderCopyRecoveryReference {
    const row = record(value);
    if (!['taebaek', 'punghoe'].includes(row.companyId as string) || !validId(row.requestId))
        throw Error('복사 주문의 회사·요청 번호를 확인해 주세요.');
    return { companyId: row.companyId as OrderCopyRecoveryReference['companyId'], requestId: row.requestId };
}
export function normalizeOrderCopyRecoveryResult(value: unknown, reference: OrderCopyRecoveryReference, actorUid: string): OrderCopyRecoveryResult {
    const row = record(value), actual = normalizeOrderCopyRecoveryReference(row.reference);
    if (row.version !== 1 || actual.companyId !== reference.companyId || actual.requestId !== reference.requestId || row.actorUid !== actorUid
        || !['applied', 'rejected', 'stopped', 'unknown'].includes(row.status as string) || typeof row.message !== 'string'
        || !(row.requestHash === null || typeof row.requestHash === 'string' && /^[a-f0-9]{64}$/.test(row.requestHash)))
        throw Error('복사 주문 결과의 회사·작성자·요청이 다릅니다.');
    if (['applied', 'rejected'].includes(row.status as string) && row.requestHash === null)
        throw Error('복사 주문 처리 원문 증거가 없습니다.');
    if (row.status === 'applied' && !validId(row.orderId))
        throw Error('생성된 주문 번호를 확인하지 못했습니다.');
    if (row.status === 'stopped' && row.requestHash !== null)
        throw Error('미처리 중단 증거가 다릅니다.');
    const result: OrderCopyRecoveryResult = { version: 1, reference: actual, actorUid, status: row.status as OrderCopyRecoveryResult['status'], requestHash: row.requestHash as string | null, message: row.message };
    for (const field of ['orderId', 'cardNo', 'partnerName', 'createdAt'] as const)
        if (row[field] !== undefined) {
            if (typeof row[field] !== 'string')
                throw Error('복사 주문 표시 정보가 다릅니다.');
            result[field] = row[field];
        }
    return result;
}
export function normalizeOrderCopyRecoveryHistoryResult(value: unknown, scope: {
    companyId: OrderCopyRecoveryReference['companyId'];
    actorUid: string;
}): OrderCopyRecoveryHistoryResult {
    const row = record(value);
    if (row.version !== 1 || row.companyId !== scope.companyId || row.actorUid !== scope.actorUid || !Array.isArray(row.entries) || row.entries.length > 50
        || !(row.nextCursor === null || typeof row.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(row.nextCursor)))
        throw Error('복사 주문 처리 기록의 범위가 다릅니다.');
    return { version: 1, ...scope, entries: row.entries.map(value => {
            const reference = normalizeOrderCopyRecoveryReference(record(value).reference);
            if (reference.companyId !== scope.companyId)
                throw Error('다른 회사의 주문 처리 기록입니다.');
            return normalizeOrderCopyRecoveryResult(value, reference, scope.actorUid);
        }), nextCursor: row.nextCursor as string | null };
}
