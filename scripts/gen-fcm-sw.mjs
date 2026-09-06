//  .env 를 읽어 public/firebase-messaging-sw.js 를 만든다.
//  서비스워커는 모듈을 못 읽어서 설정값을 파일에 박아야 한다 — 손으로 두 벌 적지 않으려고
//  빌드 전에 여기서 만든다(package.json 의 prebuild).
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(String.fromCharCode(10))
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const need = ['VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET','VITE_FIREBASE_MESSAGING_SENDER_ID','VITE_FIREBASE_APP_ID'];
const 없는것 = need.filter(k => !env[k]);
if (없는것.length) { console.error('.env 에 없다:', 없는것.join(', ')); process.exit(1); }

const cfg = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const tpl = readFileSync('scripts/firebase-messaging-sw.template.js', 'utf8');
writeFileSync('public/firebase-messaging-sw.js', tpl.replace('__CONFIG__', JSON.stringify(cfg, null, 2)), 'utf8');
console.log('public/firebase-messaging-sw.js 만듦');
