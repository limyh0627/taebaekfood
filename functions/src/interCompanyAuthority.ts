/** A server-owned grant augments, but never replaces, the user's home-company claim. */
export function assertInterCompanyAuthority(
  claims: { employeeId?: unknown; companyId?: unknown; isAdmin?: unknown; allowedCompanies?: unknown },
  from: string,
  to: string,
  grant?: { enabled?: unknown; authUid?: unknown; allowedPairs?: unknown; revision?: unknown;
    approvedBy?: unknown; approvedAt?: unknown },
  authUid?: string,
): number {
  if (from === to || !['taebaek', 'punghoe'].includes(from) || !['taebaek', 'punghoe'].includes(to))
    throw new Error('서로 다른 두 회사가 필요합니다.');
  if (typeof claims.employeeId !== 'string' || claims.isAdmin !== true
    || claims.companyId !== from || !authUid || grant?.enabled !== true
    || grant.authUid !== authUid || !Array.isArray(grant.allowedPairs)
    || !grant.allowedPairs.includes(`${from}>${to}`)
    || !Number.isSafeInteger(grant.revision) || Number(grant.revision) < 1
    || typeof grant.approvedBy !== 'string' || !grant.approvedBy
    || typeof grant.approvedAt !== 'string' || !grant.approvedAt)
    throw new Error('양사 관리자 권한을 증명할 수 없습니다.');
  return Number(grant.revision);
}
