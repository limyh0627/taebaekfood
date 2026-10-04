import { describe, expect, it } from 'vitest';
import type { Partner } from './types';
import { openingPartnerStatement } from './openingPartnerBalance';
import { journalizeTransfer } from './autoJournal';
import { allocatePartnerCash, partnerBalanceFromJournals } from '../features/admin/cashLedger';

const partner = { id: 'p1', name: '기초 거래처', companyId: 'punghoe' } as Partner;

describe('신규 회사 거래처별 기초 전표', () => {
  it.each([['108', '매출', 700_000], ['251', '매입', 500_000]] as const)(
    '%s 잔액은 차대 일치하고 거래처원장·미결전표에 한 번만 반영된다', (code, type, amount) => {
      const voucher = openingPartnerStatement('punghoe', '2026-07-31', partner, code, amount);
      const journal = journalizeTransfer(voucher)!;
      expect(voucher.id).toBe(`opening-partner-punghoe-2026-07-31-p1-${code}`);
      expect(voucher.type).toBe('비용');
      expect(journal.lines.reduce((n, l) => n + l.debit, 0)).toBe(amount);
      expect(journal.lines.reduce((n, l) => n + l.credit, 0)).toBe(amount);
      expect(partnerBalanceFromJournals(partner.id, type, [journal])).toBe(amount);
      expect(allocatePartnerCash(partner.id, type, [voucher], [])).toEqual(new Map([[voucher.id, amount]]));
      expect(voucher.type).not.toBe('매출');
      expect(voucher.type).not.toBe('매입');
    },
  );
  it('다른 회사 거래처와 잘못된 금액은 거절한다', () => {
    expect(() => openingPartnerStatement('taebaek', '2026-07-31', partner, '108', 100)).toThrow('다른 회사');
    expect(() => openingPartnerStatement('punghoe', '2026-07-31', partner, '108', 0)).toThrow();
  });
});
