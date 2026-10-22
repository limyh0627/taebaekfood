import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const FIREBASE_FIELDS = [
  ['VITE_FIREBASE_API_KEY', 'apiKey'],
  ['VITE_FIREBASE_AUTH_DOMAIN', 'authDomain'],
  ['VITE_FIREBASE_PROJECT_ID', 'projectId'],
  ['VITE_FIREBASE_STORAGE_BUCKET', 'storageBucket'],
  ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'messagingSenderId'],
  ['VITE_FIREBASE_APP_ID', 'appId'],
] as const;
export const FIREBASE_BUILD_VARIABLES = [...FIREBASE_FIELDS.map(([name]) => name), 'VITE_FIREBASE_VAPID_KEY'] as const;
export type FirebaseWorkerConfig = Record<(typeof FIREBASE_FIELDS)[number][1], string>;

/** Vite가 mode/envDir/프로세스 우선순위까지 적용한 값만 검사한다. 값은 오류에 넣지 않는다. */
export function validateFirebaseBuildEnvironment(env: Record<string, unknown>, mode: string): FirebaseWorkerConfig {
  const missing = FIREBASE_BUILD_VARIABLES.filter(name => typeof env[name] !== 'string' || !(env[name] as string).trim());
  if (missing.length) throw new Error('Firebase 빌드 환경 확인 실패 (mode: ' + mode + '): ' + missing.join(', '));
  return Object.fromEntries(FIREBASE_FIELDS.map(([name, field]) => [field, env[name]])) as FirebaseWorkerConfig;
}

/** VAPID는 창의 getToken 설정이며 서비스워커 Firebase 설정에 복사하지 않는다. */
export function renderFirebaseMessagingWorker(config: FirebaseWorkerConfig, template: string): string {
  if (template.split('__CONFIG__').length !== 2) throw new Error('FCM 서비스워커 템플릿의 설정 위치를 확인해 주세요.');
  const workerConfig = Object.fromEntries(FIREBASE_FIELDS.map(([, field]) => [field, config[field]]));
  return template.replace('__CONFIG__', JSON.stringify(workerConfig, null, 2));
}

/** npm 스크립트를 거치지 않는 직접 vite build도 같은 검증과 산출물을 사용한다. */
export function firebaseBuildEnvironment(projectDir: string): Plugin {
  let source: string | undefined;
  return {
    name: 'firebase-build-environment',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      const firebase = validateFirebaseBuildEnvironment(config.env, config.mode);
      const template = readFileSync(resolve(projectDir, 'scripts/firebase-messaging-sw.template.js'), 'utf8');
      source = renderFirebaseMessagingWorker(firebase, template);
    },
    generateBundle() {
      if (source === undefined) throw new Error('Firebase 빌드 환경 검증이 완료되지 않았습니다.');
      this.emitFile({ type: 'asset', fileName: 'firebase-messaging-sw.js', source });
    },
  };
}
