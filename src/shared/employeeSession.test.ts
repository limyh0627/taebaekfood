import { describe, expect, it } from 'vitest';
import type { Employee } from './types';
import { employeeRuntime, employeeSession, readEmployeeSession } from './employeeSession';

const employee = {
  id: 'e1', name: '직원', username: 'worker', password: 'plain-secret', position: '사원',
  department: '생산', joinDate: '2026-01-01', status: 'working', phone: '010-1234-5678',
  birthDate: '1990-01-01', fcmTokens: ['secret-token'], image: '',
} as Employee & { password: string };

describe('브라우저 직원 세션', () => {
  it('비밀번호·연락처·푸시표를 저장하지 않는다', () => {
    const saved = employeeSession(employee);
    expect(saved).toMatchObject({ id: 'e1', name: '직원', username: 'worker' });
    expect('password' in saved).toBe(false);
    expect(saved.phone).toBe('');
    expect(saved.birthDate).toBeUndefined();
    expect(saved.fcmTokens).toBeUndefined();
  });

  it('옛 localStorage 사본도 읽을 때 민감값을 제거한다', () => {
    expect('password' in readEmployeeSession(JSON.stringify(employee))!).toBe(false);
    expect(readEmployeeSession('{broken')).toBeNull();
  });

  it('로그인 뒤 메모리의 최신 직원정보에서도 비밀번호를 제거한다', () => {
    const runtime = employeeRuntime(employee);
    expect('password' in runtime).toBe(false);
    expect(runtime.fcmTokens).toEqual(['secret-token']);
  });
});
