import { claimsAfterReturns, openClaimBalances, type Claim, type PaymentCash,
  type PaymentSettlement, type ReturnApplication } from './partnerPaymentPlan';

/** Read-only diagnosis, never an authorization token. The command must re-read and validate the complete history. */
export function auditReturnPartner(input: { companyId: string; partnerId: string; claims: Claim[];
  cashEntries: PaymentCash[]; settlements: PaymentSettlement[]; applications: ReturnApplication[] }) {
  const claims = input.claims.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId);
  const cash = input.cashEntries.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId);
  const applications = input.applications.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId);
  const claimById = new Map(claims.map(row => [row.id, row]));
  const cashById = new Map(cash.map(row => [row.id, row]));
  const issues: { kind: string; id: string }[] = [];
  for (const claim of claims) {
    if (!Number.isSafeInteger(claim.amount)) issues.push({ kind: 'negativeOrInvalidClaim', id: claim.id });
    const pinned = input.settlements.filter(row => row.statementId === claim.id).reduce((sum, row) => sum + row.amount, 0);
    const returned = applications.filter(row => row.statementId === claim.id).reduce((sum, row) => sum + row.amount, 0);
    if (!Number.isSafeInteger(pinned) || pinned < 0 || claim.amount < 0 && (pinned !== 0 || returned !== 0)
      || claim.amount >= 0 && pinned + returned > claim.amount)
      issues.push({ kind: 'settlementAndReturnExceedClaim', id: claim.id });
  }
  for (const row of input.settlements) {
    const claim = claimById.get(row.statementId), entry = cashById.get(row.cashEntryId);
    if (!claim && !entry) continue;
    if (!claim || !entry) { issues.push({ kind: 'orphanSettlement', id: row.id }); continue; }
    const payable = claim.accountCode === '251' || claim.accountCode === '253';
    const eligible = entry.parts.filter(part => payable
      ? part.accountCode === '251' || part.accountCode === '253' : part.accountCode === '108')
      .reduce((sum, part) => sum + part.reduce, 0);
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !Number.isSafeInteger(eligible) || row.amount > eligible)
      issues.push({ kind: 'settlementDirectionOrAccountMismatch', id: row.id });
  }
  const directions = (['입금', '출금'] as const).map(direction => {
    try {
      const reduced = claimsAfterReturns(claims, applications);
      const open = openClaimBalances({ companyId: input.companyId, partnerId: input.partnerId, direction,
        claims: reduced, cashEntries: cash, settlements: input.settlements });
      return { direction, ready: issues.length === 0, balances: Object.fromEntries(open), error: null };
    } catch (error) {
      return { direction, ready: false, balances: {}, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { companyId: input.companyId, partnerId: input.partnerId, ready: directions.every(row => row.ready), issues, directions };
}
