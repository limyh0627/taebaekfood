"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payrollVoucherHash = exports.issuePayrollVoucherCommand = exports.savePayrollDraftCommand = void 0;
exports.savePayrollDraft = savePayrollDraft;
exports.issuePayrollVoucher = issuePayrollVoucher;
exports.checkPayrollDraft = checked;
exports.payrollVoucherContent = voucherContent;
const admin = require("firebase-admin");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const newScopeCounter_1 = require("./newScopeCounter");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const voucherIssue_1 = require("./voucherIssue");
const releaseGate_1 = require("./releaseGate");
const REGION = 'asia-northeast3';
const fields = ['base', 'overtime', 'allowance', 'incomeTax', 'localTax', 'pension', 'health', 'employment', 'otherDeduct'];
const deductions = ['incomeTax', 'localTax', 'pension', 'health', 'employment', 'otherDeduct'];
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}
const hash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
exports.payrollVoucherHash = hash;
const payrollId = (companyId, ym) => companyId === 'taebaek' ? `pay-${ym}` : `pay-${companyId}-${ym}`;
const operationId = (companyId, ym) => `payroll-${companyId}-${ym}-base`;
function voucherContent(kind, row) {
    var _a, _b;
    const shared = { id: row.id, companyId: row.companyId, payrollId: row.payrollId,
        payrollRequestHash: row.payrollRequestHash, payrollFingerprint: row.payrollFingerprint, docNo: row.docNo };
    return kind === 'cashEntries'
        ? Object.assign(Object.assign({}, shared), { date: row.date, dir: row.dir, amount: row.amount, cashAccountId: row.cashAccountId, accountCode: (_a = row.accountCode) !== null && _a !== void 0 ? _a : null, lines: (_b = row.lines) !== null && _b !== void 0 ? _b : null, note: row.note }) : Object.assign(Object.assign({}, shared), { issuedAt: row.issuedAt, tradeDate: row.tradeDate, type: row.type, partnerId: row.partnerId, partnerName: row.partnerName, orderId: row.orderId, totalSupply: row.totalSupply, totalTax: row.totalTax, totalAmount: row.totalAmount, items: row.items });
}
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function checked(companyId, input) {
    if (!input || typeof input !== 'object' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(input.yearMonth) || !validDate(input.payDate)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !Array.isArray(input.lines) || !input.lines.length) {
        throw new https_1.HttpsError('invalid-argument', '급여대장 입력이 잘못되었습니다.');
    }
    const ids = new Set();
    const lines = input.lines.map(line => {
        var _a;
        if (!line || typeof line.employeeId !== 'string' || !line.employeeId || line.employeeId.includes('/'))
            throw new https_1.HttpsError('invalid-argument', '급여 대상 사원 ID가 잘못되었습니다.');
        if (ids.has(line.employeeId))
            throw new https_1.HttpsError('invalid-argument', '같은 사원이 중복되었습니다.');
        ids.add(line.employeeId);
        if (typeof line.employeeName !== 'string' || !line.employeeName.trim())
            throw new https_1.HttpsError('invalid-argument', '급여 대상 사원 이름이 잘못되었습니다.');
        const clean = Object.assign(Object.assign(Object.assign({ employeeId: line.employeeId, employeeName: line.employeeName, base: line.base }, (typeof line.department === 'string' ? { department: line.department } : {})), (typeof line.position === 'string' ? { position: line.position } : {})), (typeof line.note === 'string' ? { note: line.note } : {}));
        for (const field of fields) {
            const value = (_a = line[field]) !== null && _a !== void 0 ? _a : 0;
            if (!Number.isSafeInteger(value) || value < 0)
                throw new https_1.HttpsError('invalid-argument', '급여 금액은 0 이상의 정수여야 합니다.');
            clean[field] = value;
        }
        return clean;
    });
    const totals = lines.reduce((sum, line) => {
        var _a, _b;
        const gross = line.base + ((_a = line.overtime) !== null && _a !== void 0 ? _a : 0) + ((_b = line.allowance) !== null && _b !== void 0 ? _b : 0);
        const deduct = deductions.reduce((n, field) => { var _a; return n + ((_a = line[field]) !== null && _a !== void 0 ? _a : 0); }, 0);
        if (deduct > gross)
            throw new https_1.HttpsError('invalid-argument', '공제액이 급여보다 큽니다.');
        return { gross: sum.gross + gross, deduct: sum.deduct + deduct, net: sum.net + gross - deduct };
    }, { gross: 0, deduct: 0, net: 0 });
    if (!Number.isSafeInteger(totals.gross) || !Number.isSafeInteger(totals.deduct)
        || !Number.isSafeInteger(totals.net) || totals.gross <= 0 || totals.gross !== totals.deduct + totals.net) {
        throw new https_1.HttpsError('invalid-argument', '급여 합계가 잘못되었습니다.');
    }
    return { id: payrollId(companyId, input.yearMonth), lines, totals };
}
async function checkEmployees(tx, db, companyId, lines) {
    const snaps = await Promise.all(lines.map(line => tx.get(db.collection('employees').doc(line.employeeId))));
    snaps.forEach((snap, i) => {
        var _a;
        const row = snap.data();
        if (!row || ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== companyId || row.status !== 'working'
            || row.name !== lines[i].employeeName)
            throw new https_1.HttpsError('failed-precondition', '급여 대상 사원 정보가 바뀌었습니다.');
    });
}
/** A new draft is marked; unmarked old payrolls need a cutover audit before issuance. */
async function savePayrollDraft(db, companyId, input) {
    const { id, lines } = checked(companyId, input);
    const ref = db.collection('payrolls').doc(id);
    return db.runTransaction(async (tx) => {
        var _a, _b;
        const snap = await tx.get(ref);
        const old = snap.data();
        if ((old === null || old === void 0 ? void 0 : old.cashEntryId) || (old === null || old === void 0 ? void 0 : old.issueOperationId))
            throw new https_1.HttpsError('failed-precondition', '발행된 급여대장은 직접 수정할 수 없습니다.');
        if (old && old.payrollDraftVersion !== 1)
            throw new https_1.HttpsError('failed-precondition', '기존 급여대장은 발행 이력을 먼저 확인해야 합니다.');
        if (((_a = old === null || old === void 0 ? void 0 : old.revision) !== null && _a !== void 0 ? _a : 0) !== input.expectedRevision)
            throw new https_1.HttpsError('aborted', '급여대장이 다른 화면에서 변경되었습니다.');
        await checkEmployees(tx, db, companyId, lines);
        const now = new Date().toISOString();
        const row = { id, companyId, yearMonth: input.yearMonth, payDate: input.payDate, lines,
            payrollDraftVersion: 1, revision: input.expectedRevision + 1,
            createdAt: (_b = old === null || old === void 0 ? void 0 : old.createdAt) !== null && _b !== void 0 ? _b : now, updatedAt: now };
        if (snap.exists)
            tx.update(ref, row);
        else
            tx.create(ref, row);
        return { revision: row.revision };
    });
}
/** Payroll, voucher and the shared number commit together or not at all. */
async function issuePayrollVoucher(db, companyId, input) {
    if ((input === null || input === void 0 ? void 0 : input.mode) !== 'cash' && (input === null || input === void 0 ? void 0 : input.mode) !== 'accrual')
        throw new https_1.HttpsError('invalid-argument', '급여 전표 종류가 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId))
        throw new https_1.HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
    if (input.cashAccountId !== undefined && (input.mode !== 'cash' || typeof input.cashAccountId !== 'string' || !input.cashAccountId || input.cashAccountId.includes('/')))
        throw new https_1.HttpsError('invalid-argument', '급여 지급 계좌가 잘못되었습니다.');
    const { id, lines, totals } = checked(companyId, input);
    if (input.mode === 'cash' && totals.net <= 0)
        throw new https_1.HttpsError('invalid-argument', '실지급액이 0원입니다.');
    const date = input.mode === 'accrual' ? (() => {
        const [year, month] = input.yearMonth.split('-').map(Number);
        return `${input.yearMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    })() : input.payDate;
    const opId = operationId(companyId, input.yearMonth);
    const requestHash = hash(Object.assign({ mode: input.mode, yearMonth: input.yearMonth, payDate: input.payDate, lines, expectedRevision: input.expectedRevision }, (input.cashAccountId !== undefined ? { cashAccountId: input.cashAccountId } : {})));
    const payroll = db.collection('payrolls').doc(id);
    const cash = db.collection('cashEntries').doc(opId);
    const stmt = db.collection('issuedStatements').doc(opId);
    const counter = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, date, '급여'));
    const cutover = db.collection('appMeta').doc(`payrollIssueCutover_${companyId}`);
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const [paySnap, cashSnap, stmtSnap, counterSnap, cutoverSnap, accountsSnap, banksSnap, releaseSnap, ...employees] = await Promise.all([
            tx.get(payroll), tx.get(cash), tx.get(stmt), tx.get(counter), tx.get(cutover),
            tx.get(db.collection('accountCodes').where('companyId', '==', companyId)),
            tx.get(db.collection('cashAccounts').where('companyId', '==', companyId)),
            tx.get(releaseGate),
            ...lines.map(line => tx.get(db.collection('employees').doc(line.employeeId))),
        ]);
        (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
        (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, date);
        const existing = cashSnap.exists ? cashSnap : stmtSnap.exists ? stmtSnap : null;
        if (cashSnap.exists && stmtSnap.exists)
            throw new https_1.HttpsError('failed-precondition', '급여 전표가 중복 저장되었습니다.');
        if (input.mode === 'cash' && (!cashSnap.exists || ((_b = (_a = cashSnap.data()) === null || _a === void 0 ? void 0 : _a.mutationRevision) !== null && _b !== void 0 ? _b : 0) > 0)) {
            const linked = paySnap.data();
            const original = await (0, cashMutationReceipt_1.readCashCreationMutation)(db, tx, companyId, opId, cashSnap, row => {
                var _a;
                return !!linked && linked.issueOperationId === opId && linked.cashEntryId === opId && linked.issueKind === 'cashEntries'
                    && row.payrollRequestHash === requestHash && row.payrollId === id && row.companyId === companyId
                    && linked.issueDocNo === row.docNo
                    && ((_a = linked.issueOriginalVoucherHash) !== null && _a !== void 0 ? _a : linked.issueVoucherHash) === hash(voucherContent('cashEntries', row));
            });
            if (original)
                return { id: opId, docNo: original.docNo, kind: 'cashEntries' };
        }
        if (existing) {
            const data = existing.data();
            if (data.payrollRequestHash !== requestHash || data.payrollId !== id || data.companyId !== companyId)
                throw new https_1.HttpsError('already-exists', '다른 급여 내용으로 이미 전표가 발행되었습니다.');
            const linked = paySnap.data();
            if (!linked || linked.issueOperationId !== opId || linked.cashEntryId !== opId
                || linked.issueKind !== (cashSnap.exists ? 'cashEntries' : 'issuedStatements')
                || linked.issueDocNo !== data.docNo
                || linked.issueVoucherHash !== hash(voucherContent(linked.issueKind, data))) {
                throw new https_1.HttpsError('failed-precondition', '급여대장과 원전표 연결을 확인해야 합니다.');
            }
            return { id: opId, docNo: data.docNo, kind: cashSnap.exists ? 'cashEntries' : 'issuedStatements' };
        }
        const old = paySnap.data();
        const gate = cutoverSnap.data();
        if (!gate || gate.companyId !== companyId || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(gate.firstYearMonth)
            || input.yearMonth < gate.firstYearMonth) {
            throw new https_1.HttpsError('failed-precondition', '급여 과거 발행 이력과 전환월을 먼저 확인해야 합니다.');
        }
        if ((old === null || old === void 0 ? void 0 : old.cashEntryId) || (old === null || old === void 0 ? void 0 : old.issueOperationId) || (old && old.payrollDraftVersion !== 1))
            throw new https_1.HttpsError('failed-precondition', '기존 급여 발행 이력을 먼저 확인해야 합니다.');
        if (((_c = old === null || old === void 0 ? void 0 : old.revision) !== null && _c !== void 0 ? _c : 0) !== input.expectedRevision)
            throw new https_1.HttpsError('aborted', '급여대장이 다른 화면에서 변경되었습니다.');
        employees.forEach((snap, i) => {
            var _a;
            const row = snap.data();
            if (!row || ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== companyId || row.status !== 'working'
                || row.name !== lines[i].employeeName)
                throw new https_1.HttpsError('failed-precondition', '급여 대상 사원 정보가 바뀌었습니다.');
        });
        const accounts = accountsSnap.docs.map(snap => {
            const data = snap.data();
            return { id: snap.id, name: data.name, code: data.code };
        }).sort((a, b) => a.id.localeCompare(b.id));
        const code = (name) => {
            const found = accounts.find(row => row.name === name && typeof row.code === 'string');
            if (!found)
                throw new https_1.HttpsError('failed-precondition', `${name} 계정과목이 없습니다.`);
            return found.code;
        };
        const salary = code('급여');
        const withhold = totals.deduct > 0 ? code('예수금') : '';
        const accrued = input.mode === 'accrual' && totals.net > 0 ? code('미지급비용') : '';
        const bank = input.mode === 'cash' ? banksSnap.docs.map(snap => {
            const data = snap.data();
            return { id: snap.id, active: data.active, type: data.type };
        }).filter(row => row.active && row.type === '통장').sort((a, b) => a.id.localeCompare(b.id)).find(row => input.cashAccountId === undefined || row.id === input.cashAccountId) : undefined;
        if (input.mode === 'cash' && !bank)
            throw new https_1.HttpsError('failed-precondition', '활성 급여 지급 계좌가 없습니다.');
        const state = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, counterSnap, releaseSnap, companyId, date, '급여');
        if (!state || state.companyId !== companyId || state.tradeDate !== date || state.prefix !== '급여'
            || !Number.isSafeInteger(state.last) || state.last < 0) {
            throw new https_1.HttpsError('failed-precondition', '급여 전표 번호 카운터가 없거나 손상되었습니다.');
        }
        const next = state.last + 1;
        if (!Number.isSafeInteger(next))
            throw new https_1.HttpsError('resource-exhausted', '급여 전표 번호 범위를 초과했습니다.');
        const docNo = (0, voucherIssue_1.formatVoucherNo)(date, next, '급여');
        const now = new Date().toISOString();
        const payrollFingerprint = hash({ requestHash, salary, withhold, accrued, bankId: (_d = bank === null || bank === void 0 ? void 0 : bank.id) !== null && _d !== void 0 ? _d : '' });
        const common = { id: opId, companyId, payrollId: id, payrollRequestHash: requestHash, payrollFingerprint, docNo,
            createdBy: '급여대장', createdAt: now };
        const kind = input.mode === 'cash' ? 'cashEntries' : 'issuedStatements';
        const voucher = input.mode === 'cash'
            ? Object.assign(Object.assign(Object.assign(Object.assign({}, common), { date, dir: '출금', amount: totals.net, cashAccountId: bank.id }), (totals.deduct > 0 ? { lines: [
                    { accountCode: salary, amount: totals.gross, note: '총급여' },
                    { accountCode: withhold, amount: totals.deduct, side: '대변', note: '원천공제' },
                ] } : { accountCode: salary })), { note: `${input.yearMonth} 급여` }) : Object.assign(Object.assign({}, common), { issuedAt: now, tradeDate: date, type: '비용', partnerId: '', partnerName: '급여', orderId: '', totalSupply: totals.gross, totalTax: 0, totalAmount: totals.gross, items: [
                { name: '총급여', spec: '', qty: 1, price: totals.gross, supply: totals.gross, tax: 0, total: totals.gross,
                    isTaxExempt: true, accountCode: salary, side: '차변' },
                ...(totals.deduct > 0 ? [{ name: '예수금(원천공제)', spec: '', qty: 1, price: totals.deduct,
                        supply: totals.deduct, tax: 0, total: totals.deduct, isTaxExempt: true, accountCode: withhold, side: '대변' }] : []),
                ...(totals.net > 0 ? [{ name: '미지급비용', spec: '', qty: 1, price: totals.net,
                        supply: totals.net, tax: 0, total: totals.net, isTaxExempt: true, accountCode: accrued, side: '대변' }] : []),
            ] });
        tx.create(input.mode === 'cash' ? cash : stmt, voucher);
        const nextPayroll = Object.assign(Object.assign({ id, companyId, yearMonth: input.yearMonth, payDate: input.payDate, lines, payrollDraftVersion: 1, revision: input.expectedRevision + 1, cashEntryId: opId, issueOperationId: opId, issueKind: kind, issueDocNo: docNo, issueVoucherHash: hash(voucherContent(kind, voucher)), issueExpectedRevision: input.expectedRevision }, (input.cashAccountId !== undefined ? { issueCashAccountId: input.cashAccountId } : {})), { createdAt: (_e = old === null || old === void 0 ? void 0 : old.createdAt) !== null && _e !== void 0 ? _e : now, updatedAt: now });
        if (paySnap.exists)
            tx.update(payroll, nextPayroll);
        else
            tx.create(payroll, nextPayroll);
        (0, newScopeCounter_1.writeVoucherCounter)(tx, counterSnap, state, next);
        return { id: opId, docNo, kind: nextPayroll.issueKind };
    });
}
exports.savePayrollDraftCommand = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const companyId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.companyId;
    if (!request.auth || !request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return savePayrollDraft(admin.firestore(), companyId, request.data);
});
exports.issuePayrollVoucherCommand = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const companyId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.companyId;
    if (!request.auth || !request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    return issuePayrollVoucher(admin.firestore(), companyId, request.data);
});
//# sourceMappingURL=payrollVoucher.js.map