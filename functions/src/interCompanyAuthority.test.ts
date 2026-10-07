import { describe, expect, it } from 'vitest';
import { assertInterCompanyAuthority } from './interCompanyAuthority';

describe('inactive intercompany authorization boundary', () => {
  const grant = { enabled: true, authUid: 'uid', allowedPairs: ['taebaek>punghoe'],
    revision: 1, approvedBy: 'owner', approvedAt: '2026-10-02T00:00:00Z' };
  it('rejects administrators without a server grant and ignores a token-injected allowedCompanies field', () => {
    for (const companyId of ['taebaek', 'punghoe']) {
      const claims = { employeeId: 'admin', companyId, isAdmin: true };
      expect(() => assertInterCompanyAuthority(claims, 'taebaek', 'punghoe', undefined, 'uid')).toThrow('양사 관리자');
      expect(() => assertInterCompanyAuthority({ ...claims, allowedCompanies: ['taebaek', 'punghoe'] },
        'taebaek', 'punghoe', undefined, 'uid')).toThrow('양사 관리자');
    }
  });

  it('rejects staff and same-company transfers before any writer is available', () => {
    expect(() => assertInterCompanyAuthority({ employeeId: 'staff', companyId: 'taebaek', isAdmin: false },
      'taebaek', 'punghoe', grant, 'uid')).toThrow('양사 관리자');
    expect(() => assertInterCompanyAuthority({ employeeId: 'admin', companyId: 'taebaek', isAdmin: true },
      'taebaek', 'taebaek', grant, 'uid')).toThrow('서로 다른');
  });

  it('requires the exact UID and transfer direction and rejects a revoked grant', () => {
    const claims = { employeeId: 'admin', companyId: 'taebaek', isAdmin: true };
    expect(assertInterCompanyAuthority(claims, 'taebaek', 'punghoe', grant, 'uid')).toBe(1);
    expect(() => assertInterCompanyAuthority(claims, 'taebaek', 'punghoe', grant, 'other')).toThrow('양사 관리자');
    expect(() => assertInterCompanyAuthority(claims, 'punghoe', 'taebaek', grant, 'uid')).toThrow('양사 관리자');
    expect(() => assertInterCompanyAuthority(claims, 'taebaek', 'punghoe', { ...grant, enabled: false }, 'uid'))
      .toThrow('양사 관리자');
  });
});
