import type * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { readCashCreationMutation } from './cashMutationReceipt';
import { canonicalPartnerPaymentValue, paymentCalendarDay, paymentCreatedAt, type PartnerPaymentReference, type PartnerPaymentRecoveryResult } from './shared/partnerPaymentRecovery';
type Row = Record<string, any>;
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalPartnerPaymentValue(value))).digest('hex');
/** 전표 연결 조회와 독립 복구가 같은 현금 원문·수정 감사·정산 근거로 완료를 판정한다. */
export async function readPartnerPaymentReceipt(db: admin.firestore.Firestore, tx: admin.firestore.Transaction, reference: PartnerPaymentReference, actorUid: string, expectedRequestHash?: string): Promise<PartnerPaymentRecoveryResult> {
    const { companyId, partnerId, operationId } = reference;
    const result = (status: PartnerPaymentRecoveryResult['status'], requestHash: string | null, message: string): PartnerPaymentRecoveryResult => ({ version: 1, reference, actorUid, status, requestHash, message });
    const operation = await tx.get(db.collection('partnerPaymentOperations').doc(operationId));
    const entry = await tx.get(db.collection('cashEntries').doc(operationId));
    const other = await tx.get(db.collection('issuedStatements').doc(operationId));
    const settlements = await tx.get(db.collection('settlements').where('operationId', '==', operationId));
    const unknown = () => result('unknown', null, '이 요청의 확정된 금융 처리 근거를 아직 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.');
    if (!operation.exists)
        return unknown();
    const prior = operation.data()!;
    if (prior.companyId !== companyId || prior.createdBy !== actorUid || prior.partnerId !== partnerId)
        throw new HttpsError('permission-denied', '다른 회사·사용자·거래처의 수금 요청입니다.');
    const requestHash = prior.requestHash;
    if (expectedRequestHash !== undefined && !(prior.status === 'cancelled' && requestHash === null) && requestHash !== expectedRequestHash)
        throw new HttpsError('failed-precondition', '보관된 수금 원문과 서버 처리 원문이 다릅니다.');
    const validHash = typeof requestHash === 'string' && /^[a-f0-9]{64}$/.test(requestHash);
    // 금융 문서가 지워져도 과거 현금 변경 감사가 있으면 금융0으로 확정할 수 없다.
    if (prior.status === 'cancelled' || prior.status === 'rejected') {
        const mutations = await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds', 'array-contains', operationId));
        if (mutations.docs.length > 0) return unknown();
    }
    if (prior.status === 'cancelled') {
        if (entry.exists || other.exists || settlements.docs.length > 0 || (requestHash !== null && !validHash)
            || prior.financialWrites !== false || !paymentCreatedAt(prior.cancelledAt))
            return unknown();
        return result('cancelled', requestHash, '이 수금·지불 요청은 적용 전에 중단됐습니다. 늦게 도착하는 같은 요청도 금융 자료를 만들지 않습니다.');
    }
    if (!validHash)
        return unknown();
    if (prior.status === 'rejected') {
        if (entry.exists || other.exists || settlements.docs.length > 0 || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
            || typeof prior.failureMessage !== 'string' || !prior.failureMessage)
            return unknown();
        return result('rejected', requestHash, prior.failureMessage);
    }
    if (prior.status !== undefined && prior.status !== 'applied')
        return unknown();
    if (other.exists || typeof prior.docNo !== 'string' || !prior.docNo || prior.cashEntryId !== operationId)
        return unknown();
    const validates = (row: Row) => row.companyId === companyId && row.partnerId === partnerId
        && row.issueOperationId === operationId && row.issuePayloadHash === requestHash
        && row.issuePrefix === (prior.issuePrefix ?? '') && row.docNo === prior.docNo
        && fingerprint({ companyId: row.companyId, partnerId: row.partnerId, date: row.date, cashAccountId: row.cashAccountId,
            dir: row.dir, amount: row.amount, lines: row.lines, note: row.note }) === prior.entryHash;
    try {
        const original = await readCashCreationMutation(db, tx, companyId, operationId, entry, validates);
        const unchanged = entry.exists && (entry.data()!.mutationRevision ?? 0) === 0 && validates(entry.data()!);
        const stored: Row[] = prior.settlements ?? [];
        const settlementMatch = Array.isArray(stored) && settlements.docs.length === stored.length && stored.every(row => {
            const document = settlements.docs.find(doc => doc.id === `st-${operationId}-${row.statementId}`)?.data();
            return document && document.companyId === companyId && document.cashEntryId === operationId
                && document.statementId === row.statementId && document.amount === row.amount;
        });
        if (original || unchanged && settlementMatch) {
            const source = original ?? entry.data()!;
            const display = paymentCalendarDay(source.date) && Number.isSafeInteger(source.amount) && source.amount > 0 && typeof source.cashAccountId === 'string'
                ? { tradeDate: source.date, amount: source.amount, cashAccountId: source.cashAccountId } : {};
            const createdAt = paymentCreatedAt(prior.createdAt) ? { createdAt: prior.createdAt } : {};
            return { ...result('applied', requestHash, '최초 수금·지불 요청의 반영을 확인했습니다.'), cashEntryId: operationId, docNo: prior.docNo, ...display, ...createdAt };
        }
    }
    catch (error) {
        if (!(error instanceof HttpsError))
            throw error;
    }
    return unknown();
}
