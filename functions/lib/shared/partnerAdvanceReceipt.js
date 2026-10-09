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
exports.semanticHash = void 0;
exports.paymentBusiness = paymentBusiness;
exports.statementBusiness = statementBusiness;
exports.assertOriginReceipt = assertOriginReceipt;
exports.genericVoucherBusiness = genericVoucherBusiness;
exports.assertGenericCashOrigin = assertGenericCashOrigin;
exports.assertAdvanceOperation = assertAdvanceOperation;
const partnerAdvanceAudit_1 = require("./partnerAdvanceAudit");
const node_crypto_1 = require("node:crypto");
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const semanticHash = (row) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(canonical(row))).digest('hex');
exports.semanticHash = semanticHash;
// 제품 partnerPaymentCommand의 entryHash 대상과 같은 명시 사업 필드다.
function paymentBusiness(row) {
    var _a;
    return Object.assign({ companyId: row.companyId, partnerId: row.partnerId, date: row.date, cashAccountId: row.cashAccountId, dir: row.dir, amount: row.amount, lines: row.lines, note: (_a = row.note) !== null && _a !== void 0 ? _a : '' }, (row.advanceOrigin === undefined ? {} : { advanceOrigin: row.advanceOrigin }));
}
// 제품 tradeStatementIssue.statementBusiness와 같은 제외 필드다.
function statementBusiness(row) {
    const { docNo, id, issuedAt, createdBy, issueOperationId, issuePayloadHash, issueStatementHash, issueVoucherNo, issuePrefix } = row, business = __rest(row, ["docNo", "id", "issuedAt", "createdBy", "issueOperationId", "issuePayloadHash", "issueStatementHash", "issueVoucherNo", "issuePrefix"]);
    return business;
}
/** 저장 원문과 기존 발행 감사의 사업 해시를 연결한다. 잔량 증명은 별도 reader 책임이다. */
function assertOriginReceipt(kind, row, receipt, expected) {
    var _a, _b;
    if (row.companyId !== expected.companyId || row.partnerId !== expected.partnerId
        || row.issueOperationId !== expected.operationId || row.createdBy !== expected.actorId)
        throw new Error('원본 발행 회사·거래처·작성자가 다릅니다.');
    if (kind === 'payment') {
        // 현재 applied 감사에는 status가 생략된다. rejected는 원천이 아니다.
        if (receipt.companyId !== expected.companyId || receipt.partnerId !== expected.partnerId
            || receipt.createdBy !== expected.actorId || ![undefined, 'applied'].includes(receipt.status) || receipt.cashEntryId !== row.id
            || typeof row.issuePayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.issuePayloadHash)
            || typeof row.docNo !== 'string' || !row.docNo || receipt.docNo !== row.docNo
            || ((_a = receipt.issuePrefix) !== null && _a !== void 0 ? _a : '') !== ((_b = row.issuePrefix) !== null && _b !== void 0 ? _b : '')
            || receipt.requestHash !== row.issuePayloadHash || receipt.entryHash !== (0, exports.semanticHash)(paymentBusiness(row)))
            throw new Error('원본 지급 감사와 사업 해시가 다릅니다.');
    }
    else {
        // 거래 발행은 별도 operation 문서 대신 전표에 저장한 사업 해시가 증거다.
        if (row.issueStatementHash !== (0, exports.semanticHash)(statementBusiness(row)))
            throw new Error('원본 전표 사업 해시가 다릅니다.');
    }
}
/** Exact generic voucherIssue business hash. No payment receipt fallback when one exists. */
function genericVoucherBusiness(row) {
    const { id, docNo, issueOperationId, issuePayloadHash, issuePrefix, createdAt, issuedAt, createdBy } = row, business = __rest(row, ["id", "docNo", "issueOperationId", "issuePayloadHash", "issuePrefix", "createdAt", "issuedAt", "createdBy"]);
    return business;
}
function assertGenericCashOrigin(row, expected) {
    if (row.companyId !== expected.companyId || row.partnerId !== expected.partnerId || row.id !== expected.id
        || row.issueOperationId !== expected.id || typeof row.docNo !== 'string' || !row.docNo
        || typeof row.createdBy !== 'string' || !row.createdBy || typeof row.issuePrefix !== 'string'
        || typeof row.issuePayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.issuePayloadHash)
        || row.issuePayloadHash !== (0, exports.semanticHash)(genericVoucherBusiness(row)))
        throw new Error('원본 자금전표의 발행 증거가 다릅니다.');
}
function assertAdvanceOperation(statement, operation) {
    (0, partnerAdvanceAudit_1.assertAdvanceOperationProof)(statement, operation, { commandHash: (0, exports.semanticHash)(operation.command), requestHash: (0, exports.semanticHash)({ companyId: operation.companyId, actorId: operation.createdBy, action: operation.action, command: operation.command }), statementHash: (0, exports.semanticHash)(statementBusiness(statement)) });
}
//# sourceMappingURL=partnerAdvanceReceipt.js.map