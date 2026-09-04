import { describe, it, expect } from 'vitest';
import { calculateRequestDays, isUnderOneYear, calculateMonthlyLeave, getAnnualGrantInfo, calculateAnnualLeave, calculateLeaveBalance, isDeductible, leaveStatusPatch, canCancel, getApprovedLeaveDays } from './leave';
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

describe('isDeductible', () => {
  it('유형 기본값 — 경조사·기타만 미차감', () => {
    expect(isDeductible({ type: '연차' })).toBe(true);
    expect(isDeductible({ type: '휴가' })).toBe(true);
    expect(isDeductible({ type: '병가' })).toBe(true);
    expect(isDeductible({ type: '경조사' })).toBe(false);
    expect(isDeductible({ type: '기타' })).toBe(false);
  });
  it('건별 지정이 유형 기본값을 이긴다', () => {
    expect(isDeductible({ type: '휴가', deductsLeave: false })).toBe(false);   // 창립기념일 등
    expect(isDeductible({ type: '경조사', deductsLeave: true })).toBe(true);
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
  it('박은지 — 월차 유지 + 휴가 기록 포함 → 잔여 14', () => {
    const e = emp({ id: 'e5', joinDate: '2025-06-26', annualLeave: { carryOverLeave: 3, bonusLeave: 0 } });
    const reqs = [
      ...['2026-04-17', '2026-04-28', '2026-05-15', '2026-06-12', '2026-06-24', '2026-06-30']
        .map((d, i) => req({ id: `r${i}`, employeeId: 'e5', startDate: d, endDate: d })),
      req({ id: 'vac', employeeId: 'e5', type: '휴가', startDate: '2026-01-01', endDate: '2026-01-01', daysUsed: 3 }),
    ];
    const b = calculateLeaveBalance(e, reqs, NOW);
    expect(b.monthly).toBe(5);
    expect(b.annual).toBe(15);
    expect(b.usedTotal).toBe(9);        // 신청 6 + 휴가 3
    expect(b.remaining).toBe(14);       // 5+15+3 − 9
  });

  it('이지영 — 올해 연차 미발생이면 이월분만 → 잔여 −6', () => {
    const e = emp({ id: 'e3', joinDate: '2022-08-25', annualLeave: { carryOverLeave: 3, bonusLeave: 0 } });
    const reqs = [
      ...Array.from({ length: 6 }, (_, i) => req({ id: `r${i}`, employeeId: 'e3' })),
      req({ id: 'vac', employeeId: 'e3', type: '휴가', startDate: '2026-01-01', endDate: '2026-01-01', daysUsed: 3 }),
    ];
    const b = calculateLeaveBalance(e, reqs, NOW);
    expect(b.annual).toBe(0);
    expect(b.grant.granted).toBe(false);
    expect(b.remaining).toBe(-6);       // 0+0+3 − 9
  });

  it('경조사·기타는 사용에서 빠진다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [
      req({ id: 'a', employeeId: 'e9', type: '경조사', daysUsed: 3 }),
      req({ id: 'b', employeeId: 'e9', type: '기타', daysUsed: 2 }),
      req({ id: 'c', employeeId: 'e9', type: '연차', daysUsed: 1 }),
    ];
    expect(calculateLeaveBalance(e, reqs, NOW).usedTotal).toBe(1);
  });

  it('대기·반려는 사용에 안 잡힌다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [
      req({ id: 'a', employeeId: 'e9', status: 'pending', daysUsed: 3 }),
      req({ id: 'b', employeeId: 'e9', status: 'rejected', daysUsed: 2 }),
      req({ id: 'c', employeeId: 'e9', status: 'approved', daysUsed: 1 }),
    ];
    expect(calculateLeaveBalance(e, reqs, NOW).usedTotal).toBe(1);
  });

  it('단체 휴가(휴가 유형)도 기본은 차감', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [req({ id: 'v', employeeId: 'e9', type: '휴가', daysUsed: 3 })];
    expect(calculateLeaveBalance(e, reqs, NOW).usedTotal).toBe(3);
  });

  it('단체 휴가를 미차감으로 지정하면 사용에 안 잡힌다', () => {
    const e = emp({ id: 'e9', joinDate: '2020-01-01' });
    const reqs = [
      req({ id: 'v1', employeeId: 'e9', type: '휴가', daysUsed: 3, deductsLeave: false }),  // 창립기념일 등
      req({ id: 'v2', employeeId: 'e9', type: '휴가', daysUsed: 2 }),                        // 집단 연차소진
    ];
    expect(calculateLeaveBalance(e, reqs, NOW).usedTotal).toBe(2);
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
      expect(b.usedTotal).toBe(5);
    });

    it('1월에 등록된 단체 휴가는 당월(7월)에 안 들어간다', () => {
      const e = emp({ id: 'e9', joinDate: '2020-01-01' });
      const reqs = [req({ id: 'v', employeeId: 'e9', type: '휴가', startDate: '2026-01-01', endDate: '2026-01-01', daysUsed: 5 })];
      const b = calculateLeaveBalance(e, reqs, NOW);
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

/**
 * **승인 ≠ 사용.** (2026-09-02 사장님 지적)
 *
 * 승인만 하면 두 달 뒤 연차가 오늘 '사용'에 잡혔다. 박은지 10/29~30 두 건이
 * 9월 화면에서 이미 쓴 것으로 보였다 — 아직 쉬지도 않았는데.
 *
 * 그렇다고 잔여에서 빼지 않으면 없는 날을 또 내준다. 그래서 **칸을 나눈다** —
 * 사용(이미 시작된 것) · 예정(아직 안 온 것), 잔여에서는 둘 다 뺀다.
 */
describe('사용과 예정을 가른다', () => {
  const 오늘 = new Date('2026-09-02T00:00:00');
  const 은지 = () => emp({ id: 'e5', joinDate: '2025-06-26', annualLeave: { carryOverLeave: 3, bonusLeave: 0 } });

  it('**아직 안 온 연차는 사용이 아니라 예정이다**', () => {
    const reqs = [
      req({ id: '지난것', employeeId: 'e5', startDate: '2026-06-12', endDate: '2026-06-12' }),
      req({ id: '앞으로', employeeId: 'e5', startDate: '2026-10-29', endDate: '2026-10-30', daysUsed: 2 }),
    ];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedTotal).toBe(1);
    expect(b.scheduled).toBe(2);
  });

  it('**잔여에서 예정은 안 뺀다** — 잔여는 실제로 쓰고 남은 날이다 (2026-09-03 사장님)', () => {
    //  아직 안 온 날까지 빼면 "지금 며칠 남았나"를 못 읽는다.
    //  앞으로 쓸 수 있는 날이 궁금하면 잔여 − 예정을 보면 된다 — 화면이 둘을 나란히 놓는다.
    const reqs = [
      req({ id: '지난것', employeeId: 'e5', startDate: '2026-06-12', endDate: '2026-06-12' }),
      req({ id: '앞으로', employeeId: 'e5', startDate: '2026-10-29', endDate: '2026-10-30', daysUsed: 2 }),
    ];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.remaining).toBe(b.granted - 1);      // 예정 2일은 안 뺀다
    expect(b.scheduled).toBe(2);
    expect(b.remaining - b.scheduled).toBe(b.granted - 3);   // 앞으로 쓸 수 있는 날
  });

  it('오늘 시작하는 휴가는 사용이다 — 오늘 쉬고 있으면 쓴 것이다', () => {
    const reqs = [req({ id: '오늘', employeeId: 'e5', startDate: '2026-09-02', endDate: '2026-09-02' })];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedTotal).toBe(1);
    expect(b.scheduled).toBe(0);
  });

  it('내일 시작하면 예정이다 — 하루 차이로 갈린다', () => {
    const reqs = [req({ id: '내일', employeeId: 'e5', startDate: '2026-09-03', endDate: '2026-09-03' })];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedTotal).toBe(0);
    expect(b.scheduled).toBe(1);
  });

  it('**여러 날에 걸쳐도 쪼개지 않는다** — 시작일 하나로 가른다', () => {
    //  9/1~9/5 는 오늘(9/2) 한창 쉬는 중 — 3일 썼다고 나누지 않고 통째로 사용이다
    const reqs = [req({ id: '걸침', employeeId: 'e5', startDate: '2026-09-01', endDate: '2026-09-05', daysUsed: 5 })];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedTotal).toBe(5);
    expect(b.scheduled).toBe(0);
  });

  it('당월 사용에도 예정은 안 섞인다', () => {
    const reqs = [
      req({ id: '이달지남', employeeId: 'e5', startDate: '2026-09-01', endDate: '2026-09-01' }),
      req({ id: '이달앞으로', employeeId: 'e5', startDate: '2026-09-30', endDate: '2026-09-30' }),
    ];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedThisMonth).toBe(1);
    expect(b.scheduled).toBe(1);
  });

  it('승인 안 된 건은 사용도 예정도 아니다', () => {
    const reqs = [
      req({ id: '대기', employeeId: 'e5', startDate: '2026-10-29', endDate: '2026-10-29', status: 'pending' }),
      req({ id: '반려', employeeId: 'e5', startDate: '2026-10-30', endDate: '2026-10-30', status: 'rejected' }),
    ];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.usedTotal).toBe(0);
    expect(b.scheduled).toBe(0);
    expect(b.remaining).toBe(b.granted);
  });

  it('경조사·기타는 예정에도 안 들어간다 — 애초에 차감을 안 한다', () => {
    const reqs = [
      req({ id: '경조', employeeId: 'e5', type: '경조사', startDate: '2026-10-29', endDate: '2026-10-29', daysUsed: 3 }),
    ];
    const b = calculateLeaveBalance(은지(), reqs, 오늘);
    expect(b.scheduled).toBe(0);
  });
});

describe('leaveStatusPatch — 상태를 바꿀 때 쓸 것', () => {
  const 나 = { id: 'admin', name: '태백식품' };
  const 때 = new Date('2026-09-04T10:00:00+09:00');

  it('보통 상태는 그대로 쓴다', () => {
    expect(leaveStatusPatch('approved')).toEqual({ status: 'approved' });
    expect(leaveStatusPatch('rejected')).toEqual({ status: 'rejected' });
    expect(leaveStatusPatch('cancel_pending')).toEqual({ status: 'cancel_pending' });
  });

  it('취소는 자국을 남긴다 — 누가 언제 왜', () => {
    expect(leaveStatusPatch('cancelled', 나, '안 쉬기로 함', 때)).toEqual({
      status: 'cancelled',
      cancelledAt: 때.toISOString(),
      cancelledBy: 'admin',
      cancelledByName: '태백식품',
      cancelReason: '안 쉬기로 함',
    });
  });

  it('사유를 안 적어도 취소는 된다', () => {
    const p = leaveStatusPatch('cancelled', 나, '   ', 때);
    expect(p.status).toBe('cancelled');
    expect(p.cancelReason).toBeUndefined();
  });

  //  전에 갈려 있던 자리 — 이 둘이 뒤집혀 있었다
  it('**취소 승인은 cancelled 다** — rejected 로 들어가던 것', () => {
    expect(leaveStatusPatch('cancelled', 나, '', 때).status).toBe('cancelled');
  });
  it('**취소를 거절하면 approved 로 남는다** — cancelled 로 들어가 연차가 사라지던 것', () => {
    expect(leaveStatusPatch('approved')).toEqual({ status: 'approved' });
  });
});

describe('canCancel', () => {
  it('승인·대기·취소요청은 취소할 수 있다', () => {
    expect(canCancel({ status: 'approved' })).toBe(true);
    expect(canCancel({ status: 'pending' })).toBe(true);
    expect(canCancel({ status: 'cancel_pending' })).toBe(true);
  });
  it('이미 취소·반려된 건 다시 취소할 게 없다', () => {
    expect(canCancel({ status: 'cancelled' })).toBe(false);
    expect(canCancel({ status: 'rejected' })).toBe(false);
  });
});

describe('취소하면 셈에서 빠진다 — 지우지 않아도 된다', () => {
  it('cancelled 는 사용에 안 잡힌다', () => {
    const reqs: any[] = [
      { id: 'a', employeeId: 'e1', status: 'approved',  type: '연차', startDate: '2026-09-01', daysUsed: 1 },
      { id: 'b', employeeId: 'e1', status: 'cancelled', type: '연차', startDate: '2026-09-02', daysUsed: 1 },
    ];
    expect(getApprovedLeaveDays('e1', reqs, undefined, undefined, new Date('2026-09-04T00:00:00+09:00'))).toBe(1);
  });
});
