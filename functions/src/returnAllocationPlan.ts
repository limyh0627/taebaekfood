/** Pure noncash allocation. The caller must read claims and prior applications in one transaction. */
export type ReturnClaim = {
  id: string; companyId: string; partnerId: string; direction: '입금' | '출금';
  tradeDate: string; amount: number; cashApplied: number;
};
export type PriorReturnAllocation = {
  returnId: string; statementId: string; amount: number;
};
export type ReturnAllocationInput = {
  returnId: string; companyId: string; partnerId: string; direction: '입금' | '출금';
  amount: number; linkedStatementId?: string; claims: ReturnClaim[];
  priorAllocations: PriorReturnAllocation[];
};

const money = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function planReturnAllocation(input: ReturnAllocationInput) {
  if (!input.returnId || !input.companyId || !input.partnerId || !money(input.amount) || !input.amount
    || !['입금', '출금'].includes(input.direction) || !Array.isArray(input.claims)
    || !Array.isArray(input.priorAllocations)) throw new Error('반품 배분 입력이 잘못되었습니다.');
  const byId = new Map<string, ReturnClaim>();
  const open = new Map<string, number>();
  for (const claim of input.claims) {
    if (!claim.id || byId.has(claim.id) || claim.companyId !== input.companyId
      || claim.partnerId !== input.partnerId || claim.direction !== input.direction
      || !/^\d{4}-\d{2}-\d{2}$/.test(claim.tradeDate) || !money(claim.amount)
      || !money(claim.cashApplied) || claim.cashApplied > claim.amount)
      throw new Error('원전표 배분 근거가 잘못되었습니다.');
    byId.set(claim.id, claim);
    open.set(claim.id, claim.amount - claim.cashApplied);
  }
  for (const row of input.priorAllocations) {
    if (!row.returnId || !byId.has(row.statementId) || !money(row.amount) || !row.amount)
      throw new Error('기존 반품 배분 근거가 잘못되었습니다.');
    const left = open.get(row.statementId)! - row.amount;
    if (left < 0) throw new Error('기존 반품 배분이 미결액을 초과합니다.');
    open.set(row.statementId, left);
    if (row.returnId === input.returnId)
      throw new Error('기존 반품 요청은 operation ledger에서 확인해야 합니다.');
  }
  const sorted = [...byId.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
  const linked = input.linkedStatementId ? byId.get(input.linkedStatementId) : undefined;
  if (input.linkedStatementId && !linked) throw new Error('지정 원전표를 찾을 수 없습니다.');
  const claims = linked ? [linked, ...sorted.filter(claim => claim.id !== linked.id)] : sorted;
  const allocations: { statementId: string; amount: number }[] = [];
  let remaining = input.amount;
  for (const claim of claims) {
    const amount = Math.min(remaining, open.get(claim.id)!);
    if (amount) allocations.push({ statementId: claim.id, amount });
    remaining -= amount;
    if (!remaining) break;
  }
  return { allocations, unappliedAmount: remaining };
}
