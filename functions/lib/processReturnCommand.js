"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processGeneralStockReturnCommand = void 0;
exports.processGeneralStockReturn = processGeneralStockReturn;
const returnClaimReader_1 = require("./returnClaimReader");
const returnValidationError_1 = require("./returnValidationError");
const admin = require("firebase-admin");
const newScopeCounter_1 = require("./newScopeCounter");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const voucherIssue_1 = require("./voucherIssue");
const returnReversalPlan_1 = require("./returnReversalPlan");
const returnGeneralStockPlan_1 = require("./returnGeneralStockPlan");
const returnUnitStockPlan_1 = require("./returnUnitStockPlan");
const stockUnitMeasure_1 = require("./shared/stockUnitMeasure");
const returnRawStockPlan_1 = require("./returnRawStockPlan");
const returnStockKind_1 = require("./shared/returnStockKind");
const partnerPaymentCommand_1 = require("./partnerPaymentCommand");
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const returnAllocationPlan_1 = require("./returnAllocationPlan");
const releaseGate_1 = require("./releaseGate");
const partnerCutover_1 = require("./partnerCutover");
const partnerAdvanceReader_1 = require("./partnerAdvanceReader");
const partnerAdvance_1 = require("./shared/partnerAdvance");
const partnerAdvanceCommand_1 = require("./partnerAdvanceCommand");
const calculation_1 = require("./shared/calculation");
const fail = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const bad = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)])) : value;
const hash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
/** 반품 역분개·정산과 품목별 재고/로트를 한 거래로 저장한다. 회사별 전환 설정은 별도 확인한다. */
async function processGeneralStockReturn(db, companyId, actorId, input) {
    if (!actorId || !input || typeof input !== 'object')
        bad('반품 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId) || !/^[A-Za-z0-9_-]{1,150}$/.test(input.returnRequestId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
        || !validDate(input.tradeDate) || !Number.isSafeInteger(input.expectedPartnerRevision)
        || input.expectedPartnerRevision < 0)
        bad('반품 작업 입력이 잘못되었습니다.');
    const requestHash = hash(input);
    const operation = db.collection('returnOperations').doc(input.operationId);
    const returnRef = db.collection('returnRequests').doc(input.returnRequestId);
    const journal = db.collection('issuedStatements').doc(`return-${input.operationId}`);
    const appRef = db.collection('returnApplications').doc(`return-${input.operationId}`);
    const counter = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, input.tradeDate, '반품'));
    const cutover = db.collection('appMeta').doc(`returnCutover_${companyId}`);
    const paymentCutover = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    const outcome = await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1;
        const opSnap = await tx.get(operation);
        const outputRows = await Promise.all([
            tx.get(db.collection('issuedStatements').where('returnOperationId', '==', input.operationId)),
            tx.get(db.collection('returnApplications').where('operationId', '==', input.operationId)),
            tx.get(db.collection('itemReceipts').where('returnOperationId', '==', input.operationId)),
            tx.get(db.collection('rawMaterialLedger').where('returnOperationId', '==', input.operationId)),
        ]);
        const journalOutput = await tx.get(journal), applicationOutput = await tx.get(appRef);
        const outputsAbsent = !journalOutput.exists && !applicationOutput.exists && outputRows.every(rows => rows.empty);
        if (opSnap.exists && ((_a = opSnap.data()) === null || _a === void 0 ? void 0 : _a.status) === 'rejected') {
            const prior = opSnap.data();
            if (prior.companyId !== companyId || prior.createdBy !== actorId
                || prior.operationId !== input.operationId || prior.returnRequestId !== input.returnRequestId
                || prior.requestHash !== requestHash || hash(prior.command) !== requestHash
                || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
                || typeof prior.failureMessage !== 'string' || !prior.failureMessage || !outputsAbsent)
                fail('기존 반품 거절 감사와 요청이 다릅니다.');
            return { status: 'rejected', failureCode: prior.failureCode, failureMessage: prior.failureMessage };
        }
        let writesStarted = false;
        try {
            const requestSnap = await tx.get(returnRef);
            const journalSnap = await tx.get(journal);
            const appSnap = await tx.get(appRef);
            const counterSnap = await tx.get(counter);
            const cutoverSnap = await tx.get(cutover);
            const paymentCutoverSnap = await tx.get(paymentCutover);
            const releaseSnap = await tx.get(releaseGate);
            (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
            (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, input.tradeDate);
            if (!requestSnap.exists || ((_b = requestSnap.data()) === null || _b === void 0 ? void 0 : _b.companyId) !== companyId)
                fail('반품 요청의 회사가 맞지 않습니다.');
            const request = requestSnap.data();
            const standalone = !request.linkedStatementId;
            if (!request.partnerId || !Array.isArray(request.items) || (standalone && !['매출', '매입'].includes(request.returnType)))
                fail('반품 원전표·거래처·품목 연결이 없습니다.');
            const businessHash = hash(Object.assign({ companyId: request.companyId, linkedStatementId: request.linkedStatementId, partnerId: request.partnerId, returnType: (_c = request.returnType) !== null && _c !== void 0 ? _c : null, totalAmount: request.totalAmount, items: request.items }, (standalone && { payableAccountCode: (_d = request.payableAccountCode) !== null && _d !== void 0 ? _d : null })));
            const sourceRef = standalone ? null : db.collection('issuedStatements').doc(request.linkedStatementId);
            const partnerRef = db.collection('partners').doc(request.partnerId);
            const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${request.partnerId}`);
            const sourceSnap = sourceRef ? await tx.get(sourceRef) : null;
            const partnerSnap = await tx.get(partnerRef);
            const stateSnap = await tx.get(stateRef);
            const priorReturns = sourceRef ? await tx.get(db.collection('returnRequests').where('linkedStatementId', '==', request.linkedStatementId)) : { docs: [] };
            const statementRows = await tx.get(db.collection('issuedStatements').where('partnerId', '==', request.partnerId));
            const cashRows = await tx.get(db.collection('cashEntries').where('partnerId', '==', request.partnerId));
            const settlementRows = await tx.get(db.collection('settlements'));
            const priorApplications = await tx.get(db.collection('returnApplications').where('partnerId', '==', request.partnerId));
            const itemRows = await tx.get(db.collection('items'));
            const bomRows = await tx.get(db.collection('item_bom'));
            const accountCodes = await tx.get(db.collection('accountCodes'));
            if (opSnap.exists) {
                const prior = opSnap.data(), saved = journalSnap.data();
                const expectedApps = (_e = prior.applications) !== null && _e !== void 0 ? _e : [{ id: appRef.id, statementId: request.linkedStatementId, amount: prior.amount }];
                const storedApps = [];
                for (const row of expectedApps)
                    storedApps.push(await tx.get(db.collection('returnApplications').doc(row.id)));
                if (prior.companyId !== companyId || prior.requestHash !== requestHash
                    || prior.businessHash !== businessHash
                    || request.status !== 'processed' || request.returnJournalId !== journal.id
                    || request.returnApplicationId !== appRef.id
                    || !journalSnap.exists || (saved === null || saved === void 0 ? void 0 : saved.docNo) !== prior.docNo
                    || (saved === null || saved === void 0 ? void 0 : saved.returnOperationId) !== input.operationId || hash(saved) !== prior.journalHash
                    || expectedApps.length === 0 || expectedApps.reduce((sum, row) => sum + row.amount, 0) !== prior.amount
                    || storedApps.some((snap, index) => {
                        var _a, _b, _c, _d, _e;
                        return !snap.exists || ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.companyId) !== companyId
                            || ((_b = snap.data()) === null || _b === void 0 ? void 0 : _b.partnerId) !== request.partnerId || ((_c = snap.data()) === null || _c === void 0 ? void 0 : _c.statementId) !== expectedApps[index].statementId
                            || ((_d = snap.data()) === null || _d === void 0 ? void 0 : _d.amount) !== expectedApps[index].amount || ((_e = snap.data()) === null || _e === void 0 ? void 0 : _e.operationId) !== input.operationId
                            || (expectedApps[index].applicationHash && hash(snap.data()) !== expectedApps[index].applicationHash);
                    }))
                    fail('기존 반품 작업과 요청이 다릅니다.');
                for (const expected of (_f = prior.receipts) !== null && _f !== void 0 ? _f : []) {
                    const receipt = await tx.get(db.collection('itemReceipts').doc(expected.id));
                    if (!receipt.exists || ((_g = receipt.data()) === null || _g === void 0 ? void 0 : _g.returnOperationId) !== input.operationId
                        || ((_h = receipt.data()) === null || _h === void 0 ? void 0 : _h.returnReceiptFingerprint) !== expected.fingerprint
                        || ((_j = receipt.data()) === null || _j === void 0 ? void 0 : _j.companyId) !== companyId || ((_k = receipt.data()) === null || _k === void 0 ? void 0 : _k.itemId) !== expected.itemId
                        || ((_l = receipt.data()) === null || _l === void 0 ? void 0 : _l.quantity) !== expected.quantity
                        || hash(receipt.data()) !== expected.receiptHash)
                        fail('기존 반품 입고와 요청이 다릅니다.');
                }
                const rawMovements = (_m = prior.rawMovements) !== null && _m !== void 0 ? _m : [];
                if (!Array.isArray(rawMovements) || (rawMovements.length && hash(rawMovements) !== prior.rawMovementsHash))
                    fail('기존 원료 반품 근거가 변경되었습니다.');
                for (const expected of rawMovements) {
                    if (typeof expected.id !== 'string' || expected.id.includes('/'))
                        fail('기존 원료 반품 ID가 잘못되었습니다.');
                    const movement = await tx.get(db.collection('rawMaterialLedger').doc(expected.id));
                    if (!movement.exists || ((_o = movement.data()) === null || _o === void 0 ? void 0 : _o.companyId) !== companyId
                        || ((_p = movement.data()) === null || _p === void 0 ? void 0 : _p.returnOperationId) !== input.operationId
                        || hash(movement.data()) !== expected.movementHash)
                        fail('기존 원료 반품 이력이 변경되었습니다.');
                }
                if (((_r = (_q = sourceSnap === null || sourceSnap === void 0 ? void 0 : sourceSnap.data()) === null || _q === void 0 ? void 0 : _q.type) !== null && _r !== void 0 ? _r : request.returnType) === '매입') {
                    const physicalRows = [...((_s = prior.stockMovements) !== null && _s !== void 0 ? _s : []), ...rawMovements.map(row => (Object.assign(Object.assign({}, row), { itemId: row.requestItemId })))];
                    if (!Array.isArray(prior.stockMovements) || physicalRows.length !== request.items.length
                        || hash(prior.stockMovements) !== prior.stockMovementsHash
                        || new Set(physicalRows.map(row => row.itemId)).size !== request.items.length
                        || physicalRows.some((row) => {
                            var _a;
                            return row.companyId !== companyId
                                || row.partnerId !== request.partnerId || row.operationId !== input.operationId
                                || row.quantityDelta !== -((_a = request.items.find((item) => item.itemId === row.itemId)) === null || _a === void 0 ? void 0 : _a.quantity)
                                || row.date !== input.tradeDate;
                        }))
                        fail('기존 반품 출고 근거가 변경되었습니다.');
                }
                return { status: 'duplicate', docNo: prior.docNo, journalId: journal.id };
            }
            if (journalSnap.exists || appSnap.exists)
                fail('반품 작업 ID가 이미 사용 중입니다.');
            if ((!standalone && (!(sourceSnap === null || sourceSnap === void 0 ? void 0 : sourceSnap.exists) || ((_t = sourceSnap.data()) === null || _t === void 0 ? void 0 : _t.companyId) !== companyId || !['매출', '매입'].includes((_u = sourceSnap.data()) === null || _u === void 0 ? void 0 : _u.type)))
                || !partnerSnap.exists || ((_v = partnerSnap.data()) === null || _v === void 0 ? void 0 : _v.companyId) !== companyId)
                fail('반품 원전표·거래처가 맞지 않습니다.');
            for (const gateSnap of [cutoverSnap, paymentCutoverSnap]) {
                const gate = gateSnap.data();
                if (!gateSnap.exists || (gate === null || gate === void 0 ? void 0 : gate.companyId) !== companyId || (gate === null || gate === void 0 ? void 0 : gate.enabled) !== true
                    || (gate === null || gate === void 0 ? void 0 : gate.legacyWritersBlocked) !== true || (gate === null || gate === void 0 ? void 0 : gate.auditPassed) !== true)
                    fail('반품·지급 writer 전환이 준비되지 않았습니다.');
                if ((0, partnerCutover_1.partnerQuarantined)(gate, request.partnerId))
                    fail('이 거래처는 과거 정산 내역 확인 후 반품 처리할 수 있습니다.');
            }
            const sequence = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, '반품');
            if ((sequence === null || sequence === void 0 ? void 0 : sequence.companyId) !== companyId || (sequence === null || sequence === void 0 ? void 0 : sequence.tradeDate) !== input.tradeDate
                || (sequence === null || sequence === void 0 ? void 0 : sequence.prefix) !== '반품' || !Number.isSafeInteger(sequence === null || sequence === void 0 ? void 0 : sequence.last) || sequence.last < 0
                || !Number.isSafeInteger(sequence.last + 1))
                fail('반품 전표 번호 카운터가 준비되지 않았습니다.');
            const revision = stateSnap.exists ? (_w = stateSnap.data()) === null || _w === void 0 ? void 0 : _w.revision : 0;
            if (!Number.isSafeInteger(revision) || revision !== input.expectedPartnerRevision)
                fail('거래처 정산 상태가 변경되었습니다.');
            const source = sourceSnap === null || sourceSnap === void 0 ? void 0 : sourceSnap.data();
            const purchase = ((_x = source === null || source === void 0 ? void 0 : source.type) !== null && _x !== void 0 ? _x : request.returnType) === '매입';
            if (purchase && ((_y = cutoverSnap.data()) === null || _y === void 0 ? void 0 : _y.purchaseGeneralStockEnabled) !== true)
                fail('매입 반품 원장 연결이 준비되지 않았습니다.');
            const direction = purchase ? '출금' : '입금';
            const oldReturns = priorReturns.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id })));
            if (standalone && request.status !== 'pending')
                fail('처리 대기 반품만 새로 확정할 수 있습니다.');
            if (standalone && request.items.some((item) => !itemRows.docs.some(doc => { var _a; return doc.id === item.itemId && ((_a = doc.data().companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId; })))
                fail('반품 품목의 회사·원문을 확인해주세요.');
            if (standalone && request.items.some((item) => ['108', '251', '253', '135', '255'].includes(item.accountCode)))
                fail('반품 품목 계정과 채권·채무·세금 계정은 구분해주세요.');
            const plan = standalone ? (0, returnReversalPlan_1.planStandaloneReturn)(request) : (0, returnReversalPlan_1.planReturnReversal)(companyId, Object.assign(Object.assign({}, request), { id: requestSnap.id }), Object.assign(Object.assign({}, source), { id: sourceSnap.id }), oldReturns);
            const stockItemCount = purchase ? request.items.length
                : request.items.filter((item) => item.isResellable).length;
            if (plan.stockEffects.length !== stockItemCount
                || plan.stockEffects.some(effect => purchase ? effect.quantityDelta >= 0 : effect.quantityDelta <= 0))
                fail('일반 재고로 복귀하는 매출 반품만 지원합니다.');
            const sourceClaim = sourceSnap && source ? (0, partnerPaymentCommand_1.claimFromStatement)(sourceSnap.id, source) : null;
            const sourceAccountCode = standalone ? (purchase ? request.payableAccountCode : '108') : sourceClaim === null || sourceClaim === void 0 ? void 0 : sourceClaim.accountCode;
            if (!sourceAccountCode || (purchase ? !['251', '253'].includes(sourceAccountCode) : sourceAccountCode !== '108'))
                fail('원전표 채권 계정이 명확하지 않습니다.');
            if (purchase && !plan.journalLines.some(line => line.accountCode === sourceAccountCode
                && line.side === '차변' && line.amount === plan.amount))
                fail('매입 반품 채무 계정이 일치하지 않습니다.');
            const existingApps = priorApplications.docs.filter(doc => { var _a; return ((_a = doc.data().companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId; })
                .map(doc => { var _a; return (Object.assign(Object.assign({ id: doc.id }, doc.data()), { companyId: (_a = doc.data().companyId) !== null && _a !== void 0 ? _a : 'taebaek' })); });
            const claims = statementRows.docs.filter(doc => { var _a; return ((_a = doc.data().companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId; })
                .map(doc => (0, partnerPaymentCommand_1.claimFromStatement)(doc.id, doc.data())).filter((row) => row !== null);
            const advanceSnapshot = await (0, partnerAdvanceReader_1.readPartnerAdvanceSnapshot)(db, tx, companyId, request.partnerId);
            const affectedAdvances = (0, partnerAdvance_1.activeAdvanceApplications)(advanceSnapshot.rows.issuedStatements, companyId, request.partnerId)
                .filter(row => row.noncashApplication.kind === 'advance-application' && row.noncashApplication.allocations.some(allocation => allocation.accountCode === sourceAccountCode));
            const advanceDate = [(0, calculation_1.kstDateOf)(new Date()), input.tradeDate, ...affectedAdvances.map(row => row.tradeDate)].sort().at(-1);
            const advanceScope = affectedAdvances.length ? await (0, partnerAdvanceCommand_1.readPartnerAdvanceWriteScope)(db, tx, advanceSnapshot, advanceDate, input.releaseId, revision) : null;
            const projectedAdvance = Object.assign(Object.assign({}, advanceSnapshot), { rows: Object.fromEntries(Object.entries(advanceSnapshot.rows).map(([key, rows]) => [key, [...rows]])) });
            const advanceMutations = [];
            for (const application of affectedAdvances) {
                const canceled = await (0, partnerAdvanceCommand_1.prepareAdvanceCancellation)(db, tx, advanceSnapshot, application.id, { operationId: 'return-cancel-' + hash([input.operationId, application.id]), date: advanceDate, reason: '반품에 따른 적용 잔량 재계산', actorId }, advanceScope);
                advanceMutations.push(canceled);
                projectedAdvance.rows.issuedStatements.push(canceled.statement);
                projectedAdvance.rows.partnerAdvanceOperations.push(canceled.operation);
            }
            const reducedClaims = advanceScope ? (0, partnerAdvanceReader_1.advanceClaims)(projectedAdvance) : await (0, returnClaimReader_1.readClaimsAfterReturns)(db, tx, claims, existingApps, statementRows.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))));
            const claimById = new Map(claims.map(row => [row.id, row]));
            for (const claim of claims) {
                const priorReturned = existingApps.filter(row => row.statementId === claim.id)
                    .reduce((sum, row) => sum + row.amount, 0);
                const pinnedCash = settlementRows.docs.filter(doc => doc.data().statementId === claim.id)
                    .reduce((sum, doc) => sum + doc.data().amount, 0);
                if (!Number.isSafeInteger(pinnedCash) || pinnedCash < 0
                    || (claim.amount < 0 ? pinnedCash !== 0 || priorReturned !== 0 : pinnedCash + priorReturned > claim.amount))
                    fail('기존 현금 정산과 반품 상계가 원청구액을 넘습니다.');
            }
            if (sourceSnap && !claimById.has(sourceSnap.id))
                fail('원전표 채권을 확인할 수 없습니다.');
            for (const old of oldReturns.filter(row => row.id !== requestSnap.id && row.linkedStatementId === (sourceSnap === null || sourceSnap === void 0 ? void 0 : sourceSnap.id)
                && row.status === 'processed')) {
                if (!existingApps.some(app => app.returnRequestId === old.id))
                    fail('기존 반품의 비현금 적용 기록이 없습니다.');
            }
            const cashEntries = cashRows.docs.filter(doc => { var _a; return ((_a = doc.data().companyId) !== null && _a !== void 0 ? _a : "taebaek") === companyId; })
                .map(doc => (0, partnerPaymentCommand_1.cashFromEntry)(doc.id, doc.data())).filter((row) => row !== null);
            const open = (0, partnerPaymentPlan_1.openClaimBalances)({ companyId, partnerId: request.partnerId, direction,
                claims: reducedClaims, cashEntries, settlements: settlementRows.docs.map(doc => (Object.assign({ id: doc.id }, doc.data()))) });
            const allocation = (0, returnAllocationPlan_1.planReturnAllocation)(Object.assign(Object.assign({ returnId: requestSnap.id, companyId, partnerId: request.partnerId, direction, amount: plan.amount }, (sourceSnap && { linkedStatementId: sourceSnap.id })), { claims: claims.filter(claim => claim.accountCode === sourceAccountCode).map(claim => {
                    var _a;
                    return ({ id: claim.id,
                        companyId: claim.companyId, partnerId: claim.partnerId, direction, tradeDate: claim.tradeDate,
                        amount: (_a = open.get(claim.id)) !== null && _a !== void 0 ? _a : 0, cashApplied: 0 });
                }), priorAllocations: [] }));
            if (allocation.unappliedAmount)
                fail("반품 상계액이 미결 채권을 넘습니다.");
            const applications = allocation.allocations.map((row, index) => ({
                id: index === 0 ? appRef.id : `${appRef.id}-${row.statementId}`, statementId: row.statementId, amount: row.amount,
            }));
            const extraAppSnaps = await Promise.all(applications.slice(1).map(row => tx.get(db.collection("returnApplications").doc(row.id))));
            if (extraAppSnaps.some(snap => snap.exists))
                fail("반품 상계 ID가 이미 사용 중입니다.");
            const todayIso = new Date().toISOString();
            const itemDocs = new Map(itemRows.docs.map(doc => [doc.id, doc.data()]));
            const companyItems = itemRows.docs.filter(doc => { var _a; return ((_a = doc.data().companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId; })
                .map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id })));
            const prepared = [];
            const rawPrepared = [];
            const rawVirtual = new Map();
            for (const effect of plan.stockEffects) {
                const item = itemDocs.get(effect.itemId);
                if (!item)
                    fail('반품 품목을 찾을 수 없습니다.');
                const base = String(item.rawMaterialName || item.name || '').split('/')[0].trim();
                const rawTargetExists = itemRows.docs.some(doc => {
                    var _a, _b;
                    const row = doc.data();
                    return ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId && row.subtype === '벌크'
                        && !row.phantom && !row.archived && String((_b = row.name) !== null && _b !== void 0 ? _b : '').split('/')[0].trim() === base;
                });
                const stockInput = { operationId: input.operationId, companyId, date: input.tradeDate,
                    createdAt: todayIso, partnerId: request.partnerId, partnerName: partnerSnap.data().name,
                    item: Object.assign(Object.assign({}, item), { id: effect.itemId, companyId: (_z = item.companyId) !== null && _z !== void 0 ? _z : 'taebaek' }), quantityDelta: effect.quantityDelta, rawTargetExists };
                if ((0, returnStockKind_1.returnStockKind)(companyId, Object.assign(Object.assign({}, item), { id: effect.itemId }), companyItems) === 'unit') {
                    const component = (0, stockUnitMeasure_1.unpackStockComponent)(bomRows.docs.filter(doc => doc.data().parent_id === effect.itemId)
                        .map(doc => {
                        var _a, _b;
                        return ({ childId: doc.data().child_id, qty: typeof doc.data().quantity === 'number' ? doc.data().quantity : 1,
                            child: itemDocs.has(doc.data().child_id) && ((_b = (_a = itemDocs.get(doc.data().child_id)) === null || _a === void 0 ? void 0 : _a.companyId) !== null && _b !== void 0 ? _b : 'taebaek') === companyId
                                ? itemDocs.get(doc.data().child_id) : undefined });
                    }));
                    const unitKg = (_0 = (0, stockUnitMeasure_1.stockUnitKg)(item, component, id => itemDocs.get(id))) !== null && _0 !== void 0 ? _0 : 0;
                    prepared.push(purchase ? (0, returnUnitStockPlan_1.planUnitReturnIssue)(stockInput, unitKg) : (0, returnUnitStockPlan_1.planUnitReturnReceipt)(stockInput, unitKg));
                    continue;
                }
                const raw = await (0, returnRawStockPlan_1.prepareReturnRawStock)(db, tx, Object.assign(Object.assign({}, stockInput), { companyId: companyId, requestId: returnRef.id, item: Object.assign(Object.assign({}, item), { id: effect.itemId }), allItems: companyItems, bomLines: bomRows.docs.map(doc => doc.data()) }), rawVirtual);
                if (raw)
                    rawPrepared.push(raw);
                else
                    prepared.push(purchase ? (0, returnGeneralStockPlan_1.planGeneralReturnIssue)(stockInput) : (0, returnGeneralStockPlan_1.planGeneralReturnReceipt)(stockInput));
            }
            const receipts = prepared.filter((row) => 'receipt' in row);
            const stockMovements = JSON.parse(JSON.stringify(prepared.flatMap(row => 'movement' in row ? [row.movement] : [])));
            const rawMovements = rawPrepared.map(row => ({ id: row.movementRef.id, companyId, partnerId: request.partnerId,
                operationId: input.operationId, date: input.tradeDate, requestItemId: row.requestItemId,
                quantityDelta: row.quantityDelta, movementHash: hash(row.movement) }));
            const receiptSnaps = await Promise.all(receipts.map(row => tx.get(db.collection('itemReceipts').doc(row.receiptId))));
            if (receiptSnaps.some(snap => snap.exists))
                fail('반품 입고 기록이 이미 있습니다.');
            const codes = new Set(accountCodes.docs.filter(doc => doc.data().companyId === companyId).map(doc => doc.data().code));
            if (plan.journalLines.some(line => !codes.has(line.accountCode)))
                fail('반품 역분개 계정이 준비되지 않았습니다.');
            const docNo = (0, voucherIssue_1.formatVoucherNo)(input.tradeDate, sequence.last + 1, '반품');
            const journalData = Object.assign(Object.assign({ companyId, issuedAt: todayIso, tradeDate: input.tradeDate, type: '비용', partnerId: request.partnerId, partnerName: partnerSnap.data().name, orderId: returnRef.id, docNo, totalSupply: plan.supply, totalTax: plan.tax, totalAmount: plan.amount, returnOperationId: input.operationId }, (sourceSnap ? { reverseOfStatementId: sourceSnap.id } : { sourceMode: 'standalone' })), { items: plan.journalLines.map(line => ({ name: '반품 역분개', spec: '', qty: 1, price: line.amount,
                    supply: line.amount, tax: 0, total: line.amount, isTaxExempt: true,
                    accountCode: line.accountCode, side: line.side })) });
            const returnOperationData = Object.assign(Object.assign({ companyId, requestHash, businessHash, returnRequestId: returnRef.id }, (sourceSnap ? { sourceStatementId: sourceSnap.id } : { sourceMode: 'standalone', returnType: request.returnType })), { amount: plan.amount, docNo, journalId: journal.id, journalHash: hash(journalData), applications: applications.map(row => ({ id: row.id, statementId: row.statementId, amount: row.amount,
                    applicationHash: hash({ companyId, partnerId: request.partnerId, statementId: row.statementId,
                        returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso }) })), stockMovements, stockMovementsHash: hash(stockMovements), rawMovements, rawMovementsHash: hash(rawMovements), receipts: receipts.map(row => ({ id: row.receiptId, itemId: row.itemId,
                    quantity: row.receipt.quantity, fingerprint: row.receipt.returnReceiptFingerprint,
                    receiptHash: hash(row.receipt) })), createdAt: todayIso, createdBy: actorId });
            if (advanceScope) {
                projectedAdvance.rows.issuedStatements.push(Object.assign(Object.assign({}, journalData), { id: journal.id }));
                projectedAdvance.rows.returnApplications.push(...applications.map(row => ({ id: row.id, companyId, partnerId: request.partnerId, statementId: row.statementId, returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso })));
                projectedAdvance.rows.returnOperations.push(Object.assign(Object.assign({}, returnOperationData), { id: operation.id }));
                for (const application of affectedAdvances) {
                    if (application.noncashApplication.kind !== 'advance-application')
                        continue;
                    for (const allocation of application.noncashApplication.allocations) {
                        const resolved = await (0, partnerAdvanceReader_1.resolveSelectedAdvance)(db, tx, projectedAdvance, allocation.source, allocation.statementId);
                        const source = resolved.context.sources[0], target = resolved.context.targets[0];
                        const amount = Math.min(allocation.amount, source.originalAmount - ((_1 = resolved.context.priorSourceUse.get((0, partnerAdvance_1.sourceKey)(allocation.source))) !== null && _1 !== void 0 ? _1 : 0), target.remaining);
                        if (amount <= 0)
                            continue;
                        const reapplied = await (0, partnerAdvanceCommand_1.prepareAdvanceApplication)(db, tx, projectedAdvance, advanceScope, actorId, {
                            operationId: 'return-reapply-' + hash([input.operationId, application.id, (0, partnerAdvance_1.sourceKey)(allocation.source), allocation.statementId]), date: advanceDate,
                            partnerId: request.partnerId, source: allocation.source, statementId: allocation.statementId, accountCode: allocation.accountCode, amount,
                            expectedRevision: revision, releaseId: input.releaseId, expectedSourceFingerprint: resolved.sourceFingerprint, expectedTargetFingerprint: resolved.targetFingerprint,
                        });
                        advanceMutations.push(reapplied);
                        projectedAdvance.rows.issuedStatements.push(reapplied.statement);
                        projectedAdvance.rows.partnerAdvanceOperations.push(reapplied.operation);
                    }
                }
                if (advanceMutations.length * 2 + prepared.length * 2 + rawPrepared.length * 4 + applications.length + 5 > 500)
                    fail('연결된 반품 적용 내역이 너무 많습니다.');
            }
            writesStarted = true;
            if (advanceScope)
                (0, partnerAdvanceCommand_1.writePartnerAdvanceMutations)(tx, advanceSnapshot, advanceScope, advanceMutations, { writePartnerRevision: false });
            (0, newScopeCounter_1.writeVoucherCounter)(tx, counterSnap, sequence, sequence.last + 1);
            for (const row of prepared) {
                tx.update(db.collection('items').doc(row.itemId), Object.assign({ stock: row.nextStock }, ('lots' in row ? { lots: JSON.parse(JSON.stringify(row.lots)) } : {})));
                if ('receipt' in row)
                    tx.create(db.collection('itemReceipts').doc(row.receiptId), row.receipt);
            }
            for (const row of rawPrepared)
                (0, returnRawStockPlan_1.writeReturnRawStock)(tx, row);
            tx.create(journal, journalData);
            for (const row of applications)
                tx.create(db.collection('returnApplications').doc(row.id), {
                    companyId, partnerId: request.partnerId, statementId: row.statementId,
                    returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso,
                });
            tx.update(returnRef, { status: 'processed', processedAt: todayIso, processedBy: actorId,
                returnJournalId: journal.id, returnApplicationId: appRef.id });
            if (stateSnap.exists)
                tx.update(stateRef, { revision: revision + 1 });
            else
                tx.create(stateRef, { companyId, partnerId: request.partnerId, revision: 1 });
            tx.create(operation, Object.assign(Object.assign({}, returnOperationData), { advanceStatementIds: advanceMutations.map(row => row.statement.id) }));
            return { status: 'applied', docNo, journalId: journal.id };
        }
        catch (error) {
            const validation = error instanceof returnValidationError_1.ReturnValidationError || error instanceof partnerPaymentPlan_1.PartnerPaymentValidationError
                ? new https_1.HttpsError('failed-precondition', error.message) : error;
            if (writesStarted || opSnap.exists || !outputsAbsent || !(validation instanceof https_1.HttpsError)
                || !['invalid-argument', 'failed-precondition'].includes(validation.code))
                throw error;
            const failureCode = validation.code;
            tx.create(operation, { status: 'rejected', companyId, operationId: input.operationId,
                returnRequestId: input.returnRequestId, requestHash, command: input,
                failureCode, failureMessage: validation.message, createdAt: new Date().toISOString(), createdBy: actorId });
            return { status: 'rejected', failureCode, failureMessage: validation.message };
        }
    });
    if (outcome.status === 'rejected')
        throw new https_1.HttpsError(outcome.failureCode, outcome.failureMessage, {
            operationStatus: 'rejected', operationId: input.operationId, returnRequestId: input.returnRequestId,
            companyId, requestHash,
        });
    return outcome;
}
exports.processGeneralStockReturnCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return processGeneralStockReturn(admin.firestore(), companyId, request.auth.uid, request.data);
});
//# sourceMappingURL=processReturnCommand.js.map