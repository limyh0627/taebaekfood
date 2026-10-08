"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteIssuedStatementCommand = exports.statementSourceIds = exports.statementOriginalHash = exports.statementDeletionHash = void 0;
exports.planStatementDeletion = planStatementDeletion;
exports.readStatementDeletion = readStatementDeletion;
exports.deleteIssuedStatement = deleteIssuedStatement;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const releaseGate_1 = require("./releaseGate");
const fail = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value.toMillis === 'function')
        return { timestampMillis: value.toMillis() };
    if (value instanceof Date)
        return { dateISO: value.toISOString() };
    return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
}
const statementDeletionHash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
exports.statementDeletionHash = statementDeletionHash;
const statementOriginalHash = (row) => (0, exports.statementDeletionHash)(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')));
exports.statementOriginalHash = statementOriginalHash;
const statementSourceIds = (row, kind) => {
    var _a;
    const values = kind === 'orders' ? String((_a = row.orderId) !== null && _a !== void 0 ? _a : '').split(/[\s,]+/) : [...(Array.isArray(row.purchaseOrderIds) ? row.purchaseOrderIds : []), ...(Array.isArray(row.confirmedProductIds) ? row.confirmedProductIds : []), row.sourcePoId];
    return [...new Set(values.filter((value) => typeof value === 'string' && !!value))].sort();
};
exports.statementSourceIds = statementSourceIds;
/** 기존 삭제 계약: 연결 두 필드·정산·전표만 삭제하고 재고·상태·번호는 건드리지 않는다. */
function planStatementDeletion(companyId, statementId, statement, links, state) {
    var _a, _b, _c;
    if (((_a = statement.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== companyId)
        fail('다른 회사의 전표는 삭제할 수 없습니다.');
    for (const row of links)
        if (((_b = row.data.companyId) !== null && _b !== void 0 ? _b : 'taebaek') !== companyId)
            fail('다른 회사의 연결 문서가 있습니다.');
    const partnerId = statement.partnerId;
    if (partnerId !== undefined && partnerId !== '' && (typeof partnerId !== 'string' || partnerId.includes('/')))
        fail('전표 거래처 연결이 잘못되었습니다.');
    const revision = (_c = state === null || state === void 0 ? void 0 : state.revision) !== null && _c !== void 0 ? _c : 0;
    if (state && (state.companyId !== companyId || state.partnerId !== partnerId))
        fail('거래처 정산 회사가 일치하지 않습니다.');
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1))
        fail('거래처 정산 상태가 손상되었습니다.');
    const clear = links.filter(row => row.kind !== 'settlements' && row.data.linkedStatementId === statementId);
    const remove = links.filter(row => row.kind === 'settlements' && row.data.statementId === statementId);
    if (clear.length + remove.length + (partnerId ? 3 : 2) > 500)
        fail('연결 문서가 너무 많아 삭제할 수 없습니다.');
    return { clear, remove, partnerId: partnerId || null, revision, revisionAfter: partnerId ? revision + 1 : null };
}
/** 삭제된 발행 ID는 원 발행 증거에 맞는 감사가 있을 때만 기존 번호를 반환한다. */
async function readStatementDeletion(db, tx, companyId, statementId, current, validatesCreation) {
    var _a;
    const rows = await tx.get(db.collection('voucherMutationOperations').where('statementIds', 'array-contains', statementId));
    if (!rows.size)
        return null;
    if (rows.size !== 1 || current.exists)
        fail('삭제된 전표의 발행 감사와 현재 원문이 다릅니다.');
    const receipt = rows.docs[0].data(), before = receipt.beforeSnapshot;
    if (receipt.companyId !== companyId || receipt.kind !== 'issuedStatements' || receipt.action !== 'delete' || receipt.status !== 'applied'
        || receipt.voucherId !== statementId || typeof receipt.createdBy !== 'string' || !receipt.createdBy || !before
        || ((_a = before.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== companyId || receipt.beforeHash !== (0, exports.statementOriginalHash)(before) || receipt.afterHash !== null
        || !validatesCreation(before))
        fail('원 발행과 전표 삭제 감사가 맞지 않습니다.');
    return before;
}
async function deleteIssuedStatement(db, companyId, actorId, input) {
    if (!actorId || !input || !/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId) || !/^[A-Za-z0-9_-]{1,160}$/.test(input.statementId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !/^[a-f0-9]{64}$/.test(input.expectedOriginalHash))
        throw new https_1.HttpsError('invalid-argument', '전표 삭제 입력이 잘못되었습니다.');
    const requestHash = (0, exports.statementDeletionHash)(Object.assign({ companyId, actorId }, input));
    const statementRef = db.collection('issuedStatements').doc(input.statementId), operationRef = db.collection('voucherMutationOperations').doc(input.operationId);
    const result = await db.runTransaction(async (tx) => {
        var _a, _b, _c;
        const gate = await tx.get((0, releaseGate_1.releaseGateRef)(db));
        const [prior, statement] = await Promise.all([tx.get(operationRef), tx.get(statementRef)]);
        if (prior.exists && prior.data().status === 'rejected') {
            const receipt = prior.data();
            if (receipt.companyId !== companyId || receipt.createdBy !== actorId || receipt.kind !== 'issuedStatements' || receipt.action !== 'delete'
                || receipt.voucherId !== input.statementId || receipt.requestHash !== requestHash || (0, exports.statementDeletionHash)(receipt.command) !== (0, exports.statementDeletionHash)(input)
                || !['invalid-argument', 'failed-precondition'].includes(receipt.failureCode) || typeof receipt.failureMessage !== 'string')
                fail('기존 삭제 거절 감사와 요청이 다릅니다.');
            return { status: 'rejected', failureCode: receipt.failureCode, failureMessage: receipt.failureMessage };
        }
        let writesStarted = false;
        try {
            (0, releaseGate_1.assertReleaseActive)(gate, input.releaseId);
            const partnerAtRead = statement.exists ? statement.data().partnerId : (_b = (_a = prior.data()) === null || _a === void 0 ? void 0 : _a.beforeSnapshot) === null || _b === void 0 ? void 0 : _b.partnerId;
            if (partnerAtRead !== undefined && partnerAtRead !== '' && (typeof partnerAtRead !== 'string' || partnerAtRead.includes('/')))
                fail('전표 거래처 연결이 잘못되었습니다.');
            const stateRef = partnerAtRead ? db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${partnerAtRead}`) : null;
            const state = stateRef ? await tx.get(stateRef) : null;
            const groups = ['orders', 'purchaseOrders', 'settlements'];
            const linked = await Promise.all(groups.map(kind => tx.get(db.collection(kind).where('companyId', '==', companyId).where(kind === 'settlements' ? 'statementId' : 'linkedStatementId', '==', input.statementId))));
            if (prior.exists) {
                const receipt = prior.data();
                if (receipt.kind !== 'issuedStatements' || receipt.action !== 'delete' || receipt.status !== 'applied' || receipt.companyId !== companyId
                    || receipt.createdBy !== actorId || receipt.requestHash !== requestHash || receipt.voucherId !== input.statementId
                    || receipt.beforeHash !== input.expectedOriginalHash || !receipt.beforeSnapshot || (0, exports.statementOriginalHash)(receipt.beforeSnapshot) !== receipt.beforeHash
                    || receipt.afterHash !== null || statement.exists || linked.some(rows => !rows.empty))
                    fail('기존 전표 삭제 작업과 요청이 다릅니다.');
                return { status: 'duplicate', id: input.statementId };
            }
            if (!statement.exists)
                fail('대상 전표를 찾을 수 없습니다.');
            const original = statement.data();
            if ((0, exports.statementOriginalHash)(original) !== input.expectedOriginalHash || ((_c = original.mutationRevision) !== null && _c !== void 0 ? _c : 0) !== input.expectedRevision)
                fail('전표가 변경되었습니다. 다시 확인해 주세요.');
            const partnerId = original.partnerId;
            const refs = groups.map((kind, index) => {
                const ids = new Set(linked[index].docs.map(doc => doc.id));
                if (kind !== 'settlements')
                    (0, exports.statementSourceIds)(original, kind).forEach(id => ids.add(id));
                return [...ids].map(id => { if (id.includes('/'))
                    fail('전표 연결 ID가 잘못되었습니다.'); return db.collection(kind).doc(id); });
            });
            const snapshots = await Promise.all(refs.flat().map(ref => tx.get(ref)));
            const links = snapshots.filter(snap => snap.exists).map(snap => ({ kind: snap.ref.parent.id, id: snap.id, data: snap.data() }));
            const plan = planStatementDeletion(companyId, input.statementId, original, links, (state === null || state === void 0 ? void 0 : state.exists) ? state.data() : null);
            writesStarted = true;
            for (const row of plan.clear)
                tx.update(db.collection(row.kind).doc(row.id), { linkedStatementId: admin.firestore.FieldValue.delete(), linkedStatementAt: admin.firestore.FieldValue.delete() });
            for (const row of plan.remove)
                tx.delete(db.collection('settlements').doc(row.id));
            if (stateRef) {
                if (state === null || state === void 0 ? void 0 : state.exists)
                    tx.update(stateRef, { revision: plan.revisionAfter });
                else
                    tx.create(stateRef, { companyId, partnerId, revision: plan.revisionAfter });
            }
            tx.delete(statementRef);
            tx.create(operationRef, { companyId, kind: 'issuedStatements', action: 'delete', status: 'applied', voucherId: input.statementId, statementIds: [input.statementId],
                requestHash, command: input, expectedRevision: input.expectedRevision, beforeSnapshot: original, beforeHash: input.expectedOriginalHash, afterHash: null,
                clearedLinks: plan.clear.map(row => { var _a; return (Object.assign({ kind: row.kind, id: row.id, companyId: (_a = row.data.companyId) !== null && _a !== void 0 ? _a : companyId, linkedStatementId: row.data.linkedStatementId }, (row.data.linkedStatementAt !== undefined ? { linkedStatementAt: row.data.linkedStatementAt } : {}))); }), deletedSettlements: plan.remove, partnerId: plan.partnerId, revisionBefore: plan.revision, revisionAfter: plan.revisionAfter, createdBy: actorId, createdAt: new Date().toISOString() });
            return { status: 'applied', id: input.statementId };
        }
        catch (error) {
            if (prior.exists || writesStarted || !(error instanceof https_1.HttpsError) || !['invalid-argument', 'failed-precondition'].includes(error.code))
                throw error;
            tx.create(operationRef, { companyId, kind: 'issuedStatements', action: 'delete', status: 'rejected', voucherId: input.statementId,
                command: input, requestHash, createdBy: actorId, createdAt: new Date().toISOString(), failureCode: error.code, failureMessage: error.message });
            return { status: 'rejected', failureCode: error.code, failureMessage: error.message };
        }
    });
    if (result.status === 'rejected')
        throw new https_1.HttpsError(result.failureCode, result.failureMessage, { operationStatus: 'rejected', operationId: input.operationId, statementId: input.statementId, companyId, requestHash });
    return result;
}
exports.deleteIssuedStatementCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    var _a;
    const companyId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.companyId;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (request.auth.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(String(companyId)))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return deleteIssuedStatement(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=deleteIssuedStatementCommand.js.map