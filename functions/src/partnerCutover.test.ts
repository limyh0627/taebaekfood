import { describe, expect, it } from 'vitest';
import { partnerQuarantined } from './partnerCutover';

describe('거래처별 운영 전환 예외', () => {
  it('감사 예외 목록의 거래처와 잘못된 예외 설정은 차단한다', () => {
    const gate = { auditScope: 'unblocked-partners', blockedPartnerIds: ['legacy-bad'] };
    expect(partnerQuarantined(gate, 'legacy-bad')).toBe(true);
    expect(partnerQuarantined(gate, 'audited-good')).toBe(false);
    expect(partnerQuarantined({ auditScope: 'unblocked-partners' }, 'audited-good')).toBe(true);
  });
});
