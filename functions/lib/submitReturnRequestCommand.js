"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitReturnRequestCommand = void 0;
exports.submitReturnRequest = submitReturnRequest;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const returnReversalPlan_1 = require("./returnReversalPlan");
const returnValidationError_1 = require("./returnValidationError");
const fail = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
/** 접수만 저장한다. 재고·번호·상계는 기존 처리 명령의 책임이다. */
async function submitReturnRequest(db, companyId, actorId, input) {
    if (!actorId || !input || input.companyId !== companyId || !['taebaek', 'punghoe'].includes(companyId) || !id(input.requestId) || !input.request || Array.isArray(input.request))
        fail('반품 접수 회사·원문을 확인해주세요.');
    const body = input.request;
    const requestHash = (0, cashMutationReceipt_1.cashOriginalHash)(body), ref = db.collection('returnRequests').doc(input.requestId), audit = db.collection('returnSubmissionOperations').doc(input.requestId);
    const outcome = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d;
        const receiptSnap = await tx.get(audit), prior = await tx.get(ref);
        if (receiptSnap.exists) {
            const receipt = receiptSnap.data();
            if (receipt.companyId !== companyId || receipt.requestId !== input.requestId || receipt.actorId !== actorId || receipt.requestHash !== requestHash || !receipt.request || (0, cashMutationReceipt_1.cashOriginalHash)(receipt.request) !== requestHash || !['accepted', 'rejected'].includes(receipt.status))
                fail('기존 반품 접수와 원문이 다릅니다.');
            if (receipt.status === 'rejected') {
                if (prior.exists || !['failed-precondition', 'invalid-argument'].includes(receipt.failureCode) || typeof receipt.failureMessage !== 'string' || !receipt.failureMessage)
                    fail('기존 반품 거절 원문을 확인해주세요.');
                return { status: 'rejected', failureCode: receipt.failureCode, failureMessage: receipt.failureMessage };
            }
            const stored = (_a = prior.data()) === null || _a === void 0 ? void 0 : _a.submissionReceipt;
            if (!prior.exists || ((_b = prior.data()) === null || _b === void 0 ? void 0 : _b.companyId) !== companyId || (stored === null || stored === void 0 ? void 0 : stored.version) !== 1 || stored.requestId !== input.requestId || stored.actorId !== actorId || stored.requestHash !== requestHash || !stored.request || (0, cashMutationReceipt_1.cashOriginalHash)(stored.request) !== requestHash)
                fail('기존 반품 접수 원문이 변경되었습니다.');
            return { status: 'duplicate', requestId: input.requestId, actorId, requestHash };
        }
        if (prior.exists)
            fail('기존 반품 접수와 원문이 다릅니다.');
        let writesStarted = false;
        try {
            const allowed = new Set(['companyId', 'partnerId', 'partnerName', 'returnType', 'linkedStatementId', 'status', 'totalAmount', 'items', 'createdAt', 'createdBy', 'note', 'payableAccountCode']);
            if (Object.keys(body).some(key => !allowed.has(key)) || body.companyId !== companyId || body.status !== 'pending' || !id(body.partnerId) || !['매출', '매입'].includes(body.returnType) || typeof body.partnerName !== 'string' || !body.partnerName.trim() || typeof body.createdAt !== 'string' || !Number.isFinite(Date.parse(body.createdAt)) || (body.note !== undefined && typeof body.note !== 'string') || (body.createdBy !== undefined && typeof body.createdBy !== 'string') || (body.linkedStatementId !== undefined && !id(body.linkedStatementId)))
                fail('반품 접수 원문 형식을 확인해주세요.');
            const partner = await tx.get(db.collection('partners').doc(body.partnerId));
            if (!partner.exists || ((_d = (_c = partner.data()) === null || _c === void 0 ? void 0 : _c.companyId) !== null && _d !== void 0 ? _d : 'taebaek') !== companyId)
                fail('반품 거래처의 회사를 확인해주세요.');
            if (!Array.isArray(body.items) || !body.items.length || body.items.some((item) => !item || Array.isArray(item) || (item.name !== undefined && typeof item.name !== 'string') || (item.reason !== undefined && typeof item.reason !== 'string')))
                fail('반품 품목을 입력해주세요.');
            const items = await Promise.all(body.items.map((item) => { if (!id(item.itemId))
                fail('반품 품목을 확인해주세요.'); return tx.get(db.collection('items').doc(item.itemId)); }));
            if (items.some(item => { var _a, _b; return !item.exists || ((_b = (_a = item.data()) === null || _a === void 0 ? void 0 : _a.companyId) !== null && _b !== void 0 ? _b : 'taebaek') !== companyId; }))
                fail('반품 품목의 회사를 확인해주세요.');
            let plan;
            try {
                if (body.linkedStatementId) {
                    const source = await tx.get(db.collection('issuedStatements').doc(body.linkedStatementId));
                    if (!source.exists)
                        fail('선택한 원전표가 없어졌습니다. 다시 확인해주세요.');
                    plan = (0, returnReversalPlan_1.planReturnReversal)(companyId, Object.assign(Object.assign({}, body), { id: input.requestId }), Object.assign(Object.assign({}, source.data()), { id: source.id }), []);
                }
                else {
                    if (body.items.some((item) => ['108', '251', '253', '135', '255'].includes(item.accountCode)))
                        fail('반품 발생 계정과 채권·채무·세금 계정을 구분해주세요.');
                    plan = (0, returnReversalPlan_1.planStandaloneReturn)(body);
                }
            }
            catch (error) {
                if (error instanceof returnValidationError_1.ReturnValidationError)
                    throw new https_1.HttpsError('failed-precondition', error.message);
                throw error;
            }
            const codes = await tx.get(db.collection('accountCodes').where('companyId', '==', companyId));
            const activeCodes = new Set(codes.docs.map(code => code.data().code));
            if (plan.journalLines.some(line => !activeCodes.has(line.accountCode)))
                fail('반품 분개 계정을 확인해주세요.');
            writesStarted = true;
            tx.create(ref, Object.assign(Object.assign({}, body), { submissionReceipt: { version: 1, requestId: input.requestId, actorId, requestHash, request: body } }));
            tx.create(audit, { companyId, requestId: input.requestId, actorId, requestHash, request: body, status: 'accepted', createdAt: new Date().toISOString() });
            return { status: 'created', requestId: input.requestId, actorId, requestHash };
        }
        catch (error) {
            if (writesStarted || !(error instanceof https_1.HttpsError) || !['failed-precondition', 'invalid-argument'].includes(error.code))
                throw error;
            tx.create(audit, { companyId, requestId: input.requestId, actorId, requestHash, request: body, status: 'rejected', failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString() });
            return { status: 'rejected', failureCode: error.code, failureMessage: error.message };
        }
    });
    if (outcome.status === 'rejected')
        throw new https_1.HttpsError(outcome.failureCode, outcome.failureMessage, { version: 1, operationStatus: 'rejected', submissionRejected: true, terminalConfirmed: true, receiptStatus: 'rejected', submissionWrites: false, financialWrites: false, companyId, requestId: input.requestId, actorId, requestHash });
    return outcome;
}
exports.submitReturnRequestCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => { var _a; const companyId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.companyId; if (!request.auth || typeof request.auth.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(companyId)))
    throw new https_1.HttpsError('permission-denied', '현재 회사 직원만 반품을 접수할 수 있습니다.'); return submitReturnRequest(admin.firestore(), String(companyId), request.auth.uid, request.data); });
//# sourceMappingURL=submitReturnRequestCommand.js.map