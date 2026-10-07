/** A cutover may proceed for audited partners while known legacy exceptions stay quarantined. */
export function partnerQuarantined(gate: Record<string, unknown> | undefined, partnerId: string): boolean {
  if (gate?.auditScope !== 'unblocked-partners') return false;
  const blocked = gate.blockedPartnerIds;
  return !Array.isArray(blocked) || blocked.some(id => typeof id !== 'string') || blocked.includes(partnerId);
}
