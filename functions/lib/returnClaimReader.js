"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectClaimsAfterReturns = projectClaimsAfterReturns;
exports.readClaimsAfterReturns = readClaimsAfterReturns;
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const returnClaimProjection_1 = require("./shared/returnClaimProjection");
function projectClaimsAfterReturns(claims, applications, statements, operations) {
    const ids = new Set(claims.map(row => row.id));
    if (applications.every(row => ids.has(row.statementId)))
        return (0, partnerPaymentPlan_1.claimsAfterReturns)(claims, applications);
    try {
        return [...(0, partnerPaymentPlan_1.claimsAfterReturns)(claims, applications.filter(row => ids.has(row.statementId))),
            ...(0, returnClaimProjection_1.deletedReturnCredits)(claims, applications, statements, operations)];
    }
    catch (error) {
        if (error instanceof returnClaimProjection_1.ReturnClaimProjectionError)
            throw new partnerPaymentPlan_1.PartnerPaymentValidationError(error.message);
        throw error;
    }
}
/** Reads protected RETURN proofs in the same transaction; never changes stored history. */
async function readClaimsAfterReturns(db, tx, claims, applications, statements) {
    const ids = new Set(claims.map(row => row.id));
    const missing = applications.filter(row => !ids.has(row.statementId));
    if (!missing.length)
        return (0, partnerPaymentPlan_1.claimsAfterReturns)(claims, applications);
    const operationIds = [...new Set(missing.map(row => row.operationId))];
    if (operationIds.some(id => typeof id !== 'string' || !id))
        throw new partnerPaymentPlan_1.PartnerPaymentValidationError('반품 작업 증거가 없습니다.');
    const operations = await Promise.all(operationIds.map(async (id) => { const snap = await tx.get(db.collection('returnOperations').doc(id)); return Object.assign(Object.assign({}, snap.data()), { id: snap.id }); }));
    return projectClaimsAfterReturns(claims, applications, statements, operations);
}
//# sourceMappingURL=returnClaimReader.js.map