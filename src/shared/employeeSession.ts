import type { Employee } from './types';

/** 브라우저 저장소에는 화면 복원에 필요한 최소 정보만 둔다. 비밀번호·연락처·푸시표는 DB에서 다시 읽는다. */
export function employeeSession(employee: Employee): Employee {
  return {
    id: employee.id,
    companyId: employee.companyId,
    name: employee.name,
    username: employee.username,
    position: employee.position,
    department: employee.department,
    joinDate: '',
    status: employee.status,
    phone: '',
    adminAccess: employee.adminAccess,
  };
}

export function readEmployeeSession(raw: string | null): Employee | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Employee;
    return parsed?.id && parsed?.name ? employeeSession(parsed) : null;
  } catch {
    return null;
  }
}

/** 로그인 뒤 메모리에서는 최신 직원정보를 쓰되 평문 비밀번호만 제거한다. */
export function employeeRuntime(employee: Employee): Employee {
  const { password: _legacyPassword, ...safe } = employee as Employee & { password?: unknown };
  return safe;
}
