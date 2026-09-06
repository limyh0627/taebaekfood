/**
 * **앱을 켤 때 어느 화면을 여나.**
 *
 * 마지막에 보던 화면을 `localStorage` 에 적어 두고 다음에 켤 때 그대로 열었다.
 * 그래서 **세금계산서를 마지막에 보고 끄면 다음에 켤 때 세금계산서가 떴다**
 * (2026-09-06 사장님이 "왜 대시보드가 아니고 세금계산서냐"). 앱을 켠다는 건
 * 새로 시작한다는 뜻이지, 지난번 하던 걸 잇는다는 뜻이 아니다.
 *
 * **켜면 첫 화면. 새로고침은 보던 자리.**
 * `sessionStorage` 를 쓴다 — 같은 탭에서 새로고침하면 남아 있고, 앱을 닫으면 지워진다.
 * 전표를 채우다 실수로 새로고침했는데 대시보드로 튕기면 그것대로 화난다.
 *
 * 앱마다 첫 화면이 다르다 — 관리자는 대시보드, 직원은 주문.
 */
export function loadStartView<T extends string>(key: string, 첫화면: T): T {
  try {
    //  옛 방식이 남아 있으면 지운다 — 안 지우면 예전에 적힌 화면이 계속 따라온다.
    localStorage.removeItem(key);
    return (sessionStorage.getItem(key) as T) || 첫화면;
  } catch {
    return 첫화면;   // 사생활 보호 모드 등에서 저장소가 막힌다
  }
}

/** 화면을 옮길 때마다 적어 둔다 — 새로고침에 자리를 지키려고. */
export function saveView(key: string, view: string): void {
  try { sessionStorage.setItem(key, view); } catch { /* 저장소가 막혀도 앱은 돌아야 한다 */ }
}
