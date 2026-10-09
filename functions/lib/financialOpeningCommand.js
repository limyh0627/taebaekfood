"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.financialOpeningCommand = void 0;
exports.executeFinancialOpening = executeFinancialOpening;
exports.executeFinancialOpeningForActor = executeFinancialOpeningForActor;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const financialOpening_1 = require("./shared/financialOpening");
const releaseGate_1 = require("./releaseGate");
const calculation_1 = require("./shared/calculation");
const today = () => (0, calculation_1.kstDateOf)(new Date());
const doc = (db, collection, id) => db.collection(collection).doc(id);
const collection = (db, name) => db.collection(name);
const where = (field, _op, value) => ({ field, value });
const query = (collection, ...clauses) => clauses.reduce((result, clause) => result.where(clause.field, '==', clause.value), collection);
const runTransaction = (store, run) => store.runTransaction(run);
async function createOpeningPartnerBalanceWithDb(store, companyId, date, partnerId, code, amount) {
    const partnerRef = doc(store, 'partners', partnerId);
    const openingRef = doc(store, 'openingBalances', (0, financialOpening_1.openingDocumentId)(companyId));
    const id = `opening-partner-${companyId}-${date}-${partnerId}-${code}`;
    const voucherRef = doc(store, 'issuedStatements', id);
    return runTransaction(store, async (tx) => {
        var _a, _b, _c, _d;
        const [partnerSnap, openingSnap, voucherSnap] = await Promise.all([
            tx.get(partnerRef), tx.get(openingRef), tx.get(voucherRef),
        ]);
        if (!partnerSnap.exists())
            throw new https_1.HttpsError('failed-precondition', '거래처가 없습니다.');
        const partner = Object.assign({ id: partnerSnap.id }, partnerSnap.data());
        if ((0, financialOpening_1.openingCompanyOf)(partner) !== companyId)
            throw new https_1.HttpsError('failed-precondition', '다른 회사 거래처입니다.');
        if (!openingSnap.exists() || openingSnap.data().companyId !== companyId || openingSnap.data().date !== date) {
            throw new https_1.HttpsError('failed-precondition', '먼저 해당 날짜의 회계 기초잔액을 저장하세요.');
        }
        if (Number((_b = (_a = openingSnap.data().amounts) === null || _a === void 0 ? void 0 : _a[code]) !== null && _b !== void 0 ? _b : 0) !== 0) {
            throw new https_1.HttpsError('failed-precondition', `${code} 계정에 합계 기초잔액이 있어 이중계상됩니다. 기존 금액을 확인하세요.`);
        }
        const voucher = (0, financialOpening_1.openingPartnerStatement)(companyId, date, partner, code, amount);
        if (voucherSnap.exists()) {
            const saved = voucherSnap.data();
            if (saved.companyId === companyId && saved.partnerId === partnerId && saved.tradeDate === date &&
                ((_d = (_c = saved.items) === null || _c === void 0 ? void 0 : _c.find((i) => i.accountCode === code)) === null || _d === void 0 ? void 0 : _d.total) === amount)
                return 'unchanged';
            throw new https_1.HttpsError('failed-precondition', '같은 기초 전표번호에 다른 내용이 저장되어 있습니다.');
        }
        tx.update(openingRef, { hasPartnerOpening: true });
        tx.set(voucherRef, voucher);
        return 'created';
    });
}
async function createLoanWithOpeningWithDb(store, companyId, loan) {
    var _a, _b;
    if (loan.companyId !== companyId || !loan.id || !((_a = loan.name) === null || _a === void 0 ? void 0 : _a.trim()) || !((_b = loan.lenderName) === null || _b === void 0 ? void 0 : _b.trim()) ||
        !(0, financialOpening_1.openingCalendarDay)(loan.openingDate) || !Number.isInteger(loan.openingPrincipal) || loan.openingPrincipal < 0 ||
        (loan.accountCode !== '260' && loan.accountCode !== '293'))
        throw new https_1.HttpsError('failed-precondition', '대출 회사·계정·기초일·원금을 확인하세요.');
    const loanRef = doc(store, 'loanContracts', loan.id);
    const openingRef = doc(store, 'openingBalances', (0, financialOpening_1.openingDocumentId)(companyId));
    const voucherRef = doc(store, 'issuedStatements', `opening-loan-${companyId}-${loan.id}`);
    const partnerRef = loan.partnerId ? doc(store, 'partners', loan.partnerId) : null;
    return runTransaction(store, async (tx) => {
        var _a, _b;
        const [loanSnap, openingSnap, voucherSnap, partnerSnap] = await Promise.all([
            tx.get(loanRef), tx.get(openingRef), tx.get(voucherRef), partnerRef ? tx.get(partnerRef) : Promise.resolve(null),
        ]);
        if (partnerRef && (!(partnerSnap === null || partnerSnap === void 0 ? void 0 : partnerSnap.exists()) || (0, financialOpening_1.openingCompanyOf)(partnerSnap.data()) !== companyId))
            throw new https_1.HttpsError('failed-precondition', '다른 회사 금융기관이거나 없는 거래처입니다.');
        const hasOpening = loan.openingPrincipal > 0;
        const openingData = openingSnap.data();
        if (hasOpening && (!openingData || openingData.companyId !== companyId || openingData.date !== loan.openingDate)) {
            throw new https_1.HttpsError('failed-precondition', '시작 원금은 회계 기초잔액 기준일과 같을 때만 등록할 수 있습니다. 기초잔액을 먼저 저장하거나 시작 원금 0원으로 등록 후 차입 전표를 발행하세요.');
        }
        if (hasOpening && Number((_b = (_a = openingData === null || openingData === void 0 ? void 0 : openingData.amounts) === null || _a === void 0 ? void 0 : _a[loan.accountCode]) !== null && _b !== void 0 ? _b : 0) !== 0) {
            throw new https_1.HttpsError('failed-precondition', '대출 계정에 합계 기초잔액이 있어 이중계상됩니다. 기존 금액을 확인하세요.');
        }
        const sameLoan = loanSnap.exists() && ['companyId', 'name', 'lenderName', 'partnerId', 'accountCode', 'openingDate', 'openingPrincipal', 'maturityDate']
            .every(key => { var _a, _b; return ((_a = loanSnap.data()[key]) !== null && _a !== void 0 ? _a : '') === ((_b = loan[key]) !== null && _b !== void 0 ? _b : ''); });
        if (loanSnap.exists() || voucherSnap.exists()) {
            if (sameLoan && (hasOpening ? voucherSnap.exists() && voucherSnap.data().companyId === companyId && voucherSnap.data().totalAmount === loan.openingPrincipal : !voucherSnap.exists()))
                return 'unchanged';
            throw new https_1.HttpsError('failed-precondition', '같은 대출 요청에 다른 내용이 저장되어 있습니다. 새로 열어 다시 등록하세요.');
        }
        tx.set(loanRef, loan);
        if (hasOpening) {
            tx.update(openingRef, { hasLoanOpening: true });
            tx.set(voucherRef, (0, financialOpening_1.loanOpeningStatement)(loan));
        }
        return 'created';
    });
}
async function updateLoanOpeningWithDb(store, companyId, originalLoan, newDate, targetCurrentBalance) {
    if (originalLoan.companyId !== companyId || !originalLoan.id ||
        (originalLoan.accountCode !== '260' && originalLoan.accountCode !== '293') ||
        !(0, financialOpening_1.openingCalendarDay)(newDate) || !Number.isSafeInteger(targetCurrentBalance) || targetCurrentBalance < 0) {
        throw new https_1.HttpsError('failed-precondition', '대출 회사·시작일·현재 원금 잔액을 확인하세요.');
    }
    const loanRef = doc(store, 'loanContracts', originalLoan.id);
    const voucherRef = doc(store, 'issuedStatements', `opening-loan-${companyId}-${originalLoan.id}`);
    await runTransaction(store, async (tx) => {
        var _a, _b;
        const entries = await tx.get(query(collection(store, 'cashEntries'), where('companyId', '==', companyId), where('loanId', '==', originalLoan.id)));
        const [loanSnap, voucherSnap, cashSnaps] = await Promise.all([
            tx.get(loanRef), tx.get(voucherRef), Promise.all(entries.docs.map(row => tx.get(row.ref))),
        ]);
        const latest = loanSnap.data();
        const original = originalLoan;
        const fields = ['companyId', 'name', 'lenderName', 'partnerId', 'accountCode', 'openingDate', 'openingPrincipal', 'maturityDate', 'note', 'createdAt', 'movementRevision', 'principalBalance'];
        if (!loanSnap.exists() || loanSnap.id !== originalLoan.id || (latest === null || latest === void 0 ? void 0 : latest.companyId) !== companyId || fields.some(key => { var _a, _b; return ((_a = latest === null || latest === void 0 ? void 0 : latest[key]) !== null && _a !== void 0 ? _a : '') !== ((_b = original[key]) !== null && _b !== void 0 ? _b : ''); })) {
            throw new https_1.HttpsError('failed-precondition', '대출 계약이 변경되었습니다. 새로 조회한 뒤 다시 저장하세요.');
        }
        const movements = cashSnaps.filter(snap => snap.exists()).map(snap => (Object.assign(Object.assign({}, snap.data()), { id: snap.id })));
        if (movements.some(row => (0, financialOpening_1.openingCompanyOf)(row) !== companyId || row.loanId !== originalLoan.id)) {
            throw new https_1.HttpsError('failed-precondition', '대출 연결 전표가 변경되었습니다. 다시 조회하세요.');
        }
        const openingPrincipal = (0, financialOpening_1.loanOpeningPrincipalForBalance)(originalLoan, movements, newDate, targetCurrentBalance);
        let voucherPatch;
        if (voucherSnap.exists()) {
            const voucher = voucherSnap.data();
            const accountingDate = voucher.tradeDate || ((_a = voucher.issuedAt) === null || _a === void 0 ? void 0 : _a.slice(0, 10));
            if (voucher.companyId !== companyId || voucher.id !== voucherRef.id || voucher.docNo !== `기초대출-${originalLoan.id}` || !(0, financialOpening_1.openingCalendarDay)(accountingDate) ||
                voucher.type !== '비용' || voucher.orderId !== '' || voucher.partnerId !== ((_b = originalLoan.partnerId) !== null && _b !== void 0 ? _b : '') ||
                voucher.partnerName !== originalLoan.lenderName || !Array.isArray(voucher.items) || voucher.items.length !== 2 ||
                !Number.isSafeInteger(voucher.totalAmount) || voucher.totalAmount < 0 || voucher.totalSupply !== voucher.totalAmount || voucher.totalTax !== 0 ||
                voucher.items[0].accountCode !== '375' || voucher.items[0].side !== '차변' ||
                voucher.items[1].accountCode !== originalLoan.accountCode || voucher.items[1].side !== '대변' ||
                voucher.items.some(line => line.qty !== 1 || line.tax !== 0 || line.lineKind !== 'account' || line.price !== voucher.totalAmount || line.supply !== voucher.totalAmount || line.total !== voucher.totalAmount)) {
                throw new https_1.HttpsError('failed-precondition', '대출 기초 전표의 회사·일자·분개를 확인하세요.');
            }
            const amount = (0, financialOpening_1.loanOpeningPrincipalForBalance)(originalLoan, movements, accountingDate, targetCurrentBalance);
            voucherPatch = { totalSupply: amount, totalTax: 0, totalAmount: amount,
                items: voucher.items.map(line => (Object.assign(Object.assign({}, line), { price: amount, supply: amount, total: amount }))) };
        }
        const revision = latest === null || latest === void 0 ? void 0 : latest.movementRevision;
        if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1)))
            throw new https_1.HttpsError('failed-precondition', '대출 원금 변경 버전을 확인하세요.');
        tx.update(loanRef, Object.assign(Object.assign({ openingDate: newDate, openingPrincipal }, (revision !== undefined && { movementRevision: revision + 1 })), ((revision !== undefined || (latest === null || latest === void 0 ? void 0 : latest.principalBalance) !== undefined) && { principalBalance: targetCurrentBalance })));
        if (voucherPatch)
            tx.update(voucherRef, voucherPatch);
    });
}
async function createCashAccountWithOpeningWithDb(store, companyId, account) {
    var _a;
    if (account.companyId !== companyId || !account.id || !((_a = account.name) === null || _a === void 0 ? void 0 : _a.trim()) ||
        !(0, financialOpening_1.openingCalendarDay)(account.openingDate) || !Number.isInteger(account.openingBalance) || account.openingBalance < 0 ||
        !['통장', '현금', '카드'].includes(account.type))
        throw new https_1.HttpsError('failed-precondition', '계좌 회사·이름·기초일·잔액을 확인하세요.');
    if (account.type === '카드' && account.openingBalance > 0)
        throw new https_1.HttpsError('failed-precondition', '카드 기초잔액은 계좌 자산과 다릅니다. 카드 계좌는 0원으로 등록하세요.');
    const accountRef = doc(store, 'cashAccounts', account.id);
    const openingRef = doc(store, 'openingBalances', (0, financialOpening_1.openingDocumentId)(companyId));
    const voucherRef = doc(store, 'issuedStatements', `opening-cash-${companyId}-${account.id}`);
    return runTransaction(store, async (tx) => {
        var _a, _b;
        const existing = await tx.get(query(collection(store, 'cashAccounts'), where('companyId', '==', companyId)));
        const prior = existing.docs.map(row => (Object.assign({ id: row.id }, row.data())));
        const [accountSnap, openingSnap, voucherSnap] = await Promise.all([
            tx.get(accountRef), tx.get(openingRef), tx.get(voucherRef),
        ]);
        const hasOpening = account.openingBalance > 0;
        const sameAccount = accountSnap.exists() && ['companyId', 'name', 'type', 'openingDate', 'openingBalance']
            .every(key => { var _a, _b; return ((_a = accountSnap.data()[key]) !== null && _a !== void 0 ? _a : '') === ((_b = account[key]) !== null && _b !== void 0 ? _b : ''); });
        if (accountSnap.exists() || voucherSnap.exists()) {
            if (sameAccount && (hasOpening ? voucherSnap.exists() && voucherSnap.data().companyId === companyId && voucherSnap.data().totalAmount === account.openingBalance : !voucherSnap.exists()))
                return 'unchanged';
            throw new https_1.HttpsError('failed-precondition', '같은 계좌 요청에 다른 내용이 저장되어 있습니다. 새로 열어 다시 등록하세요.');
        }
        const openingData = openingSnap.data();
        if (openingData && openingData.companyId !== companyId)
            throw new https_1.HttpsError('failed-precondition', '다른 회사 기초잔액입니다.');
        if (hasOpening && (openingData === null || openingData === void 0 ? void 0 : openingData.date) && openingData.date !== account.openingDate) {
            throw new https_1.HttpsError('failed-precondition', '계좌 기초일은 회계 기초잔액 기준일과 같아야 합니다.');
        }
        if (hasOpening && !openingData && prior.some(row => row.openingBalance > 0)) {
            throw new https_1.HttpsError('failed-precondition', '기존 계좌 기초잔액이 있어 먼저 회계 기초잔액을 저장·대조해야 합니다.');
        }
        if (hasOpening && openingData && !openingData.hasCashOpening) {
            const code = (0, financialOpening_1.openingCashAccountCode)(account);
            const priorTotal = prior.filter(row => row.type === account.type).reduce((sum, row) => sum + (row.openingBalance || 0), 0);
            if (Number((_b = (_a = openingData.amounts) === null || _a === void 0 ? void 0 : _a[code]) !== null && _b !== void 0 ? _b : 0) !== priorTotal) {
                throw new https_1.HttpsError('failed-precondition', '기존 계좌 잔액과 회계 기초 합계가 다릅니다. 먼저 기초잔액을 대조하세요.');
            }
        }
        tx.set(accountRef, account);
        if (hasOpening) {
            if (openingData)
                tx.update(openingRef, { hasCashOpening: true });
            else
                tx.set(openingRef, { id: (0, financialOpening_1.openingDocumentId)(companyId), companyId, date: account.openingDate, amounts: {}, hasCashOpening: true });
            tx.set(voucherRef, (0, financialOpening_1.cashOpeningStatement)(account));
        }
        return 'created';
    });
}
async function updateCashAccountOpeningWithDb(store, companyId, original, name, newDate, targetBalance, asOf = today()) {
    if (original.companyId !== companyId || !original.id || !name.trim() || !(0, financialOpening_1.openingCalendarDay)(newDate) || !(0, financialOpening_1.openingCalendarDay)(asOf) || !Number.isSafeInteger(targetBalance))
        throw new https_1.HttpsError('failed-precondition', '계좌 회사·이름·기준일·잔액을 확인하세요.');
    const accountRef = doc(store, 'cashAccounts', original.id);
    const voucherRef = doc(store, 'issuedStatements', `opening-cash-${companyId}-${original.id}`);
    await runTransaction(store, async (tx) => {
        var _a, _b;
        const entries = await tx.get(query(collection(store, 'cashEntries'), where('companyId', '==', companyId), where('cashAccountId', '==', original.id)));
        const [accountSnap, voucherSnap, cashSnaps] = await Promise.all([tx.get(accountRef), tx.get(voucherRef), Promise.all(entries.docs.map(row => tx.get(row.ref)))]);
        const latest = accountSnap.data();
        const fields = ['companyId', 'name', 'type', 'openingDate', 'openingBalance', 'active', 'createdAt'];
        if (!accountSnap.exists() || (latest === null || latest === void 0 ? void 0 : latest.companyId) !== companyId || fields.some(key => { var _a, _b; return ((_a = latest === null || latest === void 0 ? void 0 : latest[key]) !== null && _a !== void 0 ? _a : '') !== ((_b = original[key]) !== null && _b !== void 0 ? _b : ''); }))
            throw new https_1.HttpsError('failed-precondition', '계좌 정보가 변경되었습니다. 다시 열어 저장하세요.');
        const movements = cashSnaps.filter(snap => snap.exists()).map(snap => (Object.assign(Object.assign({}, snap.data()), { id: snap.id })));
        if (movements.some(entry => (0, financialOpening_1.openingCompanyOf)(entry) !== companyId || entry.cashAccountId !== original.id))
            throw new https_1.HttpsError('failed-precondition', '계좌 연결 전표가 변경되었습니다. 다시 조회하세요.');
        const openingBalance = (0, financialOpening_1.cashOpeningBalanceForCurrent)(Object.assign(Object.assign({}, latest), { id: original.id }), movements, newDate, targetBalance, asOf);
        let voucherPatch;
        if (voucherSnap.exists()) {
            const voucher = voucherSnap.data();
            const date = voucher.tradeDate || ((_a = voucher.issuedAt) === null || _a === void 0 ? void 0 : _a.slice(0, 10));
            const [asset, equity] = voucher.items || [];
            if (original.type === '카드' || voucher.companyId !== companyId || voucher.id !== voucherRef.id || voucher.docNo !== `기초계좌-${original.id}` || voucher.type !== '비용' || voucher.orderId !== '' || !(0, financialOpening_1.openingCalendarDay)(date) || ((_b = voucher.items) === null || _b === void 0 ? void 0 : _b.length) !== 2 ||
                asset.accountCode !== (0, financialOpening_1.openingCashAccountCode)(original) || equity.accountCode !== '375' || !['차변', '대변'].includes(asset.side || '') || equity.side === asset.side || !['차변', '대변'].includes(equity.side || '') ||
                !Number.isSafeInteger(voucher.totalAmount) || voucher.totalAmount < 0 || voucher.totalSupply !== voucher.totalAmount || voucher.totalTax !== 0 || voucher.items.some(line => line.qty !== 1 || line.tax !== 0 || line.lineKind !== 'account' || line.price !== voucher.totalAmount || line.supply !== voucher.totalAmount || line.total !== voucher.totalAmount))
                throw new https_1.HttpsError('failed-precondition', '계좌 기초 전표의 회사·일자·분개를 확인하세요.');
            const signed = (0, financialOpening_1.cashOpeningBalanceForCurrent)(Object.assign(Object.assign({}, latest), { id: original.id }), movements, date, targetBalance, asOf);
            const amount = Math.abs(signed);
            voucherPatch = { totalSupply: amount, totalTax: 0, totalAmount: amount, items: voucher.items.map((line, index) => (Object.assign(Object.assign(Object.assign({}, line), (index === 0 ? { name: name.trim() } : {})), { side: (index === 0) === (signed >= 0) ? '차변' : '대변', price: amount, supply: amount, total: amount }))) };
        }
        tx.update(accountRef, { name: name.trim(), openingDate: newDate, openingBalance });
        if (voucherPatch)
            tx.update(voucherRef, voucherPatch);
    });
}
async function executeFinancialOpening(db, companyId, uid, input) {
    if (!uid || !['taebaek', 'punghoe'].includes(companyId) || !input || input.companyId !== companyId || !/^[-A-Za-z0-9_:]{1,160}$/.test(input.operationId) || !['partner-create', 'loan-create', 'loan-update', 'account-create', 'account-update'].includes(input.kind))
        throw new https_1.HttpsError('invalid-argument', '기초 금융 요청을 확인하세요.');
    if (input.kind === 'partner-create' && !['108', '251'].includes(input.code))
        throw new https_1.HttpsError('invalid-argument', '기초 거래처 계정을 확인하세요.');
    const operation = db.collection('financialOpeningOperations').doc(input.operationId), requestHash = (0, cashMutationReceipt_1.cashOriginalHash)(input);
    const store = { collection: db.collection.bind(db), runTransaction: async (run) => db.runTransaction(async (tx) => {
            const prior = await tx.get(operation);
            const release = await tx.get((0, releaseGate_1.releaseGateRef)(db));
            (0, releaseGate_1.assertReleaseActive)(release, input.releaseId);
            if (prior.exists) {
                const row = prior.data();
                if (row.companyId !== companyId || row.createdBy !== uid || row.requestHash !== requestHash || row.status !== 'applied' || row.kind !== input.kind || !['created', 'unchanged', 'updated'].includes(row.result))
                    throw new https_1.HttpsError('failed-precondition', '기존 기초 금융 요청과 원문이 다릅니다.');
                return row.result;
            }
            const wrap = (snap) => ({ id: snap.id, ref: snap.ref, exists: () => snap.exists, data: () => snap.data() });
            const get = async (ref) => {
                if ('path' in ref)
                    return wrap(await tx.get(ref));
                const rows = await tx.get(ref);
                return { docs: rows.docs.map(wrap) };
            };
            const proxy = { get: get, set: tx.set.bind(tx), create: tx.create.bind(tx), update: tx.update.bind(tx), delete: tx.delete.bind(tx), getAll: tx.getAll.bind(tx) };
            const result = await run(proxy);
            tx.create(operation, { companyId, createdBy: uid, kind: input.kind, status: 'applied', requestHash, result: result !== null && result !== void 0 ? result : 'updated', createdAt: new Date().toISOString() });
            return result;
        }) };
    try {
        switch (input.kind) {
            case 'partner-create': return await createOpeningPartnerBalanceWithDb(store, companyId, input.date, input.partnerId, input.code, input.amount);
            case 'loan-create': return await createLoanWithOpeningWithDb(store, companyId, input.loan);
            case 'loan-update':
                await updateLoanOpeningWithDb(store, companyId, input.original, input.newDate, input.targetBalance);
                return 'updated';
            case 'account-create': return await createCashAccountWithOpeningWithDb(store, companyId, input.account);
            case 'account-update':
                await updateCashAccountOpeningWithDb(store, companyId, input.original, input.name, input.newDate, input.targetBalance, input.asOf);
                return 'updated';
        }
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw new https_1.HttpsError(error.code, error.message, { operationStatus: 'rejected', version: 1, financialWrites: false, companyId, operationId: input.operationId });
        throw error;
    }
}
async function executeFinancialOpeningForActor(db, actor, input) {
    const company = actor === null || actor === void 0 ? void 0 : actor.token.companyId;
    if (!actor || actor.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(String(company)))
        throw new https_1.HttpsError('permission-denied', '현재 회사 관리자만 기초 금융을 저장할 수 있습니다.');
    return executeFinancialOpening(db, company, actor.uid, input);
}
exports.financialOpeningCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => ({ result: await executeFinancialOpeningForActor(admin.firestore(), request.auth, request.data) }));
//# sourceMappingURL=financialOpeningCommand.js.map