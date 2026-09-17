/**
 * **앱이 앞으로 나올 때 새 버전이 있나 물어본다.**
 *
 * 배포를 했는데 폰에서는 옛 화면이 그대로였다(2026-09-06 사장님: "현금흐름 ui가
 * 그대론데"). 서버에는 새 파일이 올라가 있었고 확인도 했다 — 폰 앱이 붙들고 있던 것이다.
 *
 * PWA 는 `registerType: 'autoUpdate'` 라 새 일꾼(service worker)을 찾으면 알아서
 * 갈아 끼운다. 그런데 **찾아보는 때가 화면을 새로 열 때뿐이다.** 폰에 깔아 둔 앱은
 * 껐다 켜도 화면을 새로 열지 않고 그냥 되살아나서, 며칠이 지나도 안 물어본다.
 *
 * 그래서 앱이 다시 앞으로 나올 때마다 한 번 물어본다. 새 게 있으면 그때 갈아 끼운다.
 * 물어보는 값이 싸다 — 새 게 없으면 서버가 바뀐 것 없다고만 답한다.
 *
 * 너무 자주는 안 묻는다(1분). 화면을 왔다 갔다 할 때마다 물으면 쓸데없다.
 */
const 최소간격 = 60_000;
let 마지막 = 0;
let 새버전적용중 = false;

export async function 새버전확인(지금 = Date.now()): Promise<boolean> {
  if (지금 - 마지막 < 최소간격) return false;
  마지막 = 지금;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return false;
    await reg.update();
    return true;
  } catch {
    return false;   // 사생활 보호 모드·미지원 브라우저 — 앱은 그대로 돌아야 한다
  }
}

/** 앱이 앞으로 나올 때마다 확인을 건다. 끄는 함수를 돌려준다. */
export function 새버전확인붙이기(새로고침: () => void = () => window.location.reload()): () => void {
  const 볼때 = () => { if (document.visibilityState === 'visible') void 새버전확인(); };
  // update()는 새 일꾼을 받아 활성화할 뿐, 이미 메모리에 올라온 React/JS는 바꾸지 않는다.
  // 그래서 배포 후에도 화면이 며칠씩 옛 코드로 작업했다. 기존 controller가 있는 앱에서
  // 새 controller로 교체되는 순간 한 번 다시 열어, 새 묶음을 실제로 실행한다.
  const 기존설치 = !!navigator.serviceWorker?.controller;
  const 바뀔때 = () => {
    if (!기존설치 || 새버전적용중) return;
    // FCM 알림 일꾼은 앱 버전이 아니다. 예전에는 PWA 일꾼과 같은 범위에서 서로
    // controller를 바꾸며 새로고침이 반복됐다. 앱의 Workbox 일꾼만 버전 교체로 친다.
    const script = navigator.serviceWorker?.controller?.scriptURL ?? '';
    if (!/\/sw\.js(?:\?|$)/.test(script)) return;
    새버전적용중 = true;
    새로고침();
  };
  document.addEventListener('visibilitychange', 볼때);
  window.addEventListener('focus', 볼때);
  navigator.serviceWorker?.addEventListener('controllerchange', 바뀔때);
  볼때();   // 켜자마자 한 번
  return () => {
    document.removeEventListener('visibilitychange', 볼때);
    window.removeEventListener('focus', 볼때);
    navigator.serviceWorker?.removeEventListener('controllerchange', 바뀔때);
  };
}

/** 시험용 — 마지막으로 물어본 때를 지운다. */
export function 확인시각비우기(): void { 마지막 = 0; 새버전적용중 = false; }
