import { canEnterAdmin } from './adminAccess';
import { companyOf, TAEBAEK, type CompanyId, type Employee } from './types';

/** 저장소의 임의 문자열을 회사 키로 바로 쓰면 화면에서 회사를 못 찾고 죽는다. */
export function normalizeCompanyId(value: string | null | undefined): CompanyId {
  return value === 'punghoe' ? 'punghoe' : TAEBAEK;
}

/** 일반 직원은 소속 회사로만, 관리자 권한 계정은 어느 회사로든 로그인한다. */
export function canLoginToCompany(employee: Employee, companyId: CompanyId): boolean {
  return canEnterAdmin(employee) || companyOf(employee) === companyId;
}

export function findCompanyLogin(
  employees: readonly Employee[], username: string, password: string, companyId: CompanyId,
): Employee | undefined {
  return employees.find(employee => employee.username === username
    && employee.password === password
    && canLoginToCompany(employee, companyId));
}
