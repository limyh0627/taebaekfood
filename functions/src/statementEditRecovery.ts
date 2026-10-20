import * as admin from 'firebase-admin';
import { cashOriginalHash } from './cashMutationReceipt';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeStatementEditRecoveryReference, normalizeStatementEditRecoveryResult, type StatementEditRecoveryReference, type StatementEditRecoveryResult } from './shared/statementEditRecovery';
export const statementEditDiscoveryScopeKey = (companyId: string, uid: string) => JSON.stringify([companyId, uid, 'edit-statement']);
export function statementEditReceiptResult(data: admin.firestore.DocumentData, reference: StatementEditRecoveryReference, uid: string): StatementEditRecoveryResult {
    if (data.companyId !== reference.companyId || data.uid !== uid || data.statementId !== reference.statementId || data.action !== 'edit-statement' || data.kind !== 'issuedStatements' || !['applied', 'cancelled'].includes(data.status))
        throw new HttpsError('permission-denied', '이 회사·사용자의 전표 수정 기록이 아닙니다.');
    if (data.status === 'applied' && (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 || data.revision !== data.expectedRevision + 1 || !data.beforeSnapshot || (data.beforeSnapshot.companyId ?? 'taebaek') !== reference.companyId || data.beforeHash !== cashOriginalHash(data.beforeSnapshot) || !/^[a-f0-9]{64}$/.test(data.afterHash ?? '')))
        throw new HttpsError('failed-precondition', '전표 수정의 버전·원문 감사 근거를 확인하지 못했습니다.');
    try {
        return normalizeStatementEditRecoveryResult({ version: 1, reference, actorUid: uid, status: data.status, requestHash: data.requestHash, revision: data.revision, message: data.status === 'applied' ? '이 전표 수정 요청은 적용됐습니다. 이후 변경이나 삭제 여부는 현재 전표를 별도로 확인해 주세요.' : '이 미처리 전표 수정 요청을 중단했습니다. 이미 적용된 다른 수정은 되돌리지 않습니다.' }, reference, uid);
    }
    catch {
        throw new HttpsError('failed-precondition', '전표 수정 영수증의 근거를 확인하지 못했습니다. 원문을 보존해 주세요.');
    }
}
export async function recoverStatementEdit(db: admin.firestore.Firestore, request: {
    auth?: {
        uid: string;
        token: Record<string, any>;
    };
    data?: any;
}) {
    const actor = request.auth, token = actor?.token, input = request.data;
    if (!actor?.uid || token?.isAdmin !== true || typeof token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(token.companyId))
        throw new HttpsError('permission-denied', '이 회사의 전표 수정 기록을 확인할 권한이 없습니다.');
    if (input?.mode === 'listHistory') {
        if (input.companyId !== token.companyId || Object.keys(input).some(k => !['mode', 'companyId', 'cursor'].includes(k)))
            throw new HttpsError('permission-denied', '현재 회사의 수정 이력만 확인할 수 있습니다.');
        let after: string | undefined;
        if (input.cursor !== undefined) {
            try {
                if (typeof input.cursor !== 'string' || input.cursor.length > 2048)
                    throw Error();
                const value = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
                if (value[0] !== input.companyId || value[1] !== actor.uid || typeof value[2] !== 'string' || !value[2] || value[2].includes('/'))
                    throw Error();
                after = value[2];
            }
            catch {
                throw new HttpsError('invalid-argument', '이력 페이지의 회사·사용자를 다시 확인해 주세요.');
            }
        }
        let query = db.collection('voucherMutationOperations').where('discoveryScopeKey', '==', statementEditDiscoveryScopeKey(input.companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (after)
            query = query.startAfter(after);
        const page = await query.get();
        const entries = page.docs.filter(doc => doc.get('companyId') === input.companyId && doc.get('action') === 'edit-statement' && doc.get('kind') === 'issuedStatements').map(doc => {
            const d = doc.data(), ref = normalizeStatementEditRecoveryReference({ companyId: d.companyId, operationId: doc.id, statementId: d.statementId });
            return { result: statementEditReceiptResult(d, ref, actor.uid), createdAt: typeof d.createdAt === 'string' ? d.createdAt : d.createdAt?.toDate?.().toISOString() ?? '' };
        });
        return { version: 1, companyId: input.companyId, actorUid: actor.uid, entries, nextCursor: page.size === 50 ? Buffer.from(JSON.stringify([input.companyId, actor.uid, page.docs[49].id])).toString('base64url') : null };
    }
    let reference: StatementEditRecoveryReference;
    try {
        if (!['inspect', 'cancel'].includes(input?.mode) || Object.keys(input).some(k => !['mode', 'reference'].includes(k)))
            throw Error();
        reference = normalizeStatementEditRecoveryReference(input.reference);
    }
    catch {
        throw new HttpsError('invalid-argument', '전표 수정 요청 번호를 확인해 주세요.');
    }
    if (reference.companyId !== token.companyId)
        throw new HttpsError('permission-denied', '다른 회사의 전표 수정 요청은 확인할 수 없습니다.');
    const operation = db.collection('voucherMutationOperations').doc(reference.operationId);
    return db.runTransaction(async (tx) => {
        const existing = await tx.get(operation);
        if (existing.exists)
            return statementEditReceiptResult(existing.data()!, reference, actor.uid);
        if (input.mode === 'inspect')
            return { version: 1, reference, actorUid: actor.uid, status: 'unknown' as const, requestHash: null, message: '서버에 이 수정 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 다시 확인하거나 미처리 요청을 중단해 주세요.' };
        const target = await tx.get(db.collection('issuedStatements').doc(reference.statementId));
        if (target.exists && (target.get('companyId') ?? 'taebaek') !== reference.companyId)
            throw new HttpsError('permission-denied', '다른 회사 전표의 수정 요청은 중단할 수 없습니다.');
        const result: StatementEditRecoveryResult = { version: 1, reference, actorUid: actor.uid, status: 'cancelled', requestHash: null, message: '이 미처리 전표 수정 요청을 중단했습니다. 이미 적용된 다른 수정은 되돌리지 않습니다.' };
        tx.create(operation, { statementId: reference.statementId, companyId: reference.companyId, uid: actor.uid, action: 'edit-statement', kind: 'issuedStatements', status: 'cancelled', requestHash: null, discoveryScopeKey: statementEditDiscoveryScopeKey(reference.companyId, actor.uid), createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return result;
    });
}
