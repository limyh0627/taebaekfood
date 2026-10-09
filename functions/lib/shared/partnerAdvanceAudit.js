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
exports.advanceStatementBusiness = advanceStatementBusiness;
exports.assertAdvanceOperationProof = assertAdvanceOperationProof;
function advanceStatementBusiness(row) {
    const { docNo, id, issuedAt, createdBy, issueOperationId, issuePayloadHash, issueStatementHash, issueVoucherNo, issuePrefix } = row, business = __rest(row, ["docNo", "id", "issuedAt", "createdBy", "issueOperationId", "issuePayloadHash", "issueStatementHash", "issueVoucherNo", "issuePrefix"]);
    return business;
}
function assertAdvanceOperationProof(statement, operation, hashes) {
    var _a, _b;
    const meta = statement.noncashApplication;
    if (!meta || operation.status !== 'applied' || !['apply', 'cancel'].includes(String(operation.action))
        || operation.companyId !== statement.companyId || operation.partnerId !== statement.partnerId
        || operation.createdBy !== statement.createdBy || operation.statementId !== statement.id
        || operation.id !== meta.operationId || statement.issueOperationId !== operation.id
        || operation.commandHash !== hashes.commandHash
        || operation.requestHash !== hashes.requestHash
        || operation.requestHash !== statement.issuePayloadHash || operation.statementHash !== statement.issueStatementHash
        || operation.statementHash !== hashes.statementHash || operation.docNo !== statement.docNo
        || operation.issuePrefix !== '대체' || statement.issuePrefix !== '대체'
        || (meta.kind === 'advance-application' ? operation.action !== 'apply' : operation.action !== 'cancel'))
        throw new Error('선급·선수 적용 원문과 변경 감사가 다릅니다.');
    const command = operation.command;
    if (command.operationId !== operation.id || command.partnerId !== operation.partnerId || command.date !== statement.tradeDate
        || !Number.isSafeInteger(operation.amount) || operation.amount <= 0 || operation.amount !== statement.totalAmount)
        throw new Error('적용 선택 요청과 저장 금액·날짜가 다릅니다.');
    if (meta.kind === 'advance-application') {
        const allocations = meta.allocations;
        const allocation = allocations === null || allocations === void 0 ? void 0 : allocations[0];
        const sourceId = (source) => JSON.stringify([source === null || source === void 0 ? void 0 : source.collection, source === null || source === void 0 ? void 0 : source.id, source === null || source === void 0 ? void 0 : source.lineKey]);
        if (allocations.length !== 1 || !allocation || sourceId(operation.source) !== sourceId(allocation.source)
            || sourceId(command.source) !== sourceId(allocation.source) || operation.targetStatementId !== allocation.statementId
            || command.statementId !== allocation.statementId || command.amount !== allocation.amount || operation.amount !== allocation.amount
            || command.accountCode !== allocation.accountCode || command.expectedSourceFingerprint !== ((_a = meta.sourceFingerprints) === null || _a === void 0 ? void 0 : _a[sourceId(allocation.source)])
            || command.expectedTargetFingerprint !== ((_b = meta.targetFingerprints) === null || _b === void 0 ? void 0 : _b[allocation.statementId])
            || meta.purpose !== JSON.stringify([sourceId(allocation.source), allocation.statementId]))
            throw new Error('선택한 원천·대상과 적용 감사가 다릅니다.');
    }
    else if (command.applicationStatementId !== meta.applicationStatementId || operation.applicationStatementId !== meta.applicationStatementId || typeof command.reason !== 'string' || command.reason.trim() !== meta.reason)
        throw new Error('취소 요청과 원 적용 연결이 다릅니다.');
}
//# sourceMappingURL=partnerAdvanceAudit.js.map