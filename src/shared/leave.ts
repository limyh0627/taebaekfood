import { Employee, LeaveRequest, LeaveType } from './types';

/**
 * 연차 계산 공용 모듈 — 관리자(HRManager)와 직원 앱(LeaveManager)이 **같은 함수**를 쓴다.
 * 예전엔 양쪽이 각자 계산해서 기준이 어긋났다(직원 앱은 연도 숫자로, 관리자는 응당일로).
 * 부수효과 없음(입력 → 값).
 */

/** 승인돼도 연차에서 차감하지 않는 유형 */
export const NON_DEDUCTIBLE_TYPES: LeaveType[] = ['경조사', '기타'];

/** 유형별 차감 규칙. 'days' = 기간(평일) 기준 */
export const LEAVE_DEDUCTION: Record<LeaveType, number | 'days'> = {
  '연차': 'days',
  '오전반차': 0.5,
  '오후반차': 0.5,
  '경조사': 0,
  '기타': 0,
  '병가': 'days',
  '휴가': 'days',   // 회사 단체 휴가
};

/** 'YYYY-MM-DD' → 로컬 자정 Date (타임존 밀림 방지) */
const parseLocal = (d: string) => new Date(`${d}T00:00:00`);

/** 신청 일수 — 평일 기준(주말 제외, 최소 1일). 반차는 0.5, 미차감 유형은 0. */
export function calculateRequestDays(start: string, end: string, type: LeaveType): number {
  const rule = LEAVE_DEDUCTION[type];
  if (rule === 0) return 0;
  if (typeof rule === 'number') return rule;
  if (!start || !end) return 0;
  const s = parseLocal(start);
  const e = parseLocal(end);
  if (e < s) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

/** 입사 1년 미만인가 */
export function isUnderOneYear(joinDate: string, now = new Date()): boolean {
  const s = new Date(joinDate);
  const a = new Date(s);
  a.setFullYear(s.getFullYear() + 1);
  return now < a;
}

/**
 * 올해 발생한 월차. 입사 1년 미만 기간에 매월 1일씩 최대 11일
 * (12번째 달은 1년 도달 = 연차가 생기는 시점이라 월차로 세지 않는다).
 * 1년이 지나도 0으로 지우지 않는다 — 발생분은 잔여에 포함돼 있다가 해가 바뀔 때 이월로 넘어간다.
 */
export function calculateMonthlyLeave(joinDate: string, now = new Date()): number {
  const s = new Date(joinDate);
  const year = now.getFullYear();
  let count = 0;
  for (let m = 1; m <= 11; m++) {
    const grant = new Date(s.getFullYear(), s.getMonth() + m, s.getDate());
    if (grant > now) break;
    if (grant.getFullYear() === year) count++;
  }
  return count;
}

export interface AnnualGrantInfo {
  /** 입사 1년 미만 — 아직 월차 구간 */
  underOneYear: boolean;
  /** 올해 연차가 이미 발생했나 */
  granted: boolean;
  /** 올해 응당일 'YYYY-MM-DD' */
  anniversary: string;
  /** 발생했으면 그 일수, 아직이면 응당일에 생길 일수 */
  days: number;
}

/**
 * 연차 발생 정보 — 입사 응당일(입사일과 같은 월·일)에 15일 + 2년마다 1일 가산(최대 25일).
 * 올해 응당일이 아직 안 지났으면 미발생(그때까지는 이월분으로 사용).
 */
export function getAnnualGrantInfo(joinDate: string, now = new Date()): AnnualGrantInfo {
  const s = new Date(joinDate);
  const year = now.getFullYear();
  const anni = new Date(year, s.getMonth(), s.getDate());
  const completedYears = year - s.getFullYear();
  const days = completedYears < 1 ? 0 : Math.min(25, 15 + Math.floor((completedYears - 1) / 2));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    underOneYear: isUnderOneYear(joinDate, now),
    granted: now >= anni,
    anniversary: `${anni.getFullYear()}-${pad(anni.getMonth() + 1)}-${pad(anni.getDate())}`,
    days,
  };
}

/** 올해 실제로 발생한 연차 일수 (미발생이면 0) */
export function calculateAnnualLeave(joinDate: string, now = new Date()): number {
  const g = getAnnualGrantInfo(joinDate, now);
  if (g.underOneYear || !g.granted) return 0;
  return g.days;
}

/** 승인된 신청 중 차감 대상 일수 합계. ym('YYYY-MM')을 주면 그 달 시작분만. */
export function getApprovedLeaveDays(empId: string, leaveRequests: LeaveRequest[], ym?: string): number {
  return leaveRequests
    .filter(r => r.employeeId === empId && r.status === 'approved' && !NON_DEDUCTIBLE_TYPES.includes(r.type))
    .filter(r => !ym || (r.startDate ?? '').slice(0, 7) === ym)
    .reduce((sum, r) => sum + (r.daysUsed || 0), 0);
}

/** 'YYYY-MM' */
export const toYearMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export interface LeaveBalance {
  monthly: number;      // 올해 발생 월차
  annual: number;       // 올해 발생 연차 (미발생이면 0)
  carryOver: number;    // 이월
  bonus: number;        // 보너스
  granted: number;      // 총 부여 = monthly + annual + carryOver + bonus
  usedTotal: number;    // 총 사용 — 승인된 신청(연차·휴가 등) 전부
  usedThisMonth: number;// 당월 사용분 (신청 시작일 기준)
  remaining: number;    // 잔여 = granted − usedTotal
  grant: AnnualGrantInfo;
}

/**
 * 직원 한 명의 연차 현황 — 관리자·직원 앱이 이 결과를 그대로 쓴다.
 *
 *   총 부여 = 월차 + 연차 + 이월 + 보너스
 *   사용    = 승인된 신청 + 휴가(단체)
 *   잔여    = 총 부여 − 사용
 */
export function calculateLeaveBalance(
  emp: Employee,
  leaveRequests: LeaveRequest[],
  now = new Date(),
): LeaveBalance {
  const monthly = calculateMonthlyLeave(emp.joinDate, now);
  const annual = calculateAnnualLeave(emp.joinDate, now);
  const carryOver = emp.annualLeave?.carryOverLeave || 0;
  const bonus = emp.annualLeave?.bonusLeave || 0;
  // 사용은 신청 기록 하나로만 센다. 회사 단체 휴가도 '휴가' 유형 신청으로 남는다.
  const usedTotal = getApprovedLeaveDays(emp.id, leaveRequests);
  const usedThisMonth = getApprovedLeaveDays(emp.id, leaveRequests, toYearMonth(now));

  const granted = monthly + annual + carryOver + bonus;
  return {
    monthly, annual, carryOver, bonus, granted,
    usedTotal, usedThisMonth,
    remaining: granted - usedTotal,
    grant: getAnnualGrantInfo(emp.joinDate, now),
  };
}
