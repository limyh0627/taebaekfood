import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { arrayUnion, arrayRemove, doc, updateDoc } from 'firebase/firestore';
import { app, db } from './firebase';
import { COL } from './collections';

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
 * 이 폰의 표를 받아 직원 기록에 담는다.
 *
 * **알림 권한이 이미 켜져 있어야 한다** — 여기서 묻지 않는다(묻는 자리는 마이페이지 하나다).
 * @param employeeId 로그인한 사람
 */
export async function registerPush(employeeId: string): Promise<PushResult> {
  if (!VAPID) return { ok: false, reason: '웹 푸시 인증서(VAPID)가 설정돼 있지 않습니다.' };
  if (!(await pushSupported())) return { ok: false, reason: '이 브라우저는 푸시를 못 씁니다. 아이폰은 홈 화면에 추가해야 됩니다.' };
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, reason: '알림을 먼저 켜 주세요.' };
  }
  try {
    //  FCM 은 제 서비스워커를 따로 쓴다 — 워크박스 것과 안 부딪히게 직접 등록해 넘긴다
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (!token) return { ok: false, reason: '표를 받지 못했습니다. 알림 권한을 확인해 주세요.' };

    //  같은 표를 또 담아도 arrayUnion 이 한 번만 넣는다
    await updateDoc(doc(db, COL.employees, employeeId), { fcmTokens: arrayUnion(token) });
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: `푸시 등록 실패: ${e?.message ?? String(e)}` };
  }
}

/** 이 폰을 뺀다 — 로그아웃할 때. 안 빼면 남의 알림이 이 폰으로 온다. */
export async function unregisterPush(employeeId: string, token: string): Promise<void> {
  try { await updateDoc(doc(db, COL.employees, employeeId), { fcmTokens: arrayRemove(token) }); }
  catch { /* 지우기 실패는 조용히 넘긴다 — 다음 로그인 때 다시 담긴다 */ }
}
