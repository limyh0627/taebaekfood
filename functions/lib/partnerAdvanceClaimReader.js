"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectClaimsAfterAdvance = projectClaimsAfterAdvance;
exports.projectClaimsAfterReturnsAndAdvance = projectClaimsAfterReturnsAndAdvance;
exports.readClaimsAfterReturnsAndAdvance = readClaimsAfterReturnsAndAdvance;
const returnClaimReader_1 = require("./returnClaimReader");
const partnerAdvance_1 = require("./shared/partnerAdvance");
const partnerAdvanceReceipt_1 = require("./shared/partnerAdvanceReceipt");
const owner = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
function proof(statement, operation) {
    if (!operation || typeof operation.createdBy !== 'string' || !operation.createdBy
        || typeof operation.docNo !== 'string' || !operation.docNo)
        throw new Error('선급·선수 적용 감사와 원전표가 다릅니다.');
    (0, partnerAdvanceReceipt_1.assertAdvanceOperation)(statement, operation);
}
function projectClaimsAfterAdvance(claims, statements, operations) {
    var _a, _b, _c;
    const groups = new Set(claims.map(row => JSON.stringify([row.companyId, row.partnerId])));
    const scoped = statements.filter(row => groups.size === 0 || groups.has(JSON.stringify([owner(row), row.partnerId])));
    const tagged = scoped.filter(row => row.noncashApplication !== undefined);
    for (const row of tagged) {
        (0, partnerAdvance_1.isAdvanceStatement)(row);
        const operation = operations.find(op => op.id === row.noncashApplication.operationId);
        proof(row, operation);
        if (row.noncashApplication.kind === 'advance-cancellation') {
            const original = tagged.find(original => original.id === row.noncashApplication.applicationStatementId);
            const allocation = (_b = (_a = original === null || original === void 0 ? void 0 : original.noncashApplication) === null || _a === void 0 ? void 0 : _a.allocations) === null || _b === void 0 ? void 0 : _b[0];
            if (!allocation || (0, partnerAdvanceReceipt_1.semanticHash)((_c = operation.source) !== null && _c !== void 0 ? _c : {}) !== (0, partnerAdvanceReceipt_1.semanticHash)(allocation.source)
                || operation.targetStatementId !== allocation.statementId || operation.amount !== allocation.amount)
                throw new Error('취소 감사의 원천·대상이 다릅니다.');
        }
    }
    let result = claims.filter(claim => !tagged.some(row => row.id === claim.id));
    const partners = new Map(tagged.map(row => [JSON.stringify([owner(row), row.partnerId]), [owner(row), row.partnerId]]));
    for (const [companyId, partnerId] of partners.values()) {
        if (!['taebaek', 'punghoe'].includes(companyId))
            throw new Error('적용 회사가 다릅니다.');
        result = (0, partnerAdvance_1.claimsAfterAdvance)(result, scoped, companyId, partnerId);
    }
    return result;
}
function projectClaimsAfterReturnsAndAdvance(claims, applications, statements, returnOperations, advanceOperations) {
    const ordinary = claims.filter(claim => !statements.some(row => row.id === claim.id && row.noncashApplication !== undefined));
    return projectClaimsAfterAdvance((0, returnClaimReader_1.projectClaimsAfterReturns)(ordinary, applications, statements, returnOperations), statements, advanceOperations);
}
/** 모든 감사 조회를 첫 쓰기 전에 끝낸다. 원문 전표는 변경하지 않는다. */
async function readClaimsAfterReturnsAndAdvance(db, tx, claims, applications, statements) {
    const tagged = statements.filter(row => row.noncashApplication !== undefined);
    const operations = await Promise.all(tagged.map(async (row) => { var _a; const snap = await tx.get(db.collection('partnerAdvanceOperations').doc((_a = row.noncashApplication) === null || _a === void 0 ? void 0 : _a.operationId)); return Object.assign(Object.assign({}, snap.data()), { id: snap.id }); }));
    const ordinary = claims.filter(claim => !tagged.some(row => row.id === claim.id));
    const returned = await (0, returnClaimReader_1.readClaimsAfterReturns)(db, tx, ordinary, applications, statements);
    return projectClaimsAfterAdvance(returned, statements, operations);
}
//# sourceMappingURL=partnerAdvanceClaimReader.js.map