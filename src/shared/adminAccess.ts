//  **관리자 앱에 들어갈 수 있는지 가리는 곳은 여기 하나다.**
//  전에는 [apps/admin/main.tsx](../../apps/admin/main.tsx) 에 `id !== 'admin'` 이 박혀 있어서,
//  사장님 계정 말고는 아무도 못 들어왔다. 사람 이름을 코드에 박는 대신 **직원 기록에 칸을 둔다** —
//  그러면 사람이 바뀔 때 배포를 안 해도 된다(2026-09-03 사장님: 이은경 상무).

/** 사장님 계정. 이 id 는 직원 기록이 없어도 늘 들어갈 수 있다. */
export const OWNER_ID = 'admin';

export interface AdminAccessLike {
  id: string;
  /** 관리자 앱 접근 허용. 직원 기록(`employees`)에 둔다. */
  adminAccess?: boolean;
}

/** 관리자 앱을 열 수 있나. */
export function canEnterAdmin(user: AdminAccessLike | null | undefined): boolean {
  if (!user) return false;
  if (user.id === OWNER_ID) return true;
  return user.adminAccess === true;
}

/**
 * 로그인한 계정의 **최신** 권한. 로그인할 때 localStorage 에 박아 둔 사본은 낡는다 —
 * 권한을 준 뒤에도 앱을 지우고 다시 깔아야 들어가지는 일을 막는다.
 * @param saved  localStorage 에 있던 계정
 * @param live   지금 employees 컬렉션에 있는 목록
 */
export function freshAccess<T extends AdminAccessLike>(saved: T, live: readonly T[]): T {
  const hit = live.find(e => e.id === saved.id);
  return hit ? { ...saved, ...hit } : saved;
}
