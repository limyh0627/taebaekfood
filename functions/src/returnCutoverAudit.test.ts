import { expect, it } from 'vitest';
import { auditReturnPartner } from './returnCutoverAudit';
import type { Claim } from './partnerPaymentPlan';
const claim: Claim = { id: 'source', companyId: 'taebaek', partnerId: 'p', accountCode: '253', amount: 100, tradeDate: '2026-08-01' };
const base = { companyId: 'taebaek', partnerId: 'p', claims: [claim], cashEntries: [], settlements: [], applications: [] };
it('keeps healthy partner independent from unrelated legacy defects', () => {
  const input = { ...base, claims: [claim, { ...claim, id: 'other', partnerId: 'other', amount: -100 }] };
  expect(auditReturnPartner(input).ready).toBe(true);
  expect(auditReturnPartner(input).directions[1].balances).toEqual({ source: 100 });
});
it('accepts historical 251 settlement of a 253 payable but not a 108 receivable', () => {
  const input = { ...base, cashEntries: [{ id: 'cash', companyId: 'taebaek', partnerId: 'p', parts: [{ accountCode: '251', reduce: 100 }] }],
    settlements: [{ id: 'settle', statementId: 'source', cashEntryId: 'cash', amount: 100 }] };
  const before = JSON.stringify(input), audit = auditReturnPartner(input);
  expect(audit.ready).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  const wrong = auditReturnPartner({ ...input, claims: [{ ...claim, accountCode: '108' }] });
  expect(wrong.issues).toContainEqual({ kind: 'settlementDirectionOrAccountMismatch', id: 'settle' });
});
it('treats a negative return as partner credit without marking the other direction invalid', () => {
  const audit = auditReturnPartner({ ...base, claims: [claim, { ...claim, id: 'sale', accountCode: '108', amount: 100 },
    { ...claim, id: 'return', accountCode: '108', amount: -10 }] });
  expect(audit.ready).toBe(true);
  expect(audit.directions[0].balances).toEqual({ sale: 90 });
  expect(audit.directions[1].balances).toEqual({ source: 100 });
});
it('validates aggregate cash limits even when individual settlements fit', () => {
  const audit = auditReturnPartner({ ...base, claims: [claim, { ...claim, id: 'second' }],
    cashEntries: [{ id: 'cash', companyId: 'taebaek', partnerId: 'p', parts: [{ accountCode: '253', reduce: 100 }] }],
    settlements: [{ id: 'one', statementId: 'source', cashEntryId: 'cash', amount: 60 }, { id: 'two', statementId: 'second', cashEntryId: 'cash', amount: 60 }] });
  expect(audit.ready).toBe(false);
  expect(audit.directions.every(row => row.error)).toBe(true);
});
it('does not drop orphan settlements or prior return over-allocation', () => {
  expect(auditReturnPartner({ ...base, settlements: [{ id: 'orphan', statementId: 'source', cashEntryId: 'missing', amount: 1 }] }).ready).toBe(false);
  expect(auditReturnPartner({ ...base, applications: [{ id: 'old', companyId: 'taebaek', partnerId: 'p', statementId: 'source', amount: 101 }] }).ready).toBe(false);
});
