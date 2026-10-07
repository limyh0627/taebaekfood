import { describe, expect, it } from 'vitest';
import { planReturnAllocation, type ReturnAllocationInput } from './returnAllocationPlan';

const base: ReturnAllocationInput = {
  returnId: 'r1', companyId: 'c', partnerId: 'p', direction: '입금', amount: 90,
  claims: [
    { id: 'b', companyId: 'c', partnerId: 'p', direction: '입금', tradeDate: '2026-10-01', amount: 100, cashApplied: 30 },
    { id: 'a', companyId: 'c', partnerId: 'p', direction: '입금', tradeDate: '2026-10-01', amount: 50, cashApplied: 0 },
  ], priorAllocations: [{ returnId: 'old', statementId: 'a', amount: 20 }],
};

describe('noncash return allocation', () => {
  it('uses date and ID FIFO, subtracting cash and prior returns without creating settlements', () => {
    expect(planReturnAllocation(base)).toEqual({
      allocations: [{ statementId: 'a', amount: 30 }, { statementId: 'b', amount: 60 }],
      unappliedAmount: 0,
    });
  });

  it('uses an explicit source first, then other open claims in FIFO order', () => {
    expect(planReturnAllocation({ ...base, linkedStatementId: 'b', amount: 90 })).toEqual({
      allocations: [{ statementId: 'b', amount: 70 }, { statementId: 'a', amount: 20 }], unappliedAmount: 0,
    });
    expect(planReturnAllocation({ ...base, linkedStatementId: 'b', amount: 120 })).toEqual({
      allocations: [{ statementId: 'b', amount: 70 }, { statementId: 'a', amount: 30 }], unappliedAmount: 20,
    });
  });

  it('rejects scope, malformed amounts, overspent snapshots, and ambiguous same-ID retries', () => {
    for (const bad of [
      { claims: [{ ...base.claims[0], companyId: 'other' }] },
      { claims: [{ ...base.claims[0], direction: '출금' }] },
      { claims: [{ ...base.claims[0], cashApplied: 101 }] },
      { priorAllocations: [{ returnId: 'old', statementId: 'a', amount: 51 }] },
      { linkedStatementId: 'missing' },
    ]) expect(() => planReturnAllocation({ ...base, ...bad } as ReturnAllocationInput)).toThrow();
    const priorAllocations = [...base.priorAllocations, { returnId: 'r1', statementId: 'b', amount: 60 }];
    expect(() => planReturnAllocation({ ...base, priorAllocations })).toThrow('operation ledger');
    expect(() => planReturnAllocation({ ...base, amount: 100, priorAllocations })).toThrow('operation ledger');
  });
});
