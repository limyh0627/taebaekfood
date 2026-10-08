"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partnerQuarantined = partnerQuarantined;
/** A cutover may proceed for audited partners while known legacy exceptions stay quarantined. */
function partnerQuarantined(gate, partnerId) {
    if ((gate === null || gate === void 0 ? void 0 : gate.auditScope) !== 'unblocked-partners')
        return false;
    const blocked = gate.blockedPartnerIds;
    return !Array.isArray(blocked) || blocked.some(id => typeof id !== 'string') || blocked.includes(partnerId);
}
//# sourceMappingURL=partnerCutover.js.map