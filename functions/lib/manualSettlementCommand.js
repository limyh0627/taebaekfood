"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mutateManualSettlementCommand = void 0;
exports.mutateManualSettlement = mutateManualSettlement;
const admin = require("firebase-admin");
const partnerCutover_1 = require("./partnerCutover");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const partnerPaymentCommand_1 = require("./partnerPaymentCommand");
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const releaseGate_1 = require("./releaseGate");
const bad = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
const owner = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
const hash = (input, companyId) => {
    var _a, _b;
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify({ companyId,
        operationId: input.operationId, action: input.action, partnerId: input.partnerId,
        cashEntryId: input.cashEntryId, statementId: input.statementId, amount: input.amount,
        expectedAmount: (_a = input.expectedAmount) !== null && _a !== void 0 ? _a : null, settlementId: (_b = input.settlementId) !== null && _b !== void 0 ? _b : null,
        expectedRevision: input.expectedRevision, releaseId: input.releaseId })).digest('hex');
};
const positive = (value) => Number.isSafeInteger(value) && value > 0;
/** 수동 연결만 변경한다. 발행·반품 명령이 소유한 정산 행은 수정하지 않는다. */
async function mutateManualSettlement(db, companyId, actorId, input) {
    if (!actorId || !input || typeof input !== 'object')
        bad('정산 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId)
        || !['add', 'update', 'delete'].includes(input.action)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
        || !input.partnerId || !input.cashEntryId || !input.statementId
        || !positive(input.amount) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || (input.action === 'add' ? input.settlementId !== undefined || input.expectedAmount !== undefined
            : !input.settlementId || (input.action === 'update' && !positive(input.expectedAmount))))
        bad('정산 입력이 잘못되었습니다.');
    const settlementId = input.action === 'add' ? `manual-${input.operationId}` : input.settlementId;
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(settlementId))
        bad('정산 ID가 잘못되었습니다.');
    const requestHash = hash(input, companyId);
    const operationRef = db.collection('manualSettlementOperations').doc(input.operationId);
    const settlementRef = db.collection('settlements').doc(settlementId);
    const statementRef = db.collection('issuedStatements').doc(input.statementId);
    const cashRef = db.collection('cashEntries').doc(input.cashEntryId);
    const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
    const cutoverRef = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
    const outcome = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const [operationSnap, settlementSnap, statementSnap, cashSnap, stateSnap, cutoverSnap, releaseSnap, settlementRows, returnRows, partnerSnap] = await Promise.all([
            tx.get(operationRef), tx.get(settlementRef), tx.get(statementRef), tx.get(cashRef),
            tx.get(stateRef), tx.get(cutoverRef), tx.get((0, releaseGate_1.releaseGateRef)(db)),
            tx.get(db.collection('settlements')),
            tx.get(db.collection('returnApplications').where('statementId', '==', input.statementId)),
            tx.get(db.collection('partners').doc(input.partnerId)),
        ]);
        const priorOperation = operationSnap.data();
        const snapshotHash = (row) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(row !== null && row !== void 0 ? row : null)).digest('hex');
        if (operationSnap.exists && (priorOperation === null || priorOperation === void 0 ? void 0 : priorOperation.status) === 'rejected') {
            if (priorOperation.companyId !== companyId || priorOperation.createdBy !== actorId
                || priorOperation.operationId !== input.operationId || priorOperation.action !== input.action
                || priorOperation.partnerId !== input.partnerId
                || priorOperation.requestHash !== requestHash || priorOperation.settlementId !== settlementId
                || priorOperation.settlementHash !== snapshotHash(settlementSnap.data())
                || !['invalid-argument', 'failed-precondition'].includes(priorOperation.failureCode)
                || typeof priorOperation.failureMessage !== 'string')
                fail('기존 거절 작업과 정산 원문이 다릅니다.');
            return { status: 'rejected', failureCode: priorOperation.failureCode, failureMessage: priorOperation.failureMessage };
        }
        let writesStarted = false;
        try {
            (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
            if (operationSnap.exists) {
                const previous = operationSnap.data();
                const current = settlementSnap.data();
                if (previous.companyId !== companyId || previous.requestHash !== requestHash
                    || previous.settlementId !== settlementId || previous.partnerId !== input.partnerId
                    || (input.action === 'delete' ? settlementSnap.exists
                        : !settlementSnap.exists || (current === null || current === void 0 ? void 0 : current.cashEntryId) !== input.cashEntryId
                            || (current === null || current === void 0 ? void 0 : current.statementId) !== input.statementId || (current === null || current === void 0 ? void 0 : current.amount) !== input.amount
                            || owner(current) !== companyId))
                    fail('기존 정산 작업과 현재 행이 다릅니다.');
                return { status: 'duplicate', settlementId, revision: previous.revision };
            }
            const cutover = cutoverSnap.data();
            if (!cutoverSnap.exists || (cutover === null || cutover === void 0 ? void 0 : cutover.companyId) !== companyId || (cutover === null || cutover === void 0 ? void 0 : cutover.enabled) !== true
                || (cutover === null || cutover === void 0 ? void 0 : cutover.legacyWritersBlocked) !== true || (cutover === null || cutover === void 0 ? void 0 : cutover.auditPassed) !== true)
                fail('정산 writer 전환이 준비되지 않았습니다.');
            if ((0, partnerCutover_1.partnerQuarantined)(cutover, input.partnerId))
                fail('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
            const revision = stateSnap.exists ? (_a = stateSnap.data()) === null || _a === void 0 ? void 0 : _a.revision : 0;
            if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision)
                fail('거래처 정산 상태가 변경되었습니다.');
            if (!partnerSnap.exists || owner(partnerSnap.data()) !== companyId
                || !statementSnap.exists || !cashSnap.exists
                || owner(statementSnap.data()) !== companyId || owner(cashSnap.data()) !== companyId
                || ((_b = statementSnap.data()) === null || _b === void 0 ? void 0 : _b.partnerId) !== input.partnerId || ((_c = cashSnap.data()) === null || _c === void 0 ? void 0 : _c.partnerId) !== input.partnerId)
                fail('원전표·자금전표·거래처의 회사가 맞지 않습니다.');
            if (((_d = cashSnap.data()) === null || _d === void 0 ? void 0 : _d.transferOperationId)
                || ((_e = cashSnap.data()) === null || _e === void 0 ? void 0 : _e.loanMovementOperationId) || ((_f = cashSnap.data()) === null || _f === void 0 ? void 0 : _f.partnerPaymentOperationId))
                fail('서버 명령이 소유한 자금전표의 연결은 수동으로 바꿀 수 없습니다.');
            const cashSource = cashSnap.data();
            if (!['입금', '출금'].includes(cashSource.dir) || !positive(cashSource.amount))
                fail('실제 입출금 자금전표만 수동 정산할 수 있습니다.');
            const claim = (0, partnerPaymentCommand_1.claimFromStatement)(input.statementId, statementSnap.data());
            const cash = (0, partnerPaymentCommand_1.cashFromEntry)(input.cashEntryId, cashSnap.data());
            if (!claim || !cash)
                fail('원전표·자금전표의 정산 계정을 확인할 수 없습니다.');
            const returned = returnRows.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
            const net = (0, partnerPaymentPlan_1.claimsAfterReturns)([claim], returned)[0].amount;
            const availableCash = cash.parts.filter(part => part.accountCode === claim.accountCode)
                .reduce((sum, part) => sum + part.reduce, 0);
            if (!Number.isSafeInteger(net) || net < 0 || !Number.isSafeInteger(availableCash)
                || availableCash <= 0 || availableCash > cashSource.amount)
                fail('원전표 잔액 또는 자금전표 방향이 맞지 않습니다.');
            const prior = settlementSnap.data();
            if (input.action === 'add' ? settlementSnap.exists : !settlementSnap.exists
                || (prior === null || prior === void 0 ? void 0 : prior.cashEntryId) !== input.cashEntryId || (prior === null || prior === void 0 ? void 0 : prior.statementId) !== input.statementId
                || !positive(prior === null || prior === void 0 ? void 0 : prior.amount) || prior.amount !== (input.action === 'update' ? input.expectedAmount : input.amount)
                || owner(prior) !== companyId || (prior === null || prior === void 0 ? void 0 : prior.operationId) || (prior === null || prior === void 0 ? void 0 : prior.returnOperationId)
                || (prior === null || prior === void 0 ? void 0 : prior.transferOperationId) || (prior === null || prior === void 0 ? void 0 : prior.issueOperationId) || (prior === null || prior === void 0 ? void 0 : prior.serverOwned) === true
                || settlementId.startsWith('st-'))
                fail('수동 정산 행이 없거나 서버 명령 소유·값이 변경되었습니다.');
            let settledClaim = 0, settledCashTotal = 0;
            const settledByAccount = new Map();
            for (const doc of settlementRows.docs) {
                if (doc.id === settlementId)
                    continue;
                const row = doc.data();
                if (row.statementId !== input.statementId && row.cashEntryId !== input.cashEntryId)
                    continue;
                if (!positive(row.amount))
                    fail('기존 정산 금액이 잘못되었습니다.');
                if (row.statementId === input.statementId) {
                    if (owner(row) !== companyId)
                        fail('원전표에 다른 회사 정산이 있습니다.');
                    const linked = await tx.get(db.collection('cashEntries').doc(row.cashEntryId));
                    if (!linked.exists || owner(linked.data()) !== companyId || ((_g = linked.data()) === null || _g === void 0 ? void 0 : _g.partnerId) !== input.partnerId)
                        fail('기존 원전표 정산 연결이 불명확합니다.');
                    settledClaim += row.amount;
                }
                if (row.cashEntryId === input.cashEntryId) {
                    if (owner(row) !== companyId)
                        fail('자금전표에 다른 회사 정산이 있습니다.');
                    const linked = await tx.get(db.collection('issuedStatements').doc(row.statementId));
                    const linkedClaim = linked.exists ? (0, partnerPaymentCommand_1.claimFromStatement)(linked.id, linked.data()) : null;
                    if (!linkedClaim || linkedClaim.partnerId !== input.partnerId || linkedClaim.companyId !== companyId)
                        fail('기존 자금 정산 연결이 불명확합니다.');
                    settledByAccount.set(linkedClaim.accountCode, ((_h = settledByAccount.get(linkedClaim.accountCode)) !== null && _h !== void 0 ? _h : 0) + row.amount);
                    settledCashTotal += row.amount;
                }
            }
            for (const [code, used] of settledByAccount) {
                const budget = cash.parts.filter(part => part.accountCode === code).reduce((sum, part) => sum + part.reduce, 0);
                if (!Number.isSafeInteger(used) || !Number.isSafeInteger(budget) || used > budget)
                    fail('기존 자금전표 계정별 정산 한도를 넘습니다.');
            }
            const settledCash = (_j = settledByAccount.get(claim.accountCode)) !== null && _j !== void 0 ? _j : 0;
            const nextAmount = input.action === 'delete' ? 0 : input.amount;
            if (!Number.isSafeInteger(settledClaim + nextAmount) || settledClaim + nextAmount > net
                || !Number.isSafeInteger(settledCash + nextAmount) || settledCash + nextAmount > availableCash
                || !Number.isSafeInteger(settledCashTotal + nextAmount) || settledCashTotal + nextAmount > cashSource.amount)
                fail('원전표·자금전표 정산 한도를 넘습니다.');
            const createdAt = new Date().toISOString();
            writesStarted = true;
            if (input.action === 'add')
                tx.create(settlementRef, { companyId, cashEntryId: input.cashEntryId,
                    statementId: input.statementId, amount: input.amount, manual: true, createdAt, createdBy: actorId });
            else if (input.action === 'update')
                tx.update(settlementRef, { amount: input.amount, updatedAt: createdAt,
                    updatedBy: actorId });
            else
                tx.delete(settlementRef);
            if (stateSnap.exists)
                tx.update(stateRef, { revision: revision + 1 });
            else
                tx.create(stateRef, { companyId, partnerId: input.partnerId, revision: 1 });
            tx.create(operationRef, { companyId, partnerId: input.partnerId, requestHash, settlementId,
                action: input.action, revision: revision + 1, createdAt, createdBy: actorId });
            return { status: 'applied', settlementId, revision: revision + 1 };
        }
        catch (caught) {
            const error = caught instanceof partnerPaymentPlan_1.PartnerPaymentValidationError
                ? new https_1.HttpsError('failed-precondition', caught.message) : caught;
            // 확정 사전 거절만 감사 문서로 봉쇄한다. 기존 작업·부분 생성·알 수 없는 오류는 보존한다.
            if (!operationSnap.exists && !writesStarted && (input.action !== 'add' || !settlementSnap.exists)
                && error instanceof https_1.HttpsError && ['invalid-argument', 'failed-precondition'].includes(error.code)) {
                tx.create(operationRef, { companyId, partnerId: input.partnerId, requestHash, settlementId,
                    operationId: input.operationId, action: input.action, status: 'rejected', settlementHash: snapshotHash(settlementSnap.data()),
                    failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString(), createdBy: actorId });
                return { status: 'rejected', failureCode: error.code, failureMessage: error.message };
            }
            throw error;
        }
    });
    if (outcome.status === 'rejected')
        throw new https_1.HttpsError(outcome.failureCode, outcome.failureMessage, {
            manualSettlementFailure: { version: 1, companyId, partnerId: input.partnerId, operationId: input.operationId,
                operationRejected: true, financialWrites: false },
        });
    return outcome;
}
exports.mutateManualSettlementCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return mutateManualSettlement(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=manualSettlementCommand.js.map