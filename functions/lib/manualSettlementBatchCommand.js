"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceManualSettlementBatchCommand = void 0;
exports.replaceManualSettlementBatch = replaceManualSettlementBatch;
const returnClaimReader_1 = require("./returnClaimReader");
const admin = require("firebase-admin");
const partnerCutover_1 = require("./partnerCutover");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const partnerPaymentCommand_1 = require("./partnerPaymentCommand");
const releaseGate_1 = require("./releaseGate");
const invalid = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
const conflict = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const owner = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const manual = (row, id) => !id.startsWith('st-') && row.manual === true && !row.operationId
    && !row.returnOperationId && !row.transferOperationId && !row.issueOperationId
    && row.serverOwned !== true;
/** Replaces every manual allocation for one cash entry in a single transaction. */
async function replaceManualSettlementBatch(db, companyId, actorId, input) {
    if (!actorId || !input || typeof input !== 'object'
        || !/^[A-Za-z0-9_-]{1,120}$/.test(input.operationId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
        || typeof input.cashEntryId !== 'string' || !input.cashEntryId
        || typeof input.partnerId !== 'string' || !input.partnerId
        || !Number.isSafeInteger(input.expectedPartnerRevision) || input.expectedPartnerRevision < 0
        || !Array.isArray(input.allocations) || input.allocations.length > 200
        || input.allocations.some(row => !row || typeof row.statementId !== 'string'
            || !row.statementId || !positive(row.amount))
        || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length)
        invalid('수동 상계 배분 입력이 잘못되었습니다.');
    const allocations = [...input.allocations].sort((a, b) => a.statementId.localeCompare(b.statementId));
    const requestHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify({ companyId, cashEntryId: input.cashEntryId,
        partnerId: input.partnerId, allocations, expectedPartnerRevision: input.expectedPartnerRevision,
        releaseId: input.releaseId })).digest('hex');
    const operationRef = db.collection('manualSettlementBatchOperations').doc(input.operationId);
    const cashRef = db.collection('cashEntries').doc(input.cashEntryId);
    const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
    const cutoverRef = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f;
        const [operationSnap, cashSnap, stateSnap, cutoverSnap, releaseSnap, partnerSnap, statementRows, settlementRows, returnRows] = await Promise.all([
            tx.get(operationRef), tx.get(cashRef), tx.get(stateRef), tx.get(cutoverRef),
            tx.get((0, releaseGate_1.releaseGateRef)(db)), tx.get(db.collection('partners').doc(input.partnerId)),
            tx.get(db.collection('issuedStatements').where('partnerId', '==', input.partnerId)),
            tx.get(db.collection('settlements')),
            tx.get(db.collection('returnApplications').where('partnerId', '==', input.partnerId)),
        ]);
        (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
        const old = settlementRows.docs.filter(doc => doc.data().cashEntryId === input.cashEntryId && manual(doc.data(), doc.id));
        if (operationSnap.exists) {
            const previous = operationSnap.data();
            const current = settlementRows.docs.filter(doc => doc.data().cashEntryId === input.cashEntryId && manual(doc.data(), doc.id));
            if (previous.companyId !== companyId || previous.partnerId !== input.partnerId
                || previous.cashEntryId !== input.cashEntryId || previous.requestHash !== requestHash
                || previous.createdBy !== actorId || current.length !== allocations.length || current.some(doc => !manual(doc.data(), doc.id)
                || owner(doc.data()) !== companyId || !allocations.some(row => doc.id === `manual-${input.operationId}-${row.statementId}` && row.statementId === doc.data().statementId && row.amount === doc.data().amount)))
                conflict('기존 수동 상계 작업과 현재 배분이 다릅니다.');
            return { status: 'duplicate', revision: previous.revision };
        }
        const cutover = cutoverSnap.data();
        if (!cutoverSnap.exists || (cutover === null || cutover === void 0 ? void 0 : cutover.companyId) !== companyId || (cutover === null || cutover === void 0 ? void 0 : cutover.enabled) !== true
            || (cutover === null || cutover === void 0 ? void 0 : cutover.legacyWritersBlocked) !== true || (cutover === null || cutover === void 0 ? void 0 : cutover.auditPassed) !== true)
            conflict('정산 writer 전환이 준비되지 않았습니다.');
        if ((0, partnerCutover_1.partnerQuarantined)(cutover, input.partnerId))
            conflict('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
        const revision = stateSnap.exists ? (_a = stateSnap.data()) === null || _a === void 0 ? void 0 : _a.revision : 0;
        if (!Number.isSafeInteger(revision) || revision !== input.expectedPartnerRevision)
            conflict('거래처 정산 상태가 변경되었습니다.');
        const source = cashSnap.data();
        if (!source)
            throw new https_1.HttpsError('failed-precondition', '자금전표가 없습니다.');
        if (owner(source) !== companyId || source.partnerId !== input.partnerId
            || !partnerSnap.exists || owner(partnerSnap.data()) !== companyId)
            conflict('자금전표·거래처의 회사가 맞지 않습니다.');
        if (source.transferOperationId || source.loanMovementOperationId
            || source.partnerPaymentOperationId || !['입금', '출금'].includes(source.dir) || !positive(source.amount))
            conflict('수동 정산할 수 없는 자금전표입니다.');
        const cash = (0, partnerPaymentCommand_1.cashFromEntry)(input.cashEntryId, source);
        if (!cash || cash.parts.some(part => !Number.isSafeInteger(part.reduce)))
            conflict('자금전표 정산 계정이 불명확합니다.');
        const claims = await (0, returnClaimReader_1.readClaimsAfterReturns)(db, tx, statementRows.docs.filter(doc => owner(doc.data()) === companyId)
            .map(doc => (0, partnerPaymentCommand_1.claimFromStatement)(doc.id, doc.data())).filter((row) => row !== null), returnRows.docs.filter(doc => owner(doc.data()) === companyId)
            .map(doc => (Object.assign({ id: doc.id }, doc.data()))), statementRows.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))));
        const byClaim = new Map(claims.map(row => [row.id, row]));
        const claimUsed = new Map();
        const cashUsed = new Map();
        for (const doc of settlementRows.docs) {
            const row = doc.data();
            if (old.some(prior => prior.id === doc.id))
                continue;
            const claim = byClaim.get(row.statementId);
            if (!claim && row.cashEntryId !== input.cashEntryId)
                continue;
            if (!claim)
                throw new https_1.HttpsError('failed-precondition', '기존 정산 연결이 불명확합니다.');
            if (owner(row) !== companyId || !positive(row.amount))
                conflict('기존 정산 연결이 불명확합니다.');
            const linkedCash = await tx.get(db.collection('cashEntries').doc(row.cashEntryId));
            if (!linkedCash.exists || owner(linkedCash.data()) !== companyId || ((_b = linkedCash.data()) === null || _b === void 0 ? void 0 : _b.partnerId) !== input.partnerId)
                conflict('기존 정산 자금 원문이 불명확합니다.');
            claimUsed.set(claim.id, ((_c = claimUsed.get(claim.id)) !== null && _c !== void 0 ? _c : 0) + row.amount);
            if (row.cashEntryId === input.cashEntryId)
                cashUsed.set(claim.accountCode, ((_d = cashUsed.get(claim.accountCode)) !== null && _d !== void 0 ? _d : 0) + row.amount);
        }
        for (const row of old) {
            if (owner(row.data()) !== companyId || !positive(row.data().amount)
                || !byClaim.has(row.data().statementId))
                conflict('기존 수동 정산 연결이 불명확합니다.');
        }
        for (const row of allocations) {
            const claim = byClaim.get(row.statementId);
            if (!claim)
                throw new https_1.HttpsError('failed-precondition', '원전표가 없습니다.');
            if (claim.partnerId !== input.partnerId || claim.companyId !== companyId)
                conflict('원전표의 회사·거래처가 맞지 않습니다.');
            const eligible = cash.parts.filter(part => part.accountCode === claim.accountCode)
                .reduce((sum, part) => sum + part.reduce, 0);
            if (!Number.isSafeInteger(eligible) || eligible <= 0 || eligible > source.amount)
                conflict('원전표와 자금전표의 방향·계정이 맞지 않습니다.');
            claimUsed.set(claim.id, ((_e = claimUsed.get(claim.id)) !== null && _e !== void 0 ? _e : 0) + row.amount);
            cashUsed.set(claim.accountCode, ((_f = cashUsed.get(claim.accountCode)) !== null && _f !== void 0 ? _f : 0) + row.amount);
        }
        const allocatedCash = [...cashUsed.values()].reduce((sum, value) => sum + value, 0);
        if (!Number.isSafeInteger(allocatedCash) || allocatedCash > source.amount || [...claimUsed].some(([id, used]) => !Number.isSafeInteger(used) || used > byClaim.get(id).amount)
            || [...cashUsed].some(([code, used]) => !Number.isSafeInteger(used)
                || used > cash.parts.filter(part => part.accountCode === code)
                    .reduce((sum, part) => sum + part.reduce, 0)))
            conflict('원전표 잔액 또는 자금전표 한도를 넘습니다.');
        const createdAt = new Date().toISOString();
        for (const row of old)
            tx.delete(row.ref);
        for (const row of allocations)
            tx.create(db.collection('settlements').doc(`manual-${input.operationId}-${row.statementId}`), {
                companyId, cashEntryId: input.cashEntryId, statementId: row.statementId,
                amount: row.amount, manual: true, createdAt, createdBy: actorId
            });
        if (stateSnap.exists)
            tx.update(stateRef, { revision: revision + 1 });
        else
            tx.create(stateRef, { companyId, partnerId: input.partnerId, revision: 1 });
        tx.create(operationRef, { companyId, partnerId: input.partnerId, cashEntryId: input.cashEntryId,
            requestHash, revision: revision + 1, createdAt, createdBy: actorId });
        return { status: 'applied', revision: revision + 1 };
    });
}
exports.replaceManualSettlementBatchCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return replaceManualSettlementBatch(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=manualSettlementBatchCommand.js.map