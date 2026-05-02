/**
 * @shared-move  shared/src/firebase.ts
 * Firebase 초기화 — 직원 앱·관리자 앱이 동일한 Firestore 프로젝트를 공유합니다.
 * Phase 2 앱 분리 시 이 파일을 shared/ 로 이동하고 양쪽 앱에서 import합니다.
 */
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

signInAnonymously(auth).catch(console.error);

// authReady: 이미 구독이 즉시 시작되므로 항상 즉시 resolve
export const authReady: Promise<void> = Promise.resolve();
