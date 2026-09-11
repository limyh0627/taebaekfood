/**
 * @shared-move  shared/src/firebase.ts
 * Firebase 초기화 — 직원 앱·관리자 앱이 동일한 Firestore 프로젝트를 공유합니다.
 * Phase 2 앱 분리 시 이 파일을 shared/ 로 이동하고 양쪽 앱에서 import합니다.
 */
import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { assertLocalEmulatorTarget } from './firebaseEmulatorSafety';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

//  FCM 이 이 앱 인스턴스를 쓴다(shared/push) — 두 번 초기화하면 표를 두 벌 받는다
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

/** 로컬 검수는 demo 프로젝트와 에뮬레이터를 함께 써야만 켜진다. 운영 프로젝트로 우회 연결하지 않는다. */
export const usingFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
if (usingFirebaseEmulators) {
  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  assertLocalEmulatorTarget(firebaseConfig.projectId, host);
  connectFirestoreEmulator(db, host, 8082);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectStorageEmulator(storage, host, 9199);
}

/**
 * **익명 로그인 — 될 때까지 다시 걸고, 풀리면 다시 건다.**
 *
 * 2026-09-11 사장님이 전표를 저장하다 받은 창:
 *   "전표 또는 거래처 단가 저장에 실패했습니다 … Missing or insufficient permissions."
 *
 * 규칙은 **인증만 되어 있으면 다 열려 있다**(firestore.rules). 그러니 저 글은 곧
 * **그 순간 로그인이 빠져 있었다**는 뜻이다. 여기가 그렇게 만들고 있었다 —
 *
 *     signInAnonymously(auth).then(() => {}).catch(console.error)
 *
 * 한 번만 걸고, 실패하면 **조용히 삼킨다**(콘솔에만 찍는다). 그런데 `authReady` 는 그래도
 * 이어지니 구독이 시작되고, Firestore 가 **캐시에 있던 것을 그대로 그려 준다.**
 * 그래서 화면은 멀쩡해 보이고 **쓰기만 전부 막힌다** — 사장님이 본 그림이다.
 * 앱을 켤 때 잠깐 끊겼거나(현장 와이파이), 나중에 토큰 갱신이 실패하면 이렇게 된다.
 *
 * 그래서 두 가지를 한다.
 *   ① **다시 건다** — 몇 번, 점점 뜸하게. 잠깐 끊긴 것은 이걸로 넘어간다.
 *   ② **풀리면 또 건다** — `onAuthStateChanged` 가 빈 사용자를 주면 새로 건다.
 *      쓰다가 세션이 죽는 경우가 여기에 걸린다.
 *
 * `authReady` 는 **실패해도 이어진다.** 영영 안 이어지면 화면이 통째로 안 뜬다 —
 * 읽기라도 캐시로 되는 편이 낫다. 대신 `isSignedIn()` 으로 지금 상태를 물어볼 수 있게 해
 * 쓰는 쪽이 "로그인이 풀렸다"고 제대로 말할 수 있게 한다.
 */
const 로그인걸기 = async (): Promise<void> => {
  for (let 번째 = 0; 번째 < 5; 번째 += 1) {
    try { await signInAnonymously(auth); return; }
    catch (error) {
      console.error(`[인증] 익명 로그인 실패 (${번째 + 1}/5)`, error);
      //  0.5초 → 1 → 2 → 4초. 현장 와이파이가 돌아올 만큼만 기다린다.
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** 번째));
    }
  }
  console.error('[인증] 익명 로그인을 끝내 못 걸었다 — 저장이 막힌다');
};

export const authReady: Promise<void> = 로그인걸기();

/** 지금 로그인돼 있나 — 쓰기 전에 물어보면 "권한 없음" 대신 제대로 된 말을 할 수 있다. */
export const isSignedIn = (): boolean => auth.currentUser !== null;

//  쓰는 도중에 세션이 죽으면 다시 건다. 안 걸면 그때부터 모든 쓰기가 조용히 막힌다.
auth.onAuthStateChanged(user => { if (!user) void 로그인걸기(); });
