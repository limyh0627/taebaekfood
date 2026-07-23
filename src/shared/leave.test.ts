import { describe, it, expect } from 'vitest';
import {
  calculateRequestDays, isUnderOneYear, calculateMonthlyLeave,
  getAnnualGrantInfo, calculateAnnualLeave, calculateLeaveBalance,
} from './leave';
import type { Employee, LeaveRequest } from './types';

const NOW = new Date('2026-07-23T00:00:00');

const emp = (over: Partial<Employee>): Employee => ({
  id: 'e1', name: '홍길동', position: '사원', department: '생산팀',
  joinDate: '2025-01-01', birthDate: '', phone: '', status: 'working', ...over,
} as Employee);

const req = (over: Partial<LeaveRequest>): LeaveRequest => ({
  id: 'r1', employeeId: 'e1', employeeName: '홍길동', type: '연차',
  startDate: '2026-03-02', endDate: '2026-03-02', reason: '', status: 'approved',
  requestedAt: '', daysUsed: 1, ...over,
});

describe('calculateRequestDays', () => {
  it('평일만 센다 (주말 제외)', () => {
    expect(calculateRequestDays('2026-07-20', '2026-07-24', '연차')).toBe(5);  // 월~금
    expect(calculateRequestDays('2026-07-24', '2026-07-27', '연차')).toBe(2);  // 금,월
  });
  it('반차는 0.5, 미차감 유형은 0', () => {
    expect(calculateRequestDays('2026-07-20', '2026-07-20', '오전반차')).toBe(0.5);
    expect(calculateRequestDays('2026-07-20', '2026-07-24', '경조사')).toBe(0);
    expect(calculateRequestDays('2026-07-20', '2026-07-24', '기타')).toBe(0);
  });
  it('단체 휴가도 평일 기준', () => {
    expect(calculateRequestDays('2026-08-03', '2026-08-07', '휴가')).toBe(5);
  });
  it('주말만이면 최소 1일', () => {
    expect(calculateRequestDays('2026-07-25', '2026-07-26', '연차')).toBe(1);
  });
});

describe('월차', () => {
  // 2026-01-05 입사 → 02-05..07-05 = 6일 (오늘 07-23)
  it('1년 미만: 올해 발생분만', () => {
    expect(calculateMonthlyLeave('2026-01-05', NOW)).toBe(6);
  });
  // 2025-06-26 입사 → 올해 발생분 01-26..05-26 = 5 (06-26은 1년 도달이라 연차)
  it('12번째 달(1년 도달)은 월차로 세지 않는다', () => {
    expect(calculateMonthlyLeave('2025-06-26', NOW)).toBe(5);
  });
  it('1년이 지나도 올해 발생분은 남는다', () => {
    expect(isUnderOneYear('2025-06-26', NOW)).toBe(false);
    expect(calculateMonthlyLeave('2025-06-26', NOW)).toBe(5);
  });
  it('오래된 직원은 올해 발생 월차가 없다', () => {
    expect(calculateMonthlyLeave('2020-04-27', NOW)).toBe(0);
  });
});

describe('연차 발생 (입사 응당일 기준)', () => {
  it('올해 응당일이 지났으면 발생', () => {
    const g = getAnnualGrantInfo('2023-06-05', NOW);   // 06-05 지남
    expect(g.granted).toBe(true);
    expect(g.anniversary).toBe('2026-06-05');
    expect(calculateAnnualLeave('2023-06-05', NOW)).toBe(16);  // 근속3년 → 15+1
  });

  // 핵심: 연도 숫자만 빼면 이미 발생한 걸로 잘못 계산된다
  it('올해 응당일 전이면 미발생 — 연차 0', () => {
    const g = getAnnualGrantInfo('2022-08-25', NOW);   // 08-25 아직
    expect(g.granted).toBe(false);
    expect(g.anniversary).toBe('2026-08-25');
    expect(g.days).toBe(16);                            // 발생하면 16일
    expect(calculateAnnualLeave('2022-08-25', NOW)).toBe(0);  // 아직 0
  });

  it('1년 미만은 연차 0', () => {
    expect(calculateAnnualLeave('2026-01-05', NOW)).toBe(0);
    expect(getAnnualGrantInfo('2026-01-05', NOW).underOneYear).toBe(true);
  });

  it('2년마다 1일 가산, 최대 25일', () => {
    expect(calculateAnnualLeave('2025-02-01', NOW)).toBe(15);  // 1년 → 15
    expect(calculateAnnualLeave('2020-04-27', NOW)).toBe(17);  // 6년 → 15+2
    expect(calculateAnnualLeave('1990-01-01', NOW)).toBe(25);  // 상한
  });
});

describe('calculateLeaveBalance', () => {
  it('박은지 — 월차 유지 + 휴가 포함 → 잔여 14', () => {
    const e = emp({ id: 'e5', joinDate: '2025-06-26', annualLeave: { carryOverLeave: 3, bonusLeave: 0 }, manualAdjustment: 3 });
    const reqs = ['2026-04-17', '2026-04-28', '2026-05-15', '2026-06-12', '2026-06-24', '2026-06-30']
      .map((d, i) => req({ id: `r${i}`, employeeId: 'e5', startDate: d, endDate: d }));
    const b = calculateLeaveBalance(e, reqs, NOW);
    expect(b.monthly).toBe(5);
    expect(b.annual).toBe(15);
    expect(b.usedRequests).toBe(6);
    expect(b.usedVacation).toBe(3);
    expect(b.remaining).toBe(14);       // 5+15+3 − 6 − 3
  });

  it('이지영 — 올해 연차 미발생이면 이월분만 → 잔여 −6', () => {
    const e = emp({ id: 'e3', joinDate: '2022-08-25', annualLeave: { carryOverLeave: 3, bonusLeave: 0 }, manualAdjustment: 3 });
    const reqs = Array.from({ length: 6 }, (_, i) => req({ id: `r${i}`, employeeId: 'e3' }));
    const b = calculateLeaveBalance(e, reqs, NOW);
    expect(b.annual).toBe(0);
    expect(b.grant.granted).toBe(false);
    expect(b.remaining).toBe(-6);       // 0+0+3 − 6 − 3
  });

  it('경조사·기타는 사용에서 빠진다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [
      req({ id: 'a', employeeId: 'e9', type: '경조사', daysUsed: 3 }),
      req({ id: 'b', employeeId: 'e9', type: '기타', daysUsed: 2 }),
      req({ id: 'c', employeeId: 'e9', type: '연차', daysUsed: 1 }),
    ];
    expect(calculateLeaveBalance(e, reqs, NOW).usedRequests).toBe(1);
  });

  it('대기·반려는 사용에 안 잡힌다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [
      req({ id: 'a', employeeId: 'e9', status: 'pending', daysUsed: 3 }),
      req({ id: 'b', employeeId: 'e9', status: 'rejected', daysUsed: 2 }),
      req({ id: 'c', employeeId: 'e9', status: 'approved', daysUsed: 1 }),
    ];
    expect(calculateLeaveBalance(e, reqs, NOW).usedRequests).toBe(1);
  });

  it('단체 휴가(휴가 유형)도 차감된다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [req({ id: 'v', employeeId: 'e9', type: '휴가', daysUsed: 3 })];
    expect(calculateLeaveBalance(e, reqs, NOW).usedRequests).toBe(3);
  });

  describe('당월 사용', () => {
    it('신청 시작일이 이번 달인 것만 센다', () => {
      const e = emp({ id: 'e9', joinDate: '2020-01-01' });
      const reqs = [
        req({ id: 'a', employeeId: 'e9', startDate: '2026-07-02', endDate: '2026-07-02', daysUsed: 1 }),
        req({ id: 'b', employeeId: 'e9', startDate: '2026-07-20', endDate: '2026-07-22', daysUsed: 3 }),
        req({ id: 'c', employeeId: 'e9', startDate: '2026-06-10', endDate: '2026-06-10', daysUsed: 1 }), // 지난달
      ];
      const b = calculateLeaveBalance(e, reqs, NOW);   // NOW = 2026-07-23
      expect(b.usedThisMonth).toBe(4);
      expect(b.usedRequests).toBe(5);
    });

    it('구 수동 휴가값은 당월에 안 들어간다 (언제 쓴 건지 모름)', () => {
      const e = emp({ id: 'e9', joinDate: '2020-01-01', manualAdjustment: 5 });
      const b = calculateLeaveBalance(e, [], NOW);
      expect(b.usedThisMonth).toBe(0);
      expect(b.usedTotal).toBe(5);
    });

    it('미승인·미차감 유형은 당월에도 빠진다', () => {
      const e = emp({ id: 'e9', joinDate: '2020-01-01' });
      const reqs = [
        req({ id: 'a', employeeId: 'e9', startDate: '2026-07-02', endDate: '2026-07-02', status: 'pending', daysUsed: 1 }),
        req({ id: 'b', employeeId: 'e9', startDate: '2026-07-03', endDate: '2026-07-03', type: '경조사', daysUsed: 2 }),
        req({ id: 'c', employeeId: 'e9', startDate: '2026-07-06', endDate: '2026-07-06', daysUsed: 1 }),
      ];
      expect(calculateLeaveBalance(e, reqs, NOW).usedThisMonth).toBe(1);
    });
  });
});
