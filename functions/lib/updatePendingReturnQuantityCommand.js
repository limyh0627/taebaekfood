"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePendingReturnQuantityCommand = void 0;
exports.updatePendingReturnQuantity = updatePendingReturnQuantity;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const pendingReturnQuantity_1 = require("./shared/pendingReturnQuantity");
const returnValidationError_1 = require("./returnValidationError");
const returnReversalPlan_1 = require("./returnReversalPlan");
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
async function updatePendingReturnQuantity(db, actor, input) {
    if (!(actor === null || actor === void 0 ? void 0 : actor.uid) || actor.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(actor.token.companyId) || actor.token.companyId !== (input === null || input === void 0 ? void 0 : input.companyId))
        throw new https_1.HttpsError('permission-denied', '현재 회사 관리자만 반품 수량을 수정할 수 있습니다.');
    if (Object.keys(input).some(key => !['companyId', 'requestId', 'operationId', 'updates'].includes(key)) || !validId(input.requestId) || !validId(input.operationId) || !Array.isArray(input.updates) || input.updates.some(row => !row || !validId(row.itemId) || !Number.isFinite(row.previousQuantity) || !Number.isFinite(row.quantity)))
        fail('반품 수량 요청을 확인해주세요.');
    const requestHash = (0, cashMutationReceipt_1.cashOriginalHash)(input), ref = db.collection('returnRequests').doc(input.requestId);
    const result = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const snap = await tx.get(ref);
        if (!snap.exists)
            fail('대상 기록을 찾을 수 없습니다.');
        const current = snap.data();
        if (((_a = current.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== input.companyId)
            fail('다른 회사의 기록은 수정할 수 없습니다.');
        const submissionAudit = await tx.get(db.collection('returnSubmissionOperations').doc(input.requestId));
        const receipt = current.submissionReceipt;
        if (receipt || submissionAudit.exists) {
            const audit = submissionAudit.data();
            if (!receipt || !audit || audit.status !== 'accepted' || audit.companyId !== input.companyId || audit.requestId !== input.requestId || receipt.version !== 1 || receipt.requestId !== input.requestId || receipt.actorId !== audit.actorId || typeof receipt.actorId !== 'string' || !receipt.actorId || !receipt.request || !audit.request || receipt.requestHash !== audit.requestHash || (0, cashMutationReceipt_1.cashOriginalHash)(receipt.request) !== receipt.requestHash || (0, cashMutationReceipt_1.cashOriginalHash)(audit.request) !== receipt.requestHash)
                fail('원접수 증명을 확인해주세요.');
        }
        if (current.quantityOperations !== undefined && (!current.quantityOperations || Array.isArray(current.quantityOperations) || typeof current.quantityOperations !== 'object'))
            fail('반품 수량 수정 이력을 확인해주세요.');
        const previous = (_b = current.quantityOperations) === null || _b === void 0 ? void 0 : _b[input.operationId];
        if (previous) {
            if (previous.actorId !== actor.uid || previous.companyId !== input.companyId || previous.requestHash !== requestHash || !previous.command || (0, cashMutationReceipt_1.cashOriginalHash)(previous.command) !== requestHash || !['updated', 'rejected'].includes(previous.status))
                fail('같은 수량 수정 요청의 원문이 다릅니다.');
            if (previous.status === 'rejected') {
                if (typeof previous.message !== 'string' || !previous.message)
                    fail('기존 거절 증명을 확인해주세요.');
                return { status: 'rejected', message: previous.message };
            }
            return { status: 'duplicate', operationId: input.operationId, requestId: input.requestId, requestHash };
        }
        let patch;
        try {
            patch = (0, pendingReturnQuantity_1.pendingReturnQuantityPatch)(current, input.updates, input.companyId);
            if (!current.linkedStatementId)
                (0, returnReversalPlan_1.planStandaloneReturn)(Object.assign(Object.assign({}, current), patch));
        }
        catch (error) {
            if (!(error instanceof returnValidationError_1.ReturnValidationError))
                throw error;
            tx.update(ref, { quantityOperations: Object.assign(Object.assign({}, ((_c = current.quantityOperations) !== null && _c !== void 0 ? _c : {})), { [input.operationId]: { companyId: input.companyId, actorId: actor.uid, status: 'rejected', requestHash, command: input, message: error.message, createdAt: new Date().toISOString() } }) });
            return { status: 'rejected', message: error.message };
        }
        const revision = (_d = current.quantityRevision) !== null && _d !== void 0 ? _d : 0;
        if (!Number.isSafeInteger(revision) || revision < 0)
            fail('반품 수량 수정 이력을 확인해주세요.');
        tx.update(ref, Object.assign(Object.assign({}, patch), { quantityRevision: revision + 1, quantityOperations: Object.assign(Object.assign({}, ((_e = current.quantityOperations) !== null && _e !== void 0 ? _e : {})), { [input.operationId]: { companyId: input.companyId, actorId: actor.uid, status: 'updated', requestHash, command: input, beforeHash: (0, cashMutationReceipt_1.cashOriginalHash)({ items: current.items, totalAmount: current.totalAmount }), afterHash: (0, cashMutationReceipt_1.cashOriginalHash)(patch), revision: revision + 1, createdAt: new Date().toISOString() } }) }));
        return { status: 'updated', operationId: input.operationId, requestId: input.requestId, requestHash };
    });
    if (result.status === 'rejected')
        throw new https_1.HttpsError('failed-precondition', result.message, { quantityRejected: { version: 1, companyId: input.companyId, actorId: actor.uid, requestId: input.requestId, operationId: input.operationId, requestHash, command: input, status: 'rejected', terminalConfirmed: true } });
    return result;
}
exports.updatePendingReturnQuantityCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, request => updatePendingReturnQuantity(admin.firestore(), request.auth ? { uid: request.auth.uid, token: request.auth.token } : undefined, request.data));
//# sourceMappingURL=updatePendingReturnQuantityCommand.js.map