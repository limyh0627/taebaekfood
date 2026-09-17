import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { arrayUnion, arrayRemove, deleteField, doc, updateDoc, FieldPath } from 'firebase/firestore';
import { app, db } from './firebase';
import { COL } from './collections';
import { currentDeviceLabel } from './deviceLabel';

/**
 * **앱을 완전히 닫아도 오는 알림(FCM).**
 *
 * 지금까지는 앱이 살아 있을 때만 알림을 만들 수 있었다 — 최근앱에서 밀어 닫으면
 * 코드가 안 돌아 알릴 방법이 없었다. FCM 은 **서버가 폰으로 직접 밀어 넣는다.**
 *
 * 폰마다 표(token)를 하나씩 받아 직원 기록에 담아 둔다. 한 사람이 폰·PC 를 같이 쓰므로
 * **여러 개**를 담는다.
 *
 * 아이폰은 **홈 화면에 추가한 뒤에만** 된다(사파리 탭으로는 안 된다, iOS 16.4 이상).
 */

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/** 이 브라우저가 FCM 을 쓸 수 있나 */
export async function pushSupported(): Promise<boolean> {
  if (!VAPID) return false;
  try { return await isSupported(); } catch { return false; }
}

export interface PushResult {
  ok: boolean;
  token?: string;
  /** 안 되면 왜 안 되는지 — 사람 말로 */
  reason?: string;
}

/**
 * **이 폰에서 알림을 꺼 뒀나** — 사람이 직접 끈 것.
 *
 * 브라우저 알림 권한은 앱이 거둘 수 없다. 한 번 켜면 폰 설정까지 들어가야 끄는데,
 * 홈 화면에 추가한 아이폰 PWA 는 그 목록에서 찾기도 어렵다. 그래서 **우리 알림만 끊는
 * 스위치**를 따로 둔다(마이페이지) — 표를 빼고, 이 표시를 남긴다.
 *
 * 표시가 있어야 한다 — 없으면 앱을 열 때마다 [AdminApp](../features/admin/AdminApp.tsx)·
 * 마이페이지가 표를 도로 담아서 껐다가도 다시 켜진다.
 * 막는 자리는 `registerPush` 한 곳이다.
 */
const 끈표시 = (employeeId: string) => `push:off:${employeeId}`;

export function pushMuted(employeeId: string): boolean {
  try { return localStorage.getItem(끈표시(employeeId)) === '1'; } catch { return false; }
}

export function setPushMuted(employeeId: string, muted: boolean): void {
  try {
    if (muted) localStorage.setItem(끈표시(employeeId), '1');
    else localStorage.removeItem(끈표시(employeeId));
  } catch { /* 사생활 보호 모드 — 끈 것이 안 남는다. 알림은 이번에만 멈춘다 */ }
}

/**
 * 이 폰의 표를 받아 직원 기록에 담는다.
 *
 * **알림 권한이 이미 켜져 있어야 한다** — 여기서 묻지 않는다(묻는 자리는 마이페이지 하나다).
 * @param employeeId 로그인한 사람
 */
export async function registerPush(employeeId: string): Promise<PushResult> {
  if (pushMuted(employeeId)) return { ok: false, reason: '이 폰에서 알림을 꺼 두셨습니다.' };
  if (!VAPID) return { ok: false, reason: '웹 푸시 인증서(VAPID)가 설정돼 있지 않습니다.' };
  if (!(await pushSupported())) return { ok: false, reason: '이 브라우저는 푸시를 못 씁니다. 아이폰은 홈 화면에 추가해야 됩니다.' };
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, reason: '알림을 먼저 켜 주세요.' };
  }
  try {
    // FCM 일꾼이 `/` 범위를 차지하면 PWA 일꾼과 서로 교체되며 앱이 무한 새로고침된다.
    // 알림 일꾼은 별도 범위에만 두고 getToken에 직접 넘긴다.
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/firebase-cloud-messaging-push-scope/',
    });
    const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (!token) return { ok: false, reason: '표를 받지 못했습니다. 알림 권한을 확인해 주세요.' };

    /*  **표만 담으면 누구 폰 건지 모른다**(2026-09-14 사장님 건).
     *
     *  이총제·이지영·남명숙·박은지·윤찬호 알림이 안 오는데 서버 로그는 `보냄 10/10` 이었다.
     *  표가 글자뿐이라 **사무실 PC 에 남은 표인지 그분 폰 표인지 가릴 수가 없었다** —
     *  안 보는 브라우저의 표도 FCM 은 영원히 성공으로 받아 준다. 알림은 그 PC 에 뜬다.
     *
     *  그래서 기기 이름과 담은 날짜를 같이 적는다. 마이페이지가 이걸 보여 주므로
     *  **"내 폰 표가 목록에 없다"를 본인이 바로 본다.**
     *
     *  `fcmTokens`(글자 배열)는 **그대로 둔다** — 보내는 쪽(functions)과 죽은 표 지우기가
     *  그 모양에 기대고 있어 한꺼번에 못 바꾼다. 옆에 딸림표(`fcmDevices`)를 둘 뿐이다.
     *  표 이름에는 `:` 이 들어가므로 점으로 끊기지 않게 `FieldPath` 로 적는다. */
    const ref = doc(db, COL.employees, employeeId);
    //  같은 표를 또 담아도 arrayUnion 이 한 번만 넣는다
    await updateDoc(ref, { fcmTokens: arrayUnion(token) });
    await updateDoc(ref, new FieldPath('fcmDevices', token), {
      name: currentDeviceLabel(), at: new Date().toISOString(),
    });
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: `푸시 등록 실패: ${e?.message ?? String(e)}` };
  }
}

/**
 * **이 폰을 뺀다 — 로그아웃할 때.**
 *
 * 안 빼면 **남의 알림이 이 폰으로 온다.** 한 폰을 여럿이 돌려 쓰면(사무실 공용 태블릿)
 * 먼저 쓰던 사람의 주문 알림이 다음 사람 폰에 계속 뜬다.
 *
 * 로그아웃 시점에는 표를 들고 있지 않으므로 **여기서 다시 받아서** 뺀다.
 * 표를 못 받아도(권한이 이미 꺼졌거나 브라우저가 못 쓰거나) 조용히 넘긴다 —
 * 로그아웃 자체는 막으면 안 된다.
 */
export async function unregisterPush(employeeId: string, token?: string): Promise<void> {
  try {
    const t = token ?? (await pushSupported()
      ? await getToken(getMessaging(app), { vapidKey: VAPID! }).catch(() => undefined)
      : undefined);
    if (!t) return;
    const ref = doc(db, COL.employees, employeeId);
    await updateDoc(ref, { fcmTokens: arrayRemove(t) });
    //  딸림표도 같이 지운다 — 표가 없는데 기기만 남으면 목록이 거짓말을 한다
    await updateDoc(ref, new FieldPath('fcmDevices', t), deleteField());
  } catch { /* 지우기 실패는 조용히 넘긴다 — 로그아웃을 막을 일이 아니다 */ }
}
