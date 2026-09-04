//  **폰 알림은 이 파일 하나만 안다.**
//  전에는 오피스톡 안에 알림음·진동·브라우저 알림이 통째로 박혀 있어서,
//  새 주문 알림을 붙이려면 같은 코드를 또 적어야 했다. 아이콘 주소가 틀린 것도
//  거기서만 틀려 있었다(`/pwa-192x192.png` — 실제 파일은 `icon-192x192.png`).

export type NotifyMode = 'sound' | 'vibration' | 'both';

/** 매니페스트에 있는 진짜 아이콘. 없는 주소를 주면 알림에 아이콘이 안 뜬다. */
export const NOTIFY_ICON = '/icon-192x192.png';

export const notifySupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

export const notifyPermission = (): NotificationPermission =>
  notifySupported() ? Notification.permission : 'denied';

/**
 * 권한을 묻는다. **사람이 버튼을 눌렀을 때만 부를 것.**
 * 화면 열자마자 자동으로 물으면, 팝업을 그냥 닫았을 때 권한이 'default' 로 남아
 * 들어올 때마다 다시 뜬다(2026-09-03 사장님).
 */
export async function askNotifyPermission(): Promise<NotificationPermission> {
  if (!notifySupported()) return 'denied';
  return Notification.requestPermission();
}

//  ── 소리·진동 설정 ─────────────────────────────────────────────
//  전에는 오피스톡 안에만 있었다(`officetalk_notif_mode`). 알림이 주문에도 붙으면서
//  설정은 계정 메뉴 한 곳으로 옮겼다 — 읽고 쓰는 건 이 두 함수뿐이다.

export const NOTIFY_MODE_KEY = 'tb_notif_mode';
/** 옛 자리 — 사장님이 이미 골라 둔 값을 잃지 않게 한 번 옮겨 온다. */
const OLD_MODE_KEY = 'officetalk_notif_mode';

const 쓸수있는모드 = (v: unknown): v is NotifyMode => v === 'sound' || v === 'vibration' || v === 'both';

export function loadNotifyMode(): NotifyMode {
  try {
    const now = localStorage.getItem(NOTIFY_MODE_KEY);
    if (쓸수있는모드(now)) return now;
    const old = localStorage.getItem(OLD_MODE_KEY);
    if (쓸수있는모드(old)) { localStorage.setItem(NOTIFY_MODE_KEY, old); return old; }
  } catch { /* 사생활 모드 */ }
  return 'both';
}

export function saveNotifyMode(mode: NotifyMode): void {
  try { localStorage.setItem(NOTIFY_MODE_KEY, mode); } catch { /* 무시 */ }
}

/** 알림음 — 파일 없이 그 자리에서 만든다. */
export function playChime(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* 소리가 막힌 브라우저 — 알림 자체는 계속 간다 */ }
}

export function buzz(pattern: number | number[] = [150, 80, 150]): void {
  try { navigator.vibrate?.(pattern); } catch { /* 무시 */ }
}

export interface NotifyOpts {
  title: string;
  body?: string;
  /** 같은 tag 끼리는 덮어쓴다 — 같은 방·같은 주문이 줄줄이 쌓이지 않는다 */
  tag?: string;
  mode?: NotifyMode;
  /** 화면을 보고 있을 때도 알림을 띄울지. 기본은 아니오 — 보고 있는데 뜨면 성가시다 */
  whenFocused?: boolean;
  /** 앱이 열려 있을 때 알림을 누르면 할 일 (PC 전용 — 서비스워커 길로 가면 안 불린다) */
  onClick?: () => void;
  /** 알림을 눌렀을 때 열 화면. 서비스워커가 앱을 띄우고 여기로 보낸다. */
  view?: string;
}

/**
 * 소리·진동·알림창을 한 번에. 권한이 없으면 소리·진동만 난다.
 *
 * **안드로이드에서는 `new Notification()` 이 안 된다** — 크롬이 막아 놨고
 * (`Illegal constructor`) 서비스워커를 통해서만 띄울 수 있다. 그래서 폰에서는
 * 상단 알림이 통째로 안 떴다(2026-09-03 사장님). 서비스워커가 있으면 그쪽으로,
 * 없으면(PC 브라우저·서비스워커 등록 전) 옛 방식으로 띄운다.
 *
 * 누른 뒤 무엇을 열지는 서비스워커가 알 수 없으니 `data.view` 로 실어 보낸다 —
 * [public/notif-sw.js](../../public/notif-sw.js) 가 받아서 앱을 띄우고 그 화면으로 보낸다.
 */
export function notify({ title, body, tag, mode = 'both', whenFocused = false, onClick, view }: NotifyOpts): void {
  const focused = typeof document !== 'undefined' && document.hasFocus();
  if (mode === 'sound' || mode === 'both') playChime();
  if (mode === 'vibration' || mode === 'both') buzz();

  if (notifyPermission() !== 'granted') return;
  if (focused && !whenFocused) return;

  const opts = {
    body, icon: NOTIFY_ICON, badge: NOTIFY_ICON, tag,
    //  폰이 소리·진동을 알림에 붙여 준다. 화면이 꺼져 있어도 울린다.
    silent: mode === 'vibration',
    vibrate: mode === 'sound' ? undefined : [150, 80, 150],
    data: { view },
  } as NotificationOptions;

  //  서비스워커 쪽이 먼저다 — 안드로이드에선 이 길밖에 없다
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration()
      .then(reg => {
        if (reg) return reg.showNotification(title, opts);
        return 창으로띄우기(title, opts, onClick);
      })
      .catch(() => 창으로띄우기(title, opts, onClick));
    return;
  }
  창으로띄우기(title, opts, onClick);
}

/** 옛 방식 — PC 브라우저에서만 된다. */
function 창으로띄우기(title: string, opts: NotificationOptions, onClick?: () => void): void {
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
  } catch { /* 안드로이드는 여기로 온다 — 위에서 서비스워커를 먼저 쓴다 */ }
}

/** 알림이 왜 안 뜨는지 사람 말로. 안 뜬다는 신고를 받았을 때 짚을 곳이 여기다. */
export async function notifyDiagnose(): Promise<{ ok: boolean; msg: string }> {
  if (!notifySupported()) return { ok: false, msg: '이 브라우저는 알림을 못 씁니다.' };

  const perm = notifyPermission();
  if (perm === 'denied') return { ok: false, msg: '알림이 차단돼 있습니다. 주소창 왼쪽 자물쇠 → 사이트 설정 → 알림에서 허용해 주세요.' };
  if (perm === 'default') return { ok: false, msg: '아직 알림을 켜지 않았습니다. 위 "폰 알림 켜기"를 눌러 주세요.' };

  if (!('serviceWorker' in navigator)) {
    return { ok: false, msg: '이 브라우저에는 서비스워커가 없습니다 — 안드로이드에서는 상단 알림이 안 뜹니다.' };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    return { ok: false, msg: '서비스워커가 아직 안 붙었습니다. 앱을 완전히 닫았다 다시 열어 주세요.' };
  }

  await reg.showNotification('🔔 알림 시험', {
    body: '이 알림이 상단에 보이면 제대로 켜진 것입니다.',
    icon: NOTIFY_ICON, badge: NOTIFY_ICON, tag: 'notify-test',
  } as NotificationOptions);
  buzz();
  return { ok: true, msg: '알림을 보냈습니다. 상단(알림창)을 내려 보세요.' };
}
