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

// authReady: 익명 로그인 완료 후 Firestore 구독 시작
export const authReady: Promise<void> = signInAnonymously(auth).then(() => {}).catch(console.error) as Promise<void>;
