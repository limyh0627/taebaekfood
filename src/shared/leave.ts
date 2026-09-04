import { Employee, LeaveRequest, LeaveStatus, LeaveType } from './types';

/**
 * 연차 계산 공용 모듈 — 관리자(HRManager)와 직원 앱(LeaveManager)이 **같은 함수**를 쓴다.
 * 예전엔 양쪽이 각자 계산해서 기준이 어긋났다(직원 앱은 연도 숫자로, 관리자는 응당일로).
 * 부수효과 없음(입력 → 값).
 */

/** 유형 자체가 연차를 차감하지 않는 것 */
export const NON_DEDUCTIBLE_TYPES: LeaveType[] = ['경조사', '기타'];

/**
 * 이 신청이 연차를 차감하는가 — 차감 판정은 전부 이 함수를 거친다.
 *  1) 건별 지정(deductsLeave)이 있으면 그걸 따른다 — 단체 휴가의 차감/미차감이 여기로 갈린다
 *  2) 없으면 유형 기본값(경조사·기타만 미차감)
 */
export function isDeductible(r: Pick<LeaveRequest, 'type' | 'deductsLeave'>): boolean {
  if (r.deductsLeave !== undefined) return r.deductsLeave;
  return !NON_DEDUCTIBLE_TYPES.includes(r.type);
}

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

/**
 * 승인된 신청 중 차감 대상 일수 합계. ym('YYYY-MM')을 주면 그 달 시작분만.
 *
 * `when` 으로 **아직 안 온 날**을 갈라낼 수 있다(2026-09-02 사장님 지적) —
 * 승인만 하면 10월 연차가 9월 '사용'에 잡혀서, 아직 쉬지도 않았는데 쓴 것으로 보였다.
 *   'past'      시작일이 오늘까지 — 실제로 쓴 것
 *   'upcoming'  시작일이 내일 이후 — 승인됐지만 아직 안 온 것
 *   (없으면)     전부
 *
 * **여러 날짜에 걸친 신청은 쪼개지 않는다.** 시작일 하나로 가른다 —
 * 9/1~9/5 신청을 3일 쓰고 2일 남았다고 나누면 화면에서 그 숫자가 뭘 뜻하는지
 * 아무도 못 읽는다. 사람이 읽는 대로 "그 휴가는 시작됐나"로 본다.
 */
/**
 * 이 휴가가 **이미 시작됐나** — 사용과 예정을 가르는 유일한 판정.
 * 관리자(HRManager)와 직원 앱(LeaveManager)이 이 하나를 쓴다.
 * 시작일이 오늘이면 시작된 것으로 본다(오늘 쉬고 있으면 쓴 것이다).
 */
export function hasStarted(r: Pick<LeaveRequest, 'startDate'>, now = new Date()): boolean {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (r.startDate ?? '') <= today;
}

export function getApprovedLeaveDays(
  empId: string,
  leaveRequests: LeaveRequest[],
  ym?: string,
  when?: 'past' | 'upcoming',
  now = new Date(),
): number {
  return leaveRequests
    .filter(r => r.employeeId === empId && r.status === 'approved' && isDeductible(r))
    .filter(r => !ym || (r.startDate ?? '').slice(0, 7) === ym)
    .filter(r => {
      if (!when) return true;
      return when === 'past' ? hasStarted(r, now) : !hasStarted(r, now);
    })
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
  usedTotal: number;    // 총 사용 — **이미 시작된** 승인 신청만
  usedThisMonth: number;// 당월 사용분 (신청 시작일 기준, 이미 시작된 것만)
  /**
   * 예정 — 승인됐지만 아직 안 온 것. **잔여에서 안 뺀다**(2026-09-03 사장님).
   * 잔여는 "지금까지 쓰고 남은 날"이지 "앞으로 더 쓸 수 있는 날"이 아니다.
   * 앞으로 쓸 수 있는 날을 알고 싶으면 `remaining - scheduled` 를 보면 된다 —
   * 화면이 둘을 나란히 보여준다.
   */
  scheduled: number;
  /** 잔여 = granted − usedTotal. **예정은 안 뺀다.** */
  remaining: number;
  grant: AnnualGrantInfo;
}

/**
 * 직원 한 명의 연차 현황 — 관리자·직원 앱이 이 결과를 그대로 쓴다.
 *
 *   총 부여 = 월차 + 연차 + 이월 + 보너스
 *   사용    = 승인된 신청 중 **이미 시작된 것** + 휴가(단체)
 *   예정    = 승인됐지만 **아직 안 온 것**
 *   잔여    = 총 부여 − 사용        ← **예정은 안 뺀다**
 *
 * **셋을 다 보여준다.** 잔여에서 예정까지 빼면 "지금 며칠 남았나"를 못 읽는다
 * (2026-09-03 사장님). 그렇다고 예정을 '사용'에 섞으면 아직 쉬지도 않았는데
 * 쓴 것으로 보인다. 그래서 칸을 셋으로 두고, 앞으로 쓸 수 있는 날이 궁금하면
 * **잔여 − 예정**을 보면 된다(화면이 둘을 나란히 놓는다).
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
  const usedTotal = getApprovedLeaveDays(emp.id, leaveRequests, undefined, 'past', now);
  const usedThisMonth = getApprovedLeaveDays(emp.id, leaveRequests, toYearMonth(now), 'past', now);
  const scheduled = getApprovedLeaveDays(emp.id, leaveRequests, undefined, 'upcoming', now);

  const granted = monthly + annual + carryOver + bonus;
  return {
    monthly, annual, carryOver, bonus, granted,
    usedTotal, usedThisMonth, scheduled,
    //  **예정은 안 뺀다** — 잔여는 실제로 쓰고 남은 날이다(2026-09-03 사장님).
    //  아직 안 온 날까지 빼면 "지금 며칠 남았나"를 못 읽는다. 예정은 옆에 따로 보여준다.
    remaining: granted - usedTotal,
    grant: getAnnualGrantInfo(emp.joinDate, now),
  };
}

export interface LeaveActor { id: string; name: string }

/**
 * 연차 신청의 상태를 바꿀 때 **DB 에 무엇을 쓸지**.
 *
 * 세 화면(HRManager·AdminChecklist·LeaveManager)이 각자 판단하다 갈렸고,
 * 그중 하나가 **정반대로 쓰고 있었다**(2026-09-04 발견):
 *   · '취소 승인' 을 누르면 `cancelled` 가 아니라 `rejected` 로 들어갔다
 *   · **'반려'(취소를 거절) 를 누르면 오히려 `cancelled` 로 들어가 연차가 사라졌다**
 * 지금 상태를 보고 뜻을 뒤집으려던 게 원인이다. 이제 **부르는 쪽이 바뀔 상태를
 * 그대로 주고**, 이 함수는 자국만 붙인다. 뒤집을 일이 없으니 뒤집혀 쓸 일도 없다.
 *
 * @param next   바꿀 상태 (화면이 바라는 결과 그대로)
 * @param by     누가 바꿨나 — 취소일 때만 남긴다
 * @param reason 왜 취소했나
 */
export function leaveStatusPatch(
  next: LeaveStatus,
  by?: LeaveActor,
  reason?: string,
  now = new Date(),
): Partial<LeaveRequest> {
  if (next !== 'cancelled') return { status: next };
  const 사유 = (reason ?? '').trim();
  return {
    status: 'cancelled',
    cancelledAt: now.toISOString(),
    ...(by ? { cancelledBy: by.id, cancelledByName: by.name } : {}),
    ...(사유 ? { cancelReason: 사유 } : {}),
  };
}

/** 이 신청을 지금 취소할 수 있나 — 이미 취소·반려된 건 다시 취소할 게 없다. */
export function canCancel(r: Pick<LeaveRequest, 'status'>): boolean {
  return r.status === 'approved' || r.status === 'pending' || r.status === 'cancel_pending';
}
