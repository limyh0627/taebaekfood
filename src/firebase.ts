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

// 앱 로드 시 Firebase 익명 인증 → Firestore 룰에서 request.auth != null 사용 가능
signInAnonymously(auth).catch(console.error);
