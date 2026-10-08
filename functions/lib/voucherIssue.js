"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueNumberedVoucher = exports.voucherSequenceKey = exports.formatVoucherNo = void 0;
exports.issueVoucher = issueVoucher;
const deleteIssuedStatementCommand_1 = require("./deleteIssuedStatementCommand");
const cashMutationReceipt_1 = require("./cashMutationReceipt");
const voucherNumber_1 = require("./shared/voucherNumber");
var voucherNumber_2 = require("./shared/voucherNumber");
Object.defineProperty(exports, "formatVoucherNo", { enumerable: true, get: function () { return voucherNumber_2.formatVoucherNo; } });
const newScopeCounter_1 = require("./newScopeCounter");
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const crypto_1 = require("crypto");
const releaseGate_1 = require("./releaseGate");
const REGION = 'asia-northeast3';
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    }
    return value;
}
const voucherSequenceKey = (companyId, date, prefix = '') => `voucherNo_${companyId}_${date}_${prefix || 'general'}`;
exports.voucherSequenceKey = voucherSequenceKey;
/** A missing counter is an explicit migration gate: existing numbers must be audited first. */
async function issueVoucher(db, companyId, input) {
    if (!input || typeof input !== 'object')
        throw new https_1.HttpsError('invalid-argument', '발행 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId))
        throw new https_1.HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
    const { kind, operationId, tradeDate, prefix = '', document } = input;
    if (kind !== 'issuedStatements' && kind !== 'cashEntries')
        throw new https_1.HttpsError('invalid-argument', '전표 종류가 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId))
        throw new https_1.HttpsError('invalid-argument', '작업 ID가 잘못되었습니다.');
    const parsedDate = new Date(`${tradeDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== tradeDate)
        throw new https_1.HttpsError('invalid-argument', '전표일이 잘못되었습니다.');
    if (!['', '가공', '반품', '대체', '급여'].includes(prefix))
        throw new https_1.HttpsError('invalid-argument', '전표 접두사가 잘못되었습니다.');
    if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new https_1.HttpsError('invalid-argument', '전표 내용이 잘못되었습니다.');
    if (document.companyId !== undefined && document.companyId !== companyId)
        throw new https_1.HttpsError('permission-denied', '다른 회사의 전표를 발행할 수 없습니다.');
    const field = kind === 'cashEntries' ? 'date' : 'tradeDate';
    if (document[field] !== tradeDate)
        throw new https_1.HttpsError('invalid-argument', '전표일이 일치하지 않습니다.');
    if (kind === 'cashEntries' && (typeof document.amount !== 'number' || !Number.isFinite(document.amount) || document.amount <= 0)) {
        throw new https_1.HttpsError('invalid-argument', '자금전표 금액은 0보다 큰 유한한 수여야 합니다.');
    }
    if (kind === 'cashEntries') {
        const protectedCodes = new Set(['108', '251', '253', '260', '293']);
        const lines = Array.isArray(document.lines) ? document.lines : [];
        const codes = [document.accountCode, ...lines.map(line => (line && typeof line === 'object' ? line.accountCode : undefined))];
        if (codes.some(code => protectedCodes.has(String(code)))
            || ['loanId', 'returnRequestId', 'returnOperationId', 'partnerPaymentOperationId', 'settlementId',
                'settlements', 'allocations', 'paymentId', 'reverse'].some(field => field in document)) {
            throw new https_1.HttpsError('failed-precondition', '거래처 지급·대출·반품 연결은 해당 서버 원자 명령에서 처리해야 합니다.');
        }
    }
    if (kind === 'issuedStatements') {
        const { totalAmount, totalSupply, totalTax } = document;
        if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount === 0
            || typeof totalSupply !== 'number' || !Number.isFinite(totalSupply)
            || typeof totalTax !== 'number' || !Number.isFinite(totalTax)
            || Math.round((totalSupply + totalTax) * 100) !== Math.round(totalAmount * 100)) {
            throw new https_1.HttpsError('invalid-argument', '전표 공급가·세액·총액이 일치하지 않습니다.');
        }
    }
    const { id: _id, docNo: _docNo, issueOperationId: _operation, issuePayloadHash: _hash, issuePrefix: _prefix } = document, body = __rest(document, ["id", "docNo", "issueOperationId", "issuePayloadHash", "issuePrefix"]);
    const payload = Object.assign(Object.assign({}, body), { companyId });
    // 발행 시각/담당자는 재시도 때 달라질 수 있다. 금액·상대·계정 등 업무 내용은 고정한다.
    const { createdAt: _createdAt, issuedAt: _issuedAt, createdBy: _createdBy } = payload, semanticPayload = __rest(payload, ["createdAt", "issuedAt", "createdBy"]);
    const issuePayloadHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(semanticPayload))).digest('hex');
    const target = db.collection(kind).doc(operationId);
    const other = db.collection(kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries').doc(operationId);
    const counter = db.collection('appMeta').doc((0, exports.voucherSequenceKey)(companyId, tradeDate, prefix));
    const catchUpCounter = db.collection('appMeta').doc((0, exports.voucherSequenceKey)(companyId, tradeDate, '추가'));
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    return db.runTransaction(async (tx) => {
        var _a, _b;
        const [existing, otherKind, normalSequence, catchUpSequence, releaseSnap] = await Promise.all([
            tx.get(target), tx.get(other), tx.get(counter), tx.get(catchUpCounter), tx.get(releaseGate),
        ]);
        (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
        const mode = (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, tradeDate, prefix === '');
        const effectivePrefix = mode === 'catchUp' ? '추가' : prefix;
        const sequence = mode === 'catchUp' ? catchUpSequence : normalSequence;
        if (otherKind.exists)
            throw new https_1.HttpsError('already-exists', '작업 ID가 다른 종류의 전표에 사용되었습니다.');
        if (kind === 'cashEntries' && (!existing.exists || ((_b = (_a = existing.data()) === null || _a === void 0 ? void 0 : _a.mutationRevision) !== null && _b !== void 0 ? _b : 0) > 0)) {
            const original = await (0, cashMutationReceipt_1.readCashCreationMutation)(db, tx, companyId, operationId, existing, row => {
                const { id: _id, docNo: _docNo, issueOperationId: _operation, issuePayloadHash: _hash, issuePrefix: _prefix, createdAt: _createdAt, issuedAt: _issuedAt, createdBy: _createdBy } = row, semantic = __rest(row, ["id", "docNo", "issueOperationId", "issuePayloadHash", "issuePrefix", "createdAt", "issuedAt", "createdBy"]);
                return row.companyId === companyId && row[field] === tradeDate && row.issueOperationId === operationId
                    && row.issuePrefix === effectivePrefix && row.issuePayloadHash === issuePayloadHash && typeof row.docNo === 'string'
                    && (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(semantic))).digest('hex') === issuePayloadHash;
            });
            if (original)
                return { id: operationId, docNo: original.docNo };
        }
        if (kind === 'issuedStatements') {
            const deleted = await (0, deleteIssuedStatementCommand_1.readStatementDeletion)(db, tx, companyId, operationId, existing, row => row[field] === tradeDate && row.issueOperationId === operationId && row.issuePrefix === effectivePrefix
                && row.issuePayloadHash === issuePayloadHash && typeof row.docNo === 'string' && !!row.docNo);
            if (deleted)
                return { id: operationId, docNo: deleted.docNo };
        }
        if (existing.exists) {
            const data = existing.data();
            if (data.companyId !== companyId || data[field] !== tradeDate || data.issueOperationId !== operationId || data.issuePrefix !== effectivePrefix || data.issuePayloadHash !== issuePayloadHash || typeof data.docNo !== 'string') {
                throw new https_1.HttpsError('already-exists', '작업 ID가 다른 전표에 사용되었습니다.');
            }
            return { id: operationId, docNo: data.docNo };
        }
        const state = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, sequence, releaseSnap, companyId, tradeDate, effectivePrefix);
        if (state.companyId !== companyId || state.tradeDate !== tradeDate || state.prefix !== effectivePrefix || !Number.isSafeInteger(state.last) || state.last < 0) {
            throw new https_1.HttpsError('failed-precondition', '전표 번호 카운터가 손상되었습니다.');
        }
        const next = state.last + 1;
        if (!Number.isSafeInteger(next))
            throw new https_1.HttpsError('resource-exhausted', '전표 번호 범위를 초과했습니다.');
        const docNo = (0, voucherNumber_1.formatVoucherNo)(tradeDate, next, effectivePrefix);
        (0, newScopeCounter_1.writeVoucherCounter)(tx, sequence, state, next);
        tx.create(target, Object.assign(Object.assign({}, payload), { docNo, issueOperationId: operationId, issuePrefix: effectivePrefix, issuePayloadHash }));
        return { id: operationId, docNo };
    });
}
exports.issueNumberedVoucher = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b;
    const companyId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.companyId;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test((_b = request.data) === null || _b === void 0 ? void 0 : _b.releaseId))
        throw new https_1.HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
    return issueVoucher(admin.firestore(), companyId, request.data);
});
//# sourceMappingURL=voucherIssue.js.map