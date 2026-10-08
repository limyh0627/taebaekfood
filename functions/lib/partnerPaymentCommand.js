"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPartnerPaymentCommand = void 0;
exports.claimFromStatement = claimFromStatement;
exports.cashFromEntry = cashFromEntry;
exports.recordPartnerPayment = recordPartnerPayment;
const returnClaimReader_1 = require("./returnClaimReader");
const cashLineProjection_1 = require("./shared/cashLineProjection");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const newScopeCounter_1 = require("./newScopeCounter");
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const voucherIssue_1 = require("./voucherIssue");
const releaseGate_1 = require("./releaseGate");
const partnerCutover_1 = require("./partnerCutover");
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const invalid = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
const conflict = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const owner = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
        : value;
const fingerprint = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const nonTrade = /^(1[0-9]{2}|2[0-9]{2}|5[1-9][0-9]|6[0-9]{2}|8[0-9]{2}|9[0-9]{2})$/;
const tradeCodes = new Set(['500', '501', '503', '505']);
/** The adapter deliberately rejects ambiguous documents instead of inventing an account. */
function claimFromStatement(id, row) {
    if (!row.partnerId)
        return null;
    const items = Array.isArray(row.items) ? row.items : [];
    if (row.type === '매출' || row.type === '매입') {
        if (!items.length || items.some(item => !item.accountCode || !Number.isSafeInteger(item.supply)
            || !Number.isSafeInteger(item.tax) || !Number.isSafeInteger(item.total)))
            conflict('기존 전표의 원분개 줄이 잘못되었습니다.');
        const supply = items.reduce((sum, item) => sum + item.supply, 0);
        const tax = Number.isSafeInteger(row.totalTax) ? row.totalTax : items.reduce((sum, item) => sum + item.tax, 0);
        if (!Number.isSafeInteger(supply) || !Number.isSafeInteger(tax) || supply + tax !== row.totalAmount)
            conflict('기존 전표의 차변·대변 금액이 맞지 않습니다.');
    }
    const codes = items.map(item => { var _a; return String((_a = item.accountCode) !== null && _a !== void 0 ? _a : ''); });
    let accountCode = null;
    if (row.type === '매출')
        accountCode = '108';
    else if (row.type === '매입') {
        if (codes.includes('251'))
            accountCode = '251';
        else if (codes.includes('253'))
            accountCode = '253';
        else if (codes.some(code => tradeCodes.has(code)) || !codes.some(code => nonTrade.test(code)))
            accountCode = '251';
        else
            accountCode = '253';
    }
    else if (row.type === '비용') {
        if (!items.length || items.some(item => !item.accountCode || !['차변', '대변'].includes(item.side)
            || !Number.isSafeInteger(item.total) || item.total < 0))
            conflict('기존 대체전표의 줄이 잘못되었습니다.');
        const debit = items.filter(item => item.side === '차변').reduce((sum, item) => sum + item.total, 0);
        const credit = items.filter(item => item.side === '대변').reduce((sum, item) => sum + item.total, 0);
        if (!debit || debit !== credit)
            conflict('기존 대체전표의 차변·대변이 맞지 않습니다.');
        const direct = [...new Set(items.filter(item => item.accountCode === '108' && item.side === '차변'
                || item.side === '대변' && ['251', '253'].includes(item.accountCode))
                .map(item => item.accountCode))];
        if (direct.length === 1)
            accountCode = direct[0];
    }
    if (!accountCode)
        return null;
    if (!Number.isSafeInteger(row.totalAmount) || row.totalAmount === 0 || !validDate(row.tradeDate))
        conflict('기존 전표의 금액·일자 근거가 불명확합니다.');
    return { id, companyId: owner(row), partnerId: row.partnerId, tradeDate: row.tradeDate,
        amount: row.totalAmount, accountCode };
}
function cashFromEntry(id, row) {
    var _a;
    if (!row.partnerId)
        return null;
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !['입금', '출금', '대체'].includes(row.dir))
        conflict('기존 자금전표가 잘못되었습니다.');
    let projection;
    try {
        projection = (0, cashLineProjection_1.projectCashLines)(row, true);
    }
    catch (error) {
        if (error instanceof cashLineProjection_1.CashLineProjectionError)
            conflict(error.message);
        throw error;
    }
    const byCode = new Map();
    for (const line of projection.parts) {
        if (!['108', '251', '253'].includes(line.accountCode))
            continue;
        const reduce = (0, cashLineProjection_1.cashLineReduction)(row.dir, line.accountCode, line.amount);
        const sum = ((_a = byCode.get(line.accountCode)) !== null && _a !== void 0 ? _a : 0) + reduce;
        if (!Number.isSafeInteger(sum))
            conflict('기존 자금전표 계정 합계가 잘못되었습니다.');
        byCode.set(line.accountCode, sum);
    }
    const parts = [...byCode].filter(([, reduce]) => reduce !== 0).map(([accountCode, reduce]) => ({ accountCode, reduce }));
    return { id, companyId: owner(row), partnerId: row.partnerId, parts };
}
/** Cutover-gated command. Reads the full partner history inside the same transaction. */
async function recordPartnerPayment(db, companyId, actorId, input) {
    var _a, _b;
    if (!actorId || !input || typeof input !== 'object')
        invalid('지급 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !validDate(input.tradeDate)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
        || !input.partnerId || !input.cashAccountId || !['입금', '출금'].includes(input.direction)
        || !Number.isSafeInteger(input.amount) || input.amount <= 0
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || typeof input.pin !== 'boolean' || !Array.isArray(input.allocations)
        || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)))
        invalid('지급 입력이 잘못되었습니다.');
    const requestHash = fingerprint(Object.assign(Object.assign({}, input), { note: (_b = (_a = input.note) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '' }));
    const operation = db.collection('partnerPaymentOperations').doc(input.operationId);
    const entry = db.collection('cashEntries').doc(input.operationId);
    const other = db.collection('issuedStatements').doc(input.operationId);
    const counter = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, input.tradeDate));
    const catchUpCounter = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, input.tradeDate, '추가'));
    const cutover = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
    const state = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
    const account = db.collection('cashAccounts').doc(input.cashAccountId);
    const partner = db.collection('partners').doc(input.partnerId);
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    const outcome = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const [operationSnap, entrySnap, otherSnap, normalCounterSnap, catchUpCounterSnap, cutoverSnap, stateSnap, accountSnap, partnerSnap, statementRows, cashRows, settlementRows, returnRows, releaseSnap] = await Promise.all([
            tx.get(operation), tx.get(entry), tx.get(other), tx.get(counter), tx.get(catchUpCounter), tx.get(cutover), tx.get(state), tx.get(account), tx.get(partner),
            tx.get(db.collection('issuedStatements').where('partnerId', '==', input.partnerId)),
            tx.get(db.collection('cashEntries').where('partnerId', '==', input.partnerId)),
            tx.get(db.collection('settlements')),
            tx.get(db.collection('returnApplications').where('partnerId', '==', input.partnerId)),
            tx.get(releaseGate),
        ]);
        const prior = operationSnap.data();
        const ownedSettlements = settlementRows.docs.filter(doc => doc.data().operationId === input.operationId);
        if (operationSnap.exists && (prior === null || prior === void 0 ? void 0 : prior.status) === 'rejected') {
            if (prior.companyId !== companyId || prior.partnerId !== input.partnerId || prior.requestHash !== requestHash
                || entrySnap.exists || otherSnap.exists || ownedSettlements.length
                || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
                || typeof prior.failureMessage !== 'string')
                conflict('기존 거절 작업과 요청·금융문서가 다릅니다.');
            return { status: 'rejected', failureCode: prior.failureCode, failureMessage: prior.failureMessage };
        }
        let writesStarted = false;
        try {
            (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
            const mode = (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, input.tradeDate, true);
            const effectivePrefix = mode === 'catchUp' ? '추가' : '';
            const counterSnap = mode === 'catchUp' ? catchUpCounterSnap : normalCounterSnap;
            if (operationSnap.exists) {
                const prior = operationSnap.data();
                const currentEntry = entrySnap.data();
                if (prior.companyId === companyId && prior.requestHash === requestHash && (!entrySnap.exists || ((_a = currentEntry === null || currentEntry === void 0 ? void 0 : currentEntry.mutationRevision) !== null && _a !== void 0 ? _a : 0) > 0)) {
                    const original = await (0, cashMutationReceipt_1.readCashCreationMutation)(db, tx, companyId, input.operationId, entrySnap, row => {
                        const business = { companyId: row.companyId, partnerId: row.partnerId, date: row.date, cashAccountId: row.cashAccountId,
                            dir: row.dir, amount: row.amount, lines: row.lines, note: row.note };
                        return row.partnerId === input.partnerId && row.issueOperationId === input.operationId && row.issuePayloadHash === requestHash
                            && row.issuePrefix === effectivePrefix && row.docNo === prior.docNo && fingerprint(business) === prior.entryHash;
                    });
                    if (original)
                        return { status: 'duplicate', id: input.operationId, docNo: prior.docNo };
                }
                const currentHash = currentEntry && fingerprint({ companyId: currentEntry.companyId, partnerId: currentEntry.partnerId,
                    date: currentEntry.date, cashAccountId: currentEntry.cashAccountId, dir: currentEntry.dir,
                    amount: currentEntry.amount, lines: currentEntry.lines, note: currentEntry.note });
                const priorSettlements = (_b = prior.settlements) !== null && _b !== void 0 ? _b : [];
                const storedSettlements = settlementRows.docs.filter(doc => doc.data().operationId === input.operationId);
                if (prior.companyId !== companyId || prior.requestHash !== requestHash || !entrySnap.exists
                    || ((_c = prior.issuePrefix) !== null && _c !== void 0 ? _c : '') !== effectivePrefix || (currentEntry === null || currentEntry === void 0 ? void 0 : currentEntry.issuePrefix) !== effectivePrefix
                    || (currentEntry === null || currentEntry === void 0 ? void 0 : currentEntry.docNo) !== prior.docNo || (currentEntry === null || currentEntry === void 0 ? void 0 : currentEntry.issueOperationId) !== input.operationId
                    || (currentEntry === null || currentEntry === void 0 ? void 0 : currentEntry.issuePayloadHash) !== requestHash || currentHash !== prior.entryHash
                    || storedSettlements.length !== priorSettlements.length
                    || priorSettlements.some(row => {
                        var _a;
                        const stored = (_a = storedSettlements.find(doc => doc.id === `st-${input.operationId}-${row.statementId}`)) === null || _a === void 0 ? void 0 : _a.data();
                        return !stored || stored.companyId !== companyId || stored.cashEntryId !== input.operationId
                            || stored.statementId !== row.statementId || stored.amount !== row.amount;
                    }))
                    conflict('기존 지급 작업과 요청이 다릅니다.');
                return { status: 'duplicate', id: input.operationId, docNo: prior.docNo };
            }
            if (entrySnap.exists || otherSnap.exists)
                conflict('작업 ID가 이미 사용 중입니다.');
            if (!cutoverSnap.exists || ((_d = cutoverSnap.data()) === null || _d === void 0 ? void 0 : _d.companyId) !== companyId
                || ((_e = cutoverSnap.data()) === null || _e === void 0 ? void 0 : _e.enabled) !== true || ((_f = cutoverSnap.data()) === null || _f === void 0 ? void 0 : _f.legacyWritersBlocked) !== true
                || ((_g = cutoverSnap.data()) === null || _g === void 0 ? void 0 : _g.auditPassed) !== true)
                conflict('지급 writer 전환이 준비되지 않았습니다.');
            if ((0, partnerCutover_1.partnerQuarantined)(cutoverSnap.data(), input.partnerId))
                conflict('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
            const sequence = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, effectivePrefix);
            if (sequence.companyId !== companyId || sequence.tradeDate !== input.tradeDate || sequence.prefix !== effectivePrefix
                || !Number.isSafeInteger(sequence.last) || sequence.last < 0)
                conflict('전표 번호 카운터가 손상되었습니다.');
            const revision = stateSnap.exists ? (_h = stateSnap.data()) === null || _h === void 0 ? void 0 : _h.revision : 0;
            if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision)
                conflict('거래처 정산 상태가 변경되었습니다.');
            if (!accountSnap.exists || owner(accountSnap.data()) !== companyId || ((_j = accountSnap.data()) === null || _j === void 0 ? void 0 : _j.active) !== true)
                conflict('회사 계좌가 맞지 않습니다.');
            if (!partnerSnap.exists || owner(partnerSnap.data()) !== companyId)
                conflict('거래처 회사가 맞지 않습니다.');
            const statements = await (0, returnClaimReader_1.readClaimsAfterReturns)(db, tx, statementRows.docs.filter(doc => owner(doc.data()) === companyId)
                .map(doc => claimFromStatement(doc.id, doc.data()))
                .filter((row) => row !== null), returnRows.docs.filter(doc => owner(doc.data()) === companyId)
                .map(doc => (Object.assign({ id: doc.id }, doc.data()))), statementRows.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))));
            const cashEntries = cashRows.docs.filter(doc => owner(doc.data()) === companyId)
                .map(doc => cashFromEntry(doc.id, doc.data())).filter((row) => row !== null);
            const settlements = settlementRows.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
            const plan = (0, partnerPaymentPlan_1.planPartnerPayment)({ companyId, partnerId: input.partnerId, direction: input.direction,
                amount: input.amount, pin: input.pin, allocations: input.allocations, claims: statements, cashEntries, settlements });
            if (plan.ignoredOrphanSettlementIds.length)
                conflict('삭제되거나 다른 회사에 연결된 정산이 있습니다.');
            const next = sequence.last + 1;
            if (!Number.isSafeInteger(next))
                conflict('전표 번호 범위를 초과했습니다.');
            const docNo = (0, voucherIssue_1.formatVoucherNo)(input.tradeDate, next, effectivePrefix);
            const createdAt = new Date().toISOString();
            const business = { companyId, partnerId: input.partnerId, date: input.tradeDate,
                cashAccountId: input.cashAccountId, dir: input.direction, amount: input.amount,
                lines: plan.lines, note: (_l = (_k = input.note) === null || _k === void 0 ? void 0 : _k.trim()) !== null && _l !== void 0 ? _l : '' };
            writesStarted = true;
            (0, newScopeCounter_1.writeVoucherCounter)(tx, counterSnap, sequence, next);
            tx.create(entry, Object.assign(Object.assign({}, business), { partnerName: (_o = (_m = partnerSnap.data()) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : '', docNo, createdAt, createdBy: actorId, issueOperationId: input.operationId, issuePayloadHash: requestHash, issuePrefix: effectivePrefix }));
            for (const row of plan.settlements)
                tx.create(db.collection('settlements').doc(`st-${input.operationId}-${row.statementId}`), {
                    companyId, operationId: input.operationId, cashEntryId: input.operationId,
                    statementId: row.statementId, amount: row.amount, createdAt,
                });
            tx.create(operation, { companyId, partnerId: input.partnerId, requestHash,
                applications: plan.applications, settlements: plan.settlements,
                entryHash: fingerprint(business), docNo, issuePrefix: effectivePrefix, cashEntryId: input.operationId, createdAt, createdBy: actorId });
            if (stateSnap.exists)
                tx.update(state, { revision: revision + 1 });
            else
                tx.create(state, { companyId, partnerId: input.partnerId, revision: 1 });
            return { status: 'applied', id: input.operationId, docNo };
        }
        catch (error) {
            if (error instanceof partnerPaymentPlan_1.PartnerPaymentValidationError)
                error = new https_1.HttpsError('failed-precondition', error.message);
            if (!operationSnap.exists && !entrySnap.exists && !otherSnap.exists && !ownedSettlements.length
                && !writesStarted && error instanceof https_1.HttpsError
                && (error.code === 'invalid-argument' || error.code === 'failed-precondition')) {
                tx.create(operation, { companyId, partnerId: input.partnerId, requestHash, status: 'rejected',
                    failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString(), createdBy: actorId });
                return { status: 'rejected', failureCode: error.code, failureMessage: error.message };
            }
            throw error;
        }
    });
    if (outcome.status === 'rejected')
        throw new https_1.HttpsError(outcome.failureCode, outcome.failureMessage, {
            partnerPaymentFailure: { version: 1, companyId, partnerId: input.partnerId, operationId: input.operationId,
                operationRejected: true, financialWrites: false },
        });
    return outcome;
}
exports.recordPartnerPaymentCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return recordPartnerPayment(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=partnerPaymentCommand.js.map