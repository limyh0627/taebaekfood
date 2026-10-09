"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preparePartnerAdvanceCommand = exports.cancelPartnerAdvanceCommand = exports.applyPartnerAdvanceCommand = exports.cancelPartnerAdvance = exports.applyPartnerAdvance = void 0;
exports.assertAdvanceAccess = assertAdvanceAccess;
exports.readPartnerAdvanceWriteScope = readPartnerAdvanceWriteScope;
exports.prepareAdvanceApplication = prepareAdvanceApplication;
exports.prepareAdvanceCancellation = prepareAdvanceCancellation;
exports.writePartnerAdvanceMutations = writePartnerAdvanceMutations;
exports.preparePartnerAdvance = preparePartnerAdvance;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const partnerAdvanceReader_1 = require("./partnerAdvanceReader");
const partnerAdvance_1 = require("./shared/partnerAdvance");
const partnerAdvanceReceipt_1 = require("./shared/partnerAdvanceReceipt");
const releaseGate_1 = require("./releaseGate");
const partnerCutover_1 = require("./partnerCutover");
const newScopeCounter_1 = require("./newScopeCounter");
const voucherNumber_1 = require("./shared/voucherNumber");
const voucherSequenceKey = (companyId, date, prefix) => `voucherNo_${companyId}_${date}_${prefix || 'general'}`;
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
const operationId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const documentId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
function assertAdvanceAccess(snapshot, expectedRevision) {
    var _a, _b, _c, _d;
    const { companyId, partnerId, partner, state, cutover, advanceGate } = snapshot;
    if (!partner.exists || ((_b = (_a = partner.data()) === null || _a === void 0 ? void 0 : _a.companyId) !== null && _b !== void 0 ? _b : 'taebaek') !== companyId || ((_c = partner.data()) === null || _c === void 0 ? void 0 : _c.active) === false)
        fail('선택한 거래처를 확인해 주세요.');
    const gate = advanceGate.data();
    if (!advanceGate.exists || (gate === null || gate === void 0 ? void 0 : gate.companyId) !== companyId || gate.enabled !== true || gate.auditPassed !== true)
        fail('선급·선수 적용이 아직 활성화되지 않았습니다.');
    const payment = cutover.data();
    if (!cutover.exists || (payment === null || payment === void 0 ? void 0 : payment.companyId) !== companyId || payment.enabled !== true || payment.auditPassed !== true || payment.legacyWritersBlocked !== true || (0, partnerCutover_1.partnerQuarantined)(payment, partnerId))
        fail('보류된 거래처에는 적용할 수 없습니다.');
    const value = state.data();
    const revision = (_d = value === null || value === void 0 ? void 0 : value.revision) !== null && _d !== void 0 ? _d : 0;
    if (value && (value.companyId !== companyId || value.partnerId !== partnerId) || !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1))
        fail('거래처 정산 상태를 확인해 주세요.');
    if (expectedRevision !== undefined && revision !== expectedRevision)
        throw new https_1.HttpsError('aborted', '거래처 장부가 변경됐습니다. 다시 확인해 주세요.');
    return revision;
}
async function readPartnerAdvanceWriteScope(db, tx, snapshot, date, releaseId, expectedRevision) {
    (0, releaseGate_1.assertReleaseActive)(snapshot.release, releaseId);
    (0, releaseGate_1.assertVoucherDateAllowed)(snapshot.release, snapshot.companyId, date);
    const revision = assertAdvanceAccess(snapshot, expectedRevision);
    const counter = await tx.get(db.collection('appMeta').doc(voucherSequenceKey(snapshot.companyId, date, '대체')));
    const counterState = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, counter, snapshot.release, snapshot.companyId, date, '대체');
    if (counterState.companyId !== snapshot.companyId || counterState.tradeDate !== date || counterState.prefix !== '대체' || !Number.isSafeInteger(counterState.last) || counterState.last < 0)
        fail('대체 전표 번호 상태가 다릅니다.');
    return { companyId: snapshot.companyId, partnerId: snapshot.partnerId, counter, counterState, last: counterState.last, initialLast: counterState.last, revision, revisionAfter: revision + 1, date, releaseId };
}
async function prepareDocument(db, tx, snapshot, scope, actorId, action, command, body, source, targetStatementId, amount) {
    var _a, _b;
    if (scope.companyId !== snapshot.companyId || scope.partnerId !== snapshot.partnerId || command.date !== scope.date || !actorId)
        fail('적용 준비 회사·거래처·날짜가 다릅니다.');
    const statementRef = db.collection('issuedStatements').doc(`advance-${command.operationId}`), operationRef = db.collection('partnerAdvanceOperations').doc(command.operationId);
    const [statement, other, operation] = await Promise.all([tx.get(statementRef), tx.get(db.collection('cashEntries').doc(statementRef.id)), tx.get(operationRef)]);
    if (statement.exists || other.exists || operation.exists)
        fail('같은 적용 작업의 원문이 이미 있습니다.');
    if (!Number.isSafeInteger(scope.last + 1))
        fail('전표 번호가 범위를 넘습니다.');
    const docNo = (0, voucherNumber_1.formatVoucherNo)(scope.date, ++scope.last, '대체'), createdAt = new Date().toISOString();
    const requestHash = (0, partnerAdvanceReceipt_1.semanticHash)({ companyId: snapshot.companyId, actorId, action, command });
    const payload = Object.assign(Object.assign({}, body), { companyId: snapshot.companyId, partnerId: snapshot.partnerId, partnerName: (_b = (_a = snapshot.partner.data()) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '', type: '비용', orderId: '', tradeDate: scope.date, totalSupply: amount, totalTax: 0, totalAmount: amount, memo: action === 'apply' ? '선급·선수 적용' : '선급·선수 적용 취소' });
    const statementHash = (0, partnerAdvanceReceipt_1.semanticHash)((0, partnerAdvanceReceipt_1.statementBusiness)(payload));
    return { statementRef, operationRef, statement: Object.assign(Object.assign({}, payload), { id: statementRef.id, docNo, issuedAt: createdAt, createdBy: actorId, issueOperationId: command.operationId, issuePayloadHash: requestHash, issueStatementHash: statementHash, issuePrefix: '대체' }),
        operation: Object.assign({ id: command.operationId, companyId: snapshot.companyId, partnerId: snapshot.partnerId, createdBy: actorId, status: 'applied', action, command, commandHash: (0, partnerAdvanceReceipt_1.semanticHash)(command), requestHash, statementId: statementRef.id, statementHash, docNo, issuePrefix: '대체', createdAt, source, targetStatementId, amount }, (action === 'cancel' ? { applicationStatementId: command.applicationStatementId } : {})) };
}
async function prepareAdvanceApplication(db, tx, snapshot, scope, actorId, input, internal) {
    const resolved = await (0, partnerAdvanceReader_1.resolveSelectedAdvance)(db, tx, snapshot, input.source, input.statementId, internal);
    if (input.expectedSourceFingerprint !== resolved.sourceFingerprint || input.expectedTargetFingerprint !== resolved.targetFingerprint)
        fail('선택한 원천 또는 대상이 변경됐습니다. 다시 확인해 주세요.');
    const plan = (0, partnerAdvance_1.planAdvanceApplication)(resolved.context, { operationId: input.operationId, date: input.date, purpose: resolved.purpose, allocations: [{ source: input.source, statementId: input.statementId, accountCode: input.accountCode, amount: input.amount }] });
    return prepareDocument(db, tx, snapshot, scope, actorId, 'apply', input, { items: plan.items, noncashApplication: plan.metadata }, input.source, input.statementId, input.amount);
}
async function prepareAdvanceCancellation(db, tx, snapshot, applicationStatementId, input, scope) {
    var _a;
    const application = snapshot.rows.issuedStatements.find(row => row.id === applicationStatementId && row.partnerId === snapshot.partnerId);
    if (!application)
        fail('취소할 적용 원문이 없습니다.');
    (0, partnerAdvanceReceipt_1.assertAdvanceOperation)(application, (_a = snapshot.rows.partnerAdvanceOperations.find(row => { var _a; return row.id === ((_a = application.noncashApplication) === null || _a === void 0 ? void 0 : _a.operationId); })) !== null && _a !== void 0 ? _a : {});
    if (!(0, partnerAdvance_1.activeAdvanceApplications)(snapshot.rows.issuedStatements, snapshot.companyId, snapshot.partnerId).some(row => row.id === applicationStatementId))
        fail('이미 취소됐거나 취소할 적용이 아닙니다.');
    const metadata = application.noncashApplication;
    if (metadata.allocations.length !== 1)
        fail('단건 적용 원문을 확인해 주세요.');
    const allocation = metadata.allocations[0];
    const plan = (0, partnerAdvance_1.planAdvanceCancellation)(application, input.operationId, input.reason);
    if (input.date < application.tradeDate || scope.date !== input.date)
        fail('적용일 이전에 취소할 수 없습니다.');
    const command = { operationId: input.operationId, date: input.date, partnerId: snapshot.partnerId, applicationStatementId, reason: input.reason, expectedRevision: scope.revision, releaseId: scope.releaseId };
    return prepareDocument(db, tx, snapshot, scope, input.actorId, 'cancel', command, { items: plan.items, noncashApplication: plan.metadata }, allocation.source, allocation.statementId, allocation.amount);
}
/** Parent command may own the one revision increment. Never opens another transaction. */
function writePartnerAdvanceMutations(tx, snapshot, scope, prepared, options = {}) {
    if (!prepared.length)
        return;
    if (scope.companyId !== snapshot.companyId || scope.partnerId !== snapshot.partnerId)
        fail('적용 저장 회사·거래처가 다릅니다.');
    if (scope.last - scope.initialLast !== prepared.length || prepared.length * 2 + 2 > 500)
        fail('적용 전표 번호 예약이 다릅니다.');
    for (const plan of prepared) {
        tx.create(plan.statementRef, plan.statement);
        tx.create(plan.operationRef, plan.operation);
    }
    (0, newScopeCounter_1.writeVoucherCounter)(tx, scope.counter, scope.counterState, scope.last);
    if (options.writePartnerRevision !== false) {
        if (snapshot.state.exists)
            tx.update(snapshot.state.ref, { revision: scope.revisionAfter });
        else
            tx.create(snapshot.state.ref, { companyId: snapshot.companyId, partnerId: snapshot.partnerId, revision: scope.revisionAfter });
    }
}
async function mutate(db, companyId, actorId, action, input) {
    if (!actorId || !input || !operationId(input.operationId) || !id(input.partnerId) || !id(input.releaseId) || !validDate(input.date) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
        throw new https_1.HttpsError('invalid-argument', '적용 요청이 잘못되었습니다.');
    if (action === 'apply') {
        const row = input;
        if (!row.source || row.source.collection !== 'cashEntries' || !documentId(row.source.id) || !['133', '254'].includes(row.source.lineKey) || !documentId(row.statementId) || !['108', '251', '253'].includes(row.accountCode) || !Number.isSafeInteger(row.amount) || row.amount <= 0 || ![row.expectedSourceFingerprint, row.expectedTargetFingerprint].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)))
            throw new https_1.HttpsError('invalid-argument', '원천·대상·적용액을 확인해 주세요.');
    }
    else {
        const row = input;
        if (!documentId(row.applicationStatementId) || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500)
            throw new https_1.HttpsError('invalid-argument', '취소 원문·사유를 확인해 주세요.');
    }
    const command = JSON.parse(JSON.stringify(input)), requestHash = (0, partnerAdvanceReceipt_1.semanticHash)({ companyId, actorId, action, command });
    const result = await db.runTransaction(async (tx) => {
        const prior = await tx.get(db.collection('partnerAdvanceOperations').doc(input.operationId));
        if (prior.exists) {
            const op = prior.data();
            if (op.requestHash !== requestHash || op.commandHash !== (0, partnerAdvanceReceipt_1.semanticHash)(command) || op.companyId !== companyId || op.createdBy !== actorId || op.action !== action)
                fail('이전 요청과 원문이 다릅니다.');
            if (op.status === 'rejected') {
                if (!['invalid-argument', 'failed-precondition', 'aborted'].includes(op.failureCode) || typeof op.failureMessage !== 'string')
                    fail('이전 거절 근거가 다릅니다.');
                return { status: 'rejected', failureCode: op.failureCode, failureMessage: op.failureMessage };
            }
            const statement = await tx.get(db.collection('issuedStatements').doc(op.statementId));
            if (!statement.exists)
                fail('이전 요청 원문이 없습니다.');
            (0, partnerAdvanceReceipt_1.assertAdvanceOperation)(Object.assign(Object.assign({}, statement.data()), { id: statement.id }), Object.assign(Object.assign({}, op), { id: prior.id }));
            return { status: 'duplicate', id: statement.id, docNo: op.docNo };
        }
        let writesStarted = false;
        try {
            const snapshot = await (0, partnerAdvanceReader_1.readPartnerAdvanceSnapshot)(db, tx, companyId, input.partnerId);
            const scope = await readPartnerAdvanceWriteScope(db, tx, snapshot, input.date, input.releaseId, input.expectedRevision);
            const prepared = action === 'apply' ? await prepareAdvanceApplication(db, tx, snapshot, scope, actorId, input) : await prepareAdvanceCancellation(db, tx, snapshot, input.applicationStatementId, { operationId: input.operationId, date: input.date, reason: input.reason, actorId }, scope);
            writesStarted = true;
            writePartnerAdvanceMutations(tx, snapshot, scope, [prepared]);
            return { status: 'applied', id: prepared.statement.id, docNo: prepared.statement.docNo };
        }
        catch (error) {
            if (error instanceof partnerAdvance_1.PartnerAdvanceValidationError)
                error = new https_1.HttpsError('failed-precondition', error.message);
            if (!writesStarted && error instanceof https_1.HttpsError && ['invalid-argument', 'failed-precondition', 'aborted'].includes(error.code)) {
                tx.create(prior.ref, { companyId, partnerId: input.partnerId, createdBy: actorId, status: 'rejected', action, command, commandHash: (0, partnerAdvanceReceipt_1.semanticHash)(command), requestHash, failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString() });
                return { status: 'rejected', failureCode: error.code, failureMessage: error.message };
            }
            throw error;
        }
    });
    if (result.status === 'rejected')
        throw new https_1.HttpsError(result.failureCode, result.failureMessage, { partnerAdvanceFailure: { version: 1, companyId, partnerId: input.partnerId, operationId: input.operationId, operationRejected: true, financialWrites: false, actorId, command, requestHash, commandHash: (0, partnerAdvanceReceipt_1.semanticHash)(command) } });
    return result;
}
const applyPartnerAdvance = (db, companyId, actorId, input) => mutate(db, companyId, actorId, 'apply', input);
exports.applyPartnerAdvance = applyPartnerAdvance;
const cancelPartnerAdvance = (db, companyId, actorId, input) => mutate(db, companyId, actorId, 'cancel', input);
exports.cancelPartnerAdvance = cancelPartnerAdvance;
const companyAuth = (request) => { if (!request.auth)
    throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.'); const companyId = request.auth.token.companyId; if (request.auth.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(companyId))
    throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.'); return { companyId: companyId, actorId: request.auth.uid }; };
exports.applyPartnerAdvanceCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => { const actor = companyAuth(request); return (0, exports.applyPartnerAdvance)(admin.firestore(), actor.companyId, actor.actorId, request.data); });
exports.cancelPartnerAdvanceCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => { const actor = companyAuth(request); return (0, exports.cancelPartnerAdvance)(admin.firestore(), actor.companyId, actor.actorId, request.data); });
async function preparePartnerAdvance(db, companyId, partnerId) {
    if (!id(partnerId))
        throw new https_1.HttpsError('invalid-argument', '거래처를 선택해 주세요.');
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        // One initial await establishes the transaction before collection reads.
        await tx.get(db.collection('partners').doc(partnerId));
        const snapshot = await (0, partnerAdvanceReader_1.readPartnerAdvanceSnapshot)(db, tx, companyId, partnerId);
        const result = { enabled: false, revision: (_b = (_a = snapshot.state.data()) === null || _a === void 0 ? void 0 : _a.revision) !== null && _b !== void 0 ? _b : 0, releaseId: (_d = (_c = snapshot.release.data()) === null || _c === void 0 ? void 0 : _c.releaseId) !== null && _d !== void 0 ? _d : '', sources: [], targets: [], applications: [], diagnostics: [] };
        try {
            assertAdvanceAccess(snapshot);
            (0, releaseGate_1.assertReleaseActive)(snapshot.release, result.releaseId);
            result.enabled = true;
        }
        catch (error) {
            result.blockedReason = error instanceof Error ? error.message : '적용 준비 상태를 확인해 주세요.';
            return result;
        }
        const statements = snapshot.rows.issuedStatements.filter(row => row.partnerId === partnerId && !row.noncashApplication);
        for (const cash of snapshot.rows.cashEntries.filter(row => row.partnerId === partnerId)) {
            for (const code of ['133', '254']) {
                if (cash.accountCode !== code && !((_e = cash.lines) === null || _e === void 0 ? void 0 : _e.some((line) => line.accountCode === code)))
                    continue;
                const key = { collection: 'cashEntries', id: cash.id, lineKey: code };
                let found = false, lastError = '선택 가능한 대상 원전표가 없습니다.';
                for (const target of statements) {
                    try {
                        const resolved = await (0, partnerAdvanceReader_1.resolveSelectedAdvance)(db, tx, snapshot, key, target.id);
                        const source = resolved.context.sources[0], destination = resolved.context.targets[0];
                        if (!(code === '254' ? destination.accountCode === '108' : ['251', '253'].includes(destination.accountCode)))
                            continue;
                        if (!result.sources.some(row => (0, partnerAdvance_1.sourceKey)(row.key) === (0, partnerAdvance_1.sourceKey)(key)))
                            result.sources.push({ key, code, originalAmount: source.originalAmount, remaining: source.originalAmount - ((_f = resolved.context.priorSourceUse.get((0, partnerAdvance_1.sourceKey)(key))) !== null && _f !== void 0 ? _f : 0), date: source.date, docNo: cash.docNo, note: (_g = cash.note) !== null && _g !== void 0 ? _g : '', fingerprint: resolved.sourceFingerprint });
                        if (!result.targets.some(row => row.statementId === target.id))
                            result.targets.push({ statementId: target.id, accountCode: destination.accountCode, remaining: destination.remaining, date: destination.date, docNo: target.docNo, fingerprint: resolved.targetFingerprint });
                        found = true;
                    }
                    catch (error) {
                        lastError = error instanceof Error ? error.message : '원문 증거를 확인해 주세요.';
                    }
                }
                if (!found)
                    result.diagnostics.push({ id: cash.id, reason: lastError });
            }
        }
        for (const application of (0, partnerAdvance_1.activeAdvanceApplications)(snapshot.rows.issuedStatements, companyId, partnerId)) {
            const meta = application.noncashApplication;
            if (meta.kind !== 'advance-application' || meta.allocations.length !== 1)
                continue;
            const operation = (_h = snapshot.rows.partnerAdvanceOperations.find(row => row.id === meta.operationId)) !== null && _h !== void 0 ? _h : {};
            (0, partnerAdvanceReceipt_1.assertAdvanceOperation)(application, operation);
            const allocation = meta.allocations[0];
            const raw = snapshot.rows.issuedStatements.find(row => row.id === application.id);
            result.applications.push({ statementId: application.id, amount: allocation.amount, date: application.tradeDate, docNo: raw.docNo, source: allocation.source, targetStatementId: allocation.statementId });
        }
        result.sources.sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo) || (0, partnerAdvance_1.sourceKey)(a.key).localeCompare((0, partnerAdvance_1.sourceKey)(b.key)));
        result.targets.sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo) || a.statementId.localeCompare(b.statementId));
        return result;
    });
}
exports.preparePartnerAdvanceCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => { var _a; const actor = companyAuth(request); return preparePartnerAdvance(admin.firestore(), actor.companyId, (_a = request.data) === null || _a === void 0 ? void 0 : _a.partnerId); });
//# sourceMappingURL=partnerAdvanceCommand.js.map