import { describe, expect, it } from 'vitest';
import type { Employee } from './types';
import { canLoginToCompany, findCompanyLogin, normalizeCompanyId } from './loginCompanyAccess';

const employee = (data: Partial<Employee>): Employee => ({
  id: 'e1', name: '직원', phone: '', department: '', position: '', joinDate: '', status: 'working',
  annualLeave: { carryOverLeave: 0, bonusLeave: 0 }, ...data,
});

describe('회사별 로그인', () => {
  it('저장된 회사 값이 없거나 깨졌으면 태백으로 복구한다', () => {
    expect(normalizeCompanyId(null)).toBe('taebaek');
    expect(normalizeCompanyId('unknown')).toBe('taebaek');
    expect(normalizeCompanyId('punghoe')).toBe('punghoe');
  });

  it('일반 직원은 자기 회사에만 로그인한다', () => {
    const user = employee({ companyId: 'punghoe', username: 'p1', password: 'pw' });
    expect(canLoginToCompany(user, 'punghoe')).toBe(true);
    expect(canLoginToCompany(user, 'taebaek')).toBe(false);
  });

  it('관리자 권한 계정은 같은 자격으로 두 회사에 로그인한다', () => {
    const admin = employee({ adminAccess: true, username: 'boss', password: 'pw' });
    expect(findCompanyLogin([admin], 'boss', 'pw', 'taebaek')).toBe(admin);
    expect(findCompanyLogin([admin], 'boss', 'pw', 'punghoe')).toBe(admin);
  });
});
