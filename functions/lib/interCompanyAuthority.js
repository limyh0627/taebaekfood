"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertInterCompanyAuthority = assertInterCompanyAuthority;
/** A server-owned grant augments, but never replaces, the user's home-company claim. */
function assertInterCompanyAuthority(claims, from, to, grant, authUid) {
    if (from === to || !['taebaek', 'punghoe'].includes(from) || !['taebaek', 'punghoe'].includes(to))
        throw new Error('서로 다른 두 회사가 필요합니다.');
    if (typeof claims.employeeId !== 'string' || claims.isAdmin !== true
        || claims.companyId !== from || !authUid || (grant === null || grant === void 0 ? void 0 : grant.enabled) !== true
        || grant.authUid !== authUid || !Array.isArray(grant.allowedPairs)
        || !grant.allowedPairs.includes(`${from}>${to}`)
        || !Number.isSafeInteger(grant.revision) || Number(grant.revision) < 1
        || typeof grant.approvedBy !== 'string' || !grant.approvedBy
        || typeof grant.approvedAt !== 'string' || !grant.approvedAt)
        throw new Error('양사 관리자 권한을 증명할 수 없습니다.');
    return Number(grant.revision);
}
//# sourceMappingURL=interCompanyAuthority.js.map