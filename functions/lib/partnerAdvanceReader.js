"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPartnerAdvanceSnapshot = readPartnerAdvanceSnapshot;
exports.advanceClaims = advanceClaims;
exports.resolveSelectedAdvance = resolveSelectedAdvance;
exports.verifyAdvanceTarget = verifyAdvanceTarget;
const releaseGate_1 = require("./releaseGate");
const companyOf = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
/** Internal full-history read set. Never accept this structure from the client.
 * Whole collection reads retain pre-company legacy documents; filter before returning.
 * All reads must finish before the command makes its first write.
 */
async function readPartnerAdvanceSnapshot(db, tx, companyId, partnerId) {
    const names = ['cashEntries', 'issuedStatements', 'settlements', 'returnApplications', 'returnOperations', 'partnerPaymentOperations', 'partnerAdvanceOperations'];
    const [collections, partner, state, cutover, advanceGate, release] = await Promise.all([
        Promise.all(names.map(name => tx.get(db.collection(name)))),
        tx.get(db.collection('partners').doc(partnerId)),
        tx.get(db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${partnerId}`)),
        tx.get(db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`)),
        tx.get(db.collection('appMeta').doc(`partnerAdvanceCutover_${companyId}`)),
        tx.get((0, releaseGate_1.releaseGateRef)(db)),
    ]);
    const rows = {};
    names.forEach((name, index) => {
        rows[name] = collections[index].docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))).filter(row => companyOf(row) === companyId);
    });
    return { companyId, partnerId, rows, partner, state, cutover, advanceGate, release };
}
const https_1 = require("firebase-functions/v2/https");
const partnerPaymentCommand_1 = require("./partnerPaymentCommand");
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const returnClaimReader_1 = require("./returnClaimReader");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const cashLineProjection_1 = require("./shared/cashLineProjection");
const partnerAdvance_1 = require("./shared/partnerAdvance");
const partnerAdvanceReceipt_1 = require("./shared/partnerAdvanceReceipt");
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
const calendarDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
function advanceClaims(snapshot) {
    var _a;
    const { companyId, partnerId, rows } = snapshot;
    const statements = rows.issuedStatements.filter(row => row.partnerId === partnerId);
    for (const row of statements.filter(row => row.noncashApplication !== undefined)) {
        try {
            (0, partnerAdvanceReceipt_1.assertAdvanceOperation)(row, (_a = rows.partnerAdvanceOperations.find(op => op.id === row.noncashApplication.operationId)) !== null && _a !== void 0 ? _a : {});
        }
        catch (error) {
            fail(error instanceof Error ? error.message : '적용 감사가 다릅니다.');
        }
    }
    const claims = statements.filter(row => !(0, partnerAdvance_1.isAdvanceStatement)(row)).map(row => (0, partnerPaymentCommand_1.claimFromStatement)(row.id, row)).filter((row) => row !== null);
    const returned = (0, returnClaimReader_1.projectClaimsAfterReturns)(claims, rows.returnApplications.filter(row => row.partnerId === partnerId), statements, rows.returnOperations);
    return (0, partnerAdvance_1.claimsAfterAdvance)(returned, statements, companyId, partnerId);
}
/** Source and target are selected by an authenticated request, not client supplied balances. */
async function resolveSelectedAdvance(db, tx, snapshot, source, statementId, internal) {
    var _a, _b, _c, _d;
    const { companyId, partnerId, rows } = snapshot;
    if (source.collection !== 'cashEntries' || !['133', '254'].includes(source.lineKey))
        fail('지원되는 원천 자금전표를 선택해 주세요.');
    const cash = rows.cashEntries.find(row => row.id === source.id && row.partnerId === partnerId);
    const target = rows.issuedStatements.find(row => row.id === statementId && row.partnerId === partnerId && !row.noncashApplication);
    if (!cash || !target)
        fail('선택한 원천과 대상 원문을 확인해 주세요.');
    if (cash.loanId || cash.payrollId || cash.transferOperationId || cash.returnOperationId || cash.balanceAdjustment)
        fail('전용 업무 자금전표는 이 적용 원천이 아닙니다.');
    const payment = rows.partnerPaymentOperations.find(row => row.id === cash.issueOperationId);
    const verifies = (row) => {
        try {
            const original = Object.assign(Object.assign({}, row), { id: cash.id });
            if (payment)
                (0, partnerAdvanceReceipt_1.assertOriginReceipt)('payment', original, payment, { companyId, partnerId, actorId: row.createdBy, operationId: row.issueOperationId });
            else
                (0, partnerAdvanceReceipt_1.assertGenericCashOrigin)(original, { companyId, partnerId, id: cash.id });
            return true;
        }
        catch (_a) {
            return false;
        }
    };
    const current = await tx.get(db.collection('cashEntries').doc(source.id));
    const origin = await (0, cashMutationReceipt_1.readCashCreationMutation)(db, tx, companyId, source.id, current, verifies);
    if (!current.exists || !origin && !verifies(cash))
        fail('선택한 원천의 발행 증거를 확인해야 합니다.');
    if (((_a = cash.mutationRevision) !== null && _a !== void 0 ? _a : 0) > 0 && !origin)
        fail('선택한 원천의 변경 감사가 없습니다.');
    await verifyAdvanceTarget(db, tx, snapshot, target, internal === null || internal === void 0 ? void 0 : internal.pendingTargetEdit);
    const projection = (0, cashLineProjection_1.projectCashLines)(cash, true);
    const originalAmount = projection.parts.filter(row => row.accountCode === source.lineKey)
        .reduce((sum, row) => sum + (source.lineKey === '133' ? (cash.dir === '입금' ? -row.amount : row.amount) : (cash.dir === '입금' ? row.amount : -row.amount)), 0);
    if (!calendarDate(cash.date) || !Number.isSafeInteger(originalAmount) || originalAmount <= 0)
        fail('선택한 원천에 미사용 선급·선수 증가액이 없습니다.');
    // Ambiguous historic reductions hold only the chosen account; clearly other partners are separate.
    for (const row of rows.cashEntries.filter(row => !row.partnerId || row.partnerId === partnerId)) {
        if (row.balanceAdjustment || (!row.accountCode && !((_b = row.lines) === null || _b === void 0 ? void 0 : _b.length)))
            continue;
        const parts = (0, cashLineProjection_1.projectCashLines)(row, true).parts;
        const net = parts.filter(part => part.accountCode === source.lineKey).reduce((sum, part) => sum + (source.lineKey === '133' ? (row.dir === '입금' ? -part.amount : part.amount) : (row.dir === '입금' ? part.amount : -part.amount)), 0);
        if (!Number.isSafeInteger(net))
            fail('선택 계정의 감소액 범위를 확인해야 합니다.');
        if (net < 0 && (!calendarDate(row.date) || row.date >= cash.date))
            fail('선택 원천 이후의 미귀속 감소 이력을 확인해야 합니다.');
    }
    for (const row of rows.issuedStatements.filter(row => (!row.partnerId || row.partnerId === partnerId) && !row.noncashApplication && row.type === '비용')) {
        const net = (Array.isArray(row.items) ? row.items : []).filter((line) => line.accountCode === source.lineKey)
            .reduce((sum, line) => sum + (source.lineKey === '133' ? (line.side === '차변' ? line.total : -line.total) : (line.side === '대변' ? line.total : -line.total)), 0);
        if (!Number.isSafeInteger(net))
            fail('선택 계정의 감소액 범위를 확인해야 합니다.');
        if (net < 0 && (!calendarDate(row.tradeDate) || row.tradeDate >= cash.date))
            fail('선택 원천 이후의 미귀속 감소 이력을 확인해야 합니다.');
    }
    const claims = advanceClaims(snapshot);
    const paymentCash = rows.cashEntries.filter(row => row.partnerId === partnerId).map(row => (0, partnerPaymentCommand_1.cashFromEntry)(row.id, row)).filter((row) => row !== null);
    const remaining = new Map([...(0, partnerPaymentPlan_1.openClaimBalances)({ companyId, partnerId, direction: '입금', claims, cashEntries: paymentCash, settlements: rows.settlements }),
        ...(0, partnerPaymentPlan_1.openClaimBalances)({ companyId, partnerId, direction: '출금', claims, cashEntries: paymentCash, settlements: rows.settlements })]);
    const targetClaim = claims.find(row => row.id === statementId);
    if (!targetClaim)
        fail('대상 전표의 채권·채무를 확인해야 합니다.');
    const sourceFingerprint = (0, partnerAdvanceReceipt_1.semanticHash)(cash), targetFingerprint = (0, partnerAdvanceReceipt_1.semanticHash)(target);
    const active = (0, partnerAdvance_1.activeAdvanceApplications)(rows.issuedStatements, companyId, partnerId);
    const priorSourceUse = new Map();
    for (const row of active) {
        const meta = row.noncashApplication;
        if (meta.kind !== 'advance-application')
            continue;
        for (const allocation of meta.allocations) {
            const key = (0, partnerAdvance_1.sourceKey)(allocation.source), next = ((_c = priorSourceUse.get(key)) !== null && _c !== void 0 ? _c : 0) + allocation.amount;
            if (!Number.isSafeInteger(next))
                fail('원천 사용액이 범위를 넘습니다.');
            priorSourceUse.set(key, next);
        }
    }
    const purpose = JSON.stringify([(0, partnerAdvance_1.sourceKey)(source), statementId]);
    const context = { companyId, partnerId, complete: true, unattributedReduction: false, blockedSourceKeys: [], priorSourceUse,
        sources: [{ key: source, companyId, partnerId, code: source.lineKey, originalAmount, date: cash.date, fingerprint: sourceFingerprint, purpose }],
        targets: [{ statementId, companyId, partnerId, accountCode: targetClaim.accountCode, remaining: (_d = remaining.get(statementId)) !== null && _d !== void 0 ? _d : 0, date: target.tradeDate, fingerprint: targetFingerprint, purpose }] };
    return { context, purpose, sourceFingerprint, targetFingerprint, cash, target };
}
/** Verifies current target against its original semantic receipt and every edit revision. */
async function verifyAdvanceTarget(db, tx, snapshot, target, pendingEdit) {
    var _a, _b, _c, _d;
    const validOrigin = (row) => {
        var _a;
        return typeof row.createdBy === 'string' && !!row.createdBy && typeof row.docNo === 'string' && !!row.docNo && typeof row.issueOperationId === 'string' && !!row.issueOperationId
            && ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === snapshot.companyId && row.partnerId === snapshot.partnerId
            && (row.issueStatementHash ? row.issueStatementHash === (0, partnerAdvanceReceipt_1.semanticHash)((0, partnerAdvanceReceipt_1.statementBusiness)(row)) : row.issuePayloadHash === (0, partnerAdvanceReceipt_1.semanticHash)((0, partnerAdvanceReceipt_1.genericVoucherBusiness)(row)));
    };
    const current = await tx.get(db.collection('issuedStatements').doc(target.id));
    if (!current.exists)
        fail('선택한 대상 원문이 없습니다.');
    const actual = current.data();
    const history = await tx.get(db.collection('voucherMutationOperations').where('statementId', '==', target.id));
    const edits = history.docs.map(doc => doc.data()).filter(row => row.action === 'edit-statement').sort((a, b) => a.expectedRevision - b.expectedRevision);
    const validateEdit = (operation, before, afterHash) => {
        var _a;
        return operation.kind === 'issuedStatements' && operation.status === 'applied' && operation.companyId === snapshot.companyId && operation.statementId === target.id && typeof operation.uid === 'string' && !!operation.uid
            && operation.expectedRevision === ((_a = before.mutationRevision) !== null && _a !== void 0 ? _a : 0) && operation.revision === operation.expectedRevision + 1 && operation.beforeHash === (0, cashMutationReceipt_1.cashOriginalHash)(before) && operation.afterHash === afterHash;
    };
    let original = actual;
    if (edits.length) {
        original = edits[0].beforeSnapshot;
        if (!original || ((_a = original.mutationRevision) !== null && _a !== void 0 ? _a : 0) !== 0 || !validOrigin(original))
            fail('대상 전표의 원 발행과 변경 근거를 확인해야 합니다.');
        for (let i = 0; i < edits.length; i++) {
            const row = edits[i], before = row.beforeSnapshot, next = (_c = (_b = edits[i + 1]) === null || _b === void 0 ? void 0 : _b.beforeSnapshot) !== null && _c !== void 0 ? _c : actual;
            if (!before || row.expectedRevision !== i || !validateEdit(row, before, (0, cashMutationReceipt_1.cashOriginalHash)(next)))
                fail('대상 전표의 변경 감사 사슬이 다릅니다.');
        }
        if (actual.mutationRevision !== edits.length)
            fail('대상 전표의 최신 수정 근거가 다릅니다.');
    }
    else if (((_d = actual.mutationRevision) !== null && _d !== void 0 ? _d : 0) > 0 || !validOrigin(actual))
        fail('선택한 대상 전표의 발행 증거를 확인해야 합니다.');
    if (pendingEdit) {
        if ((0, cashMutationReceipt_1.cashOriginalHash)(pendingEdit.beforeSnapshot) !== (0, cashMutationReceipt_1.cashOriginalHash)(actual) || (0, cashMutationReceipt_1.cashOriginalHash)(pendingEdit.afterSnapshot) !== (0, cashMutationReceipt_1.cashOriginalHash)(target)
            || !validateEdit(pendingEdit.operation, actual, (0, cashMutationReceipt_1.cashOriginalHash)(target)))
            fail('진행 중인 전표 수정 원문과 적용 근거가 다릅니다.');
    }
    else if ((0, cashMutationReceipt_1.cashOriginalHash)(target) !== (0, cashMutationReceipt_1.cashOriginalHash)(actual))
        fail('선택한 대상 원문이 변경됐습니다.');
    return original;
}
//# sourceMappingURL=partnerAdvanceReader.js.map