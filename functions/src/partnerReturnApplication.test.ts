import { describe, expect, it } from 'vitest';
import { claimsAfterReturns, planPartnerPayment } from './partnerPaymentPlan';

const claim = { id: 'sale', companyId: 'taebaek', partnerId: 'customer', tradeDate: '2026-10-01',
  amount: 100, accountCode: '108' as const };
const application = { id: 'return-op', companyId: 'taebaek', partnerId: 'customer', statementId: 'sale', amount: 40 };

describe('noncash return application in payment planner', () => {
  it('offsets an unlinked negative return before taking more payment', () => {
    const claims = [claim, { ...claim, id: 'return', tradeDate: '2026-10-02', amount: -40 }];
    expect(planPartnerPayment({ companyId: 'taebaek', partnerId: 'customer', direction: '입금',
      amount: 70, pin: false, allocations: [], claims, cashEntries: [], settlements: [] }))
      .toMatchObject({ lines: [{ accountCode: '108', amount: 60 }, { accountCode: '254', amount: 10 }] });
  });
  it('reduces only the linked claim and leaves future payment FIFO at the net amount', () => {
    const claims = claimsAfterReturns([claim], [application]);
    expect(claims).toEqual([{ ...claim, amount: 60 }]);
    expect(planPartnerPayment({ companyId: 'taebaek', partnerId: 'customer', direction: '입금',
      amount: 70, pin: false, allocations: [], claims, cashEntries: [], settlements: [] }))
      .toMatchObject({ lines: [{ accountCode: '108', amount: 60 }, { accountCode: '254', amount: 10 }] });
  });

  it('rejects foreign, orphan, and excessive applications', () => {
    for (const row of [{ ...application, companyId: 'punghoe' },
      { ...application, partnerId: 'other' }, { ...application, statementId: 'missing' },
      { ...application, amount: 101 }])
      expect(() => claimsAfterReturns([claim], [row])).toThrow('반품 역적용');
  });
});
