import { cleanupValidId } from './partnerItemCleanup';
export interface StatementEditRecoveryReference {
    companyId: 'taebaek' | 'punghoe';
    operationId: string;
    statementId: string;
}
export interface StatementEditRecoveryResult {
    version: 1;
    reference: StatementEditRecoveryReference;
    actorUid: string;
    status: 'applied' | 'cancelled' | 'unknown';
    requestHash: string | null;
    revision?: number;
    message: string;
}
export interface StatementEditRecoveryHistoryResult {
    version: 1;
    companyId: StatementEditRecoveryReference['companyId'];
    actorUid: string;
    entries: {
        result: StatementEditRecoveryResult;
        createdAt: string;
    }[];
    nextCursor: string | null;
}
export type StatementEditRecoveryCommand = {
    mode: 'inspect' | 'cancel';
    reference: StatementEditRecoveryReference;
} | {
    mode: 'listHistory';
    companyId: StatementEditRecoveryReference['companyId'];
    cursor?: string;
};
function row(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('전표 수정 처리 기록 형식이 올바르지 않습니다.');
    return value as Record<string, unknown>;
}
export function normalizeStatementEditRecoveryReference(value: unknown): StatementEditRecoveryReference {
    const v = row(value);
    if (Object.keys(v).some(k => !['companyId', 'operationId', 'statementId'].includes(k)) || !['taebaek', 'punghoe'].includes(String(v.companyId)) || typeof v.operationId !== 'string' || !/^[\w-]{8,150}$/.test(v.operationId) || !cleanupValidId(v.statementId) || v.statementId.length > 150)
        throw Error('전표 수정 요청 번호를 확인해 주세요.');
    return { companyId: v.companyId as StatementEditRecoveryReference['companyId'], operationId: v.operationId, statementId: v.statementId };
}
export function normalizeStatementEditRecoveryResult(value: unknown, reference: StatementEditRecoveryReference, actorUid: string): StatementEditRecoveryResult {
    const v = row(value), ref = normalizeStatementEditRecoveryReference(v.reference);
    if (v.version !== 1 || JSON.stringify(ref) !== JSON.stringify(normalizeStatementEditRecoveryReference(reference)) || v.actorUid !== actorUid || !actorUid || !['applied', 'duplicate', 'cancelled', 'unknown'].includes(String(v.status)) || typeof v.message !== 'string' || (v.requestHash !== null && (typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash))) || (['applied', 'duplicate'].includes(String(v.status)) && (typeof v.requestHash !== 'string' || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1)) || (v.revision !== undefined && (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0)))
        throw Error('전표 수정 처리 기록의 회사·사용자·요청 근거가 다릅니다.');
    return { version: 1, reference: ref, actorUid, status: (v.status === 'duplicate' ? 'applied' : v.status) as StatementEditRecoveryResult['status'], requestHash: v.requestHash as string | null, ...(v.revision !== undefined ? { revision: v.revision as number } : {}), message: v.message };
}
export function normalizeStatementEditRecoveryHistoryResult(value: unknown, companyId: StatementEditRecoveryReference['companyId'], actorUid: string): StatementEditRecoveryHistoryResult {
    const v = row(value);
    if (v.version !== 1 || v.companyId !== companyId || v.actorUid !== actorUid || !Array.isArray(v.entries) || v.entries.length > 50 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || v.nextCursor.length > 2048)))
        throw Error('전표 수정 이력의 회사·사용자를 확인해 주세요.');
    return { version: 1, companyId, actorUid, entries: v.entries.map(entry => {
            const e = row(entry), r = row(e.result);
            const ref = normalizeStatementEditRecoveryReference(r.reference);
            if (ref.companyId !== companyId || typeof e.createdAt !== 'string')
                throw Error('전표 수정 이력 근거가 다릅니다.');
            return { result: normalizeStatementEditRecoveryResult(r, ref, actorUid), createdAt: e.createdAt };
        }), nextCursor: v.nextCursor as string | null };
}
