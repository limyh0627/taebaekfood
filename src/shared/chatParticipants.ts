import type { CompanyId, Employee } from './types';
import { companyOf } from './types';

/**
 * 방 참여자 ID와 회사 스냅샷을 한 벌로 만든다. 규칙은 이 두 목록이 정확히 같고 모든 값이
 * 방 회사인지 검사한다. 화면 목록이 잘못 섞여도 다른 회사 직원이 저장되기 전에 멈춘다.
 */
export function participantCompaniesOf(
  participantIds: readonly string[],
  employees: readonly Employee[],
  roomCompanyId: CompanyId,
): Record<string, CompanyId> {
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const result: Record<string, CompanyId> = {};
  for (const id of [...new Set(participantIds)]) {
    const employee = employeeById.get(id);
    if (!employee) throw new Error(`오피스톡 참여 직원을 찾을 수 없습니다: ${id}`);
    const employeeCompanyId = companyOf(employee);
    if (employeeCompanyId !== roomCompanyId) throw new Error(`다른 회사 직원은 오피스톡 방에 추가할 수 없습니다: ${employee.name}`);
    result[id] = employeeCompanyId;
  }
  return result;
}
