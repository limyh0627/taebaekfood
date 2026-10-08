"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordLoanMovementCommand = void 0;
exports.recordLoanMovement = recordLoanMovement;
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const newScopeCounter_1 = require("./newScopeCounter");
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const voucherIssue_1 = require("./voucherIssue");
const loanMovementPlan_1 = require("./loanMovementPlan");
const releaseGate_1 = require("./releaseGate");
const fail = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const bad = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
const companyOf = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
        : value;
const hash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function recordLoanMovement(db, companyId, actorId, input) {
    var _a, _b;
    if (!actorId || !input || typeof input !== 'object')
        bad('대출 이동 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !input.loanId || !input.cashAccountId
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
        || !validDate(input.tradeDate) || !['차입', '상환'].includes(input.action)
        || !Number.isSafeInteger(input.principal) || input.principal < 0
        || !Number.isSafeInteger(input.interest) || input.interest < 0
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)))
        bad('대출 원금·이자·작업 입력이 잘못되었습니다.');
    const requestHash = hash(Object.assign(Object.assign({}, input), { note: (_b = (_a = input.note) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '' }));
    const operation = db.collection('loanMovementOperations').doc(input.operationId);
    const cash = db.collection('cashEntries').doc(input.operationId);
    const other = db.collection('issuedStatements').doc(input.operationId);
    const contract = db.collection('loanContracts').doc(input.loanId);
    const account = db.collection('cashAccounts').doc(input.cashAccountId);
    const counter = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, input.tradeDate));
    const cutover = db.collection('appMeta').doc(`loanMovementCutover_${companyId}`);
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    const outcome = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        const [operationSnap, cashSnap, otherSnap, contractSnap, accountSnap, counterSnap, cutoverSnap, movementRows, releaseSnap] = await Promise.all([
            tx.get(operation), tx.get(cash), tx.get(other), tx.get(contract), tx.get(account), tx.get(counter), tx.get(cutover),
            tx.get(db.collection('cashEntries').where('loanId', '==', input.loanId)),
            tx.get(releaseGate),
        ]);
        const prior = operationSnap.data();
        if (operationSnap.exists && (prior === null || prior === void 0 ? void 0 : prior.status) === 'rejected') {
            if (prior.companyId !== companyId || prior.requestHash !== requestHash || prior.loanId !== input.loanId
                || cashSnap.exists || otherSnap.exists
                || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
                || typeof prior.failureMessage !== 'string')
                fail('기존 거절 작업과 요청·금융문서가 다릅니다.');
            return { status: 'rejected', failureCode: prior.failureCode, failureMessage: prior.failureMessage };
        }
        let writesStarted = false;
        try {
            (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
            (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, input.tradeDate);
            if (operationSnap.exists) {
                const prior = operationSnap.data(), stored = cashSnap.data();
                if (prior.companyId === companyId && prior.requestHash === requestHash && (!cashSnap.exists || ((_a = stored === null || stored === void 0 ? void 0 : stored.mutationRevision) !== null && _a !== void 0 ? _a : 0) > 0)) {
                    const original = await (0, cashMutationReceipt_1.readCashCreationMutation)(db, tx, companyId, input.operationId, cashSnap, row => {
                        var _a, _b;
                        const business = { companyId: row.companyId, loanId: row.loanId, date: row.date,
                            cashAccountId: row.cashAccountId, dir: row.dir, amount: row.amount,
                            accountCode: (_a = row.accountCode) !== null && _a !== void 0 ? _a : null, lines: (_b = row.lines) !== null && _b !== void 0 ? _b : null, note: row.note };
                        return row.loanId === input.loanId && row.issueOperationId === input.operationId && row.issuePayloadHash === requestHash
                            && row.docNo === prior.docNo && hash(business) === prior.entryHash;
                    });
                    if (original)
                        return { status: 'duplicate', id: input.operationId, docNo: prior.docNo, balanceAfter: prior.balanceAfter };
                }
                const business = stored && { companyId: stored.companyId, loanId: stored.loanId, date: stored.date,
                    cashAccountId: stored.cashAccountId, dir: stored.dir, amount: stored.amount,
                    accountCode: (_b = stored.accountCode) !== null && _b !== void 0 ? _b : null, lines: (_c = stored.lines) !== null && _c !== void 0 ? _c : null, note: stored.note };
                if (prior.companyId !== companyId || prior.requestHash !== requestHash || !cashSnap.exists
                    || (stored === null || stored === void 0 ? void 0 : stored.docNo) !== prior.docNo || (stored === null || stored === void 0 ? void 0 : stored.issueOperationId) !== input.operationId
                    || (stored === null || stored === void 0 ? void 0 : stored.issuePayloadHash) !== requestHash || hash(business) !== prior.entryHash)
                    fail('기존 대출 작업과 요청이 다릅니다.');
                return { status: 'duplicate', id: input.operationId, docNo: prior.docNo, balanceAfter: prior.balanceAfter };
            }
            if (cashSnap.exists || otherSnap.exists)
                fail('작업 ID가 이미 사용 중입니다.');
            if (!cutoverSnap.exists || ((_d = cutoverSnap.data()) === null || _d === void 0 ? void 0 : _d.companyId) !== companyId
                || ((_e = cutoverSnap.data()) === null || _e === void 0 ? void 0 : _e.enabled) !== true || ((_f = cutoverSnap.data()) === null || _f === void 0 ? void 0 : _f.legacyWritersBlocked) !== true
                || ((_g = cutoverSnap.data()) === null || _g === void 0 ? void 0 : _g.auditPassed) !== true)
                fail('대출 writer 전환이 준비되지 않았습니다.');
            if (!contractSnap.exists || companyOf(contractSnap.data()) !== companyId)
                fail('대출 계약의 회사가 맞지 않습니다.');
            const loanData = contractSnap.data();
            if (!['260', '293'].includes(loanData.accountCode) || !validDate(loanData.openingDate)
                || input.tradeDate < loanData.openingDate)
                fail('대출 계약일·원금 계정이 맞지 않습니다.');
            const revision = (_h = loanData.movementRevision) !== null && _h !== void 0 ? _h : 0;
            if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision)
                fail('대출 계약이 변경되었습니다.');
            if (!accountSnap.exists || companyOf(accountSnap.data()) !== companyId
                || ((_j = accountSnap.data()) === null || _j === void 0 ? void 0 : _j.active) !== true || ((_k = accountSnap.data()) === null || _k === void 0 ? void 0 : _k.type) !== '통장')
                fail('회사 통장 계좌가 맞지 않습니다.');
            const sequence = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, '');
            if (sequence.companyId !== companyId || sequence.tradeDate !== input.tradeDate || sequence.prefix !== ''
                || !Number.isSafeInteger(sequence.last) || sequence.last < 0)
                fail('전표 번호 카운터가 손상되었습니다.');
            const loan = { id: input.loanId, companyId, accountCode: loanData.accountCode,
                openingDate: loanData.openingDate, openingPrincipal: loanData.openingPrincipal };
            const movements = movementRows.docs.map(doc => {
                const row = doc.data();
                if (companyOf(row) !== companyId)
                    fail('다른 회사의 대출 연결 전표가 있습니다.');
                return { id: doc.id, companyId: companyOf(row), loanId: row.loanId, date: row.date, createdAt: row.createdAt,
                    dir: row.dir, amount: row.amount, accountCode: row.accountCode,
                    lines: Array.isArray(row.lines) ? row.lines.map((line) => ({ accountCode: line.accountCode, amount: line.amount, side: line.side })) : undefined };
            });
            const plan = (0, loanMovementPlan_1.planLoanMovement)(loan, movements, input);
            if (loanData.principalBalance !== undefined && loanData.principalBalance !== plan.balanceBefore)
                fail('대출 계약 잔액과 원장 합계가 다릅니다.');
            const next = sequence.last + 1;
            if (!Number.isSafeInteger(next))
                fail('전표 번호 범위를 초과했습니다.');
            const docNo = (0, voucherIssue_1.formatVoucherNo)(input.tradeDate, next);
            const business = { companyId, loanId: input.loanId, date: input.tradeDate,
                cashAccountId: input.cashAccountId, dir: plan.dir, amount: plan.amount,
                accountCode: (_l = plan.accountCode) !== null && _l !== void 0 ? _l : null, lines: (_m = plan.lines) !== null && _m !== void 0 ? _m : null, note: ((_o = input.note) === null || _o === void 0 ? void 0 : _o.trim()) || `${(_p = loanData.name) !== null && _p !== void 0 ? _p : '대출'} ${input.action}` };
            const createdAt = new Date().toISOString();
            writesStarted = true;
            (0, newScopeCounter_1.writeVoucherCounter)(tx, counterSnap, sequence, next);
            tx.update(contract, { movementRevision: revision + 1, principalBalance: plan.balanceAfter });
            tx.create(cash, Object.assign(Object.assign(Object.assign(Object.assign({}, business), (business.accountCode ? { accountCode: business.accountCode } : {})), (business.lines ? { lines: business.lines } : {})), { partnerId: (_q = loanData.partnerId) !== null && _q !== void 0 ? _q : null, partnerName: (_r = loanData.lenderName) !== null && _r !== void 0 ? _r : '', docNo, createdAt, createdBy: actorId, issueOperationId: input.operationId, issuePayloadHash: requestHash, issuePrefix: '' }));
            tx.create(operation, { companyId, loanId: input.loanId, requestHash,
                entryHash: hash(business), balanceBefore: plan.balanceBefore, balanceAfter: plan.balanceAfter,
                principalDelta: plan.principalDelta, cashEntryId: input.operationId, docNo, createdAt, createdBy: actorId });
            return { status: 'applied', id: input.operationId, docNo, balanceAfter: plan.balanceAfter };
        }
        catch (error) {
            if (!operationSnap.exists && !cashSnap.exists && !otherSnap.exists && !writesStarted
                && error instanceof https_1.HttpsError && ['invalid-argument', 'failed-precondition'].includes(error.code)) {
                const failureCode = error.code;
                tx.create(operation, { companyId, loanId: input.loanId, requestHash, status: 'rejected',
                    failureCode, failureMessage: error.message, createdAt: new Date().toISOString(), createdBy: actorId });
                return { status: 'rejected', failureCode, failureMessage: error.message };
            }
            throw error;
        }
    });
    if (outcome.status === 'rejected')
        throw new https_1.HttpsError(outcome.failureCode, outcome.failureMessage, {
            loanMovementFailure: { version: 2, companyId, loanId: input.loanId, operationId: input.operationId,
                operationRejected: true, financialWrites: false },
        });
    return outcome;
}
exports.recordLoanMovementCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return recordLoanMovement(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=loanMovementCommand.js.map