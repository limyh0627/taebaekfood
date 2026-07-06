// Storage 업로드 진단: 익명 로그인 후 inbound/ 와 file-cabinet/ 경로에 업로드 시도
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadBytes, deleteObject } from 'firebase/storage';

const cfg = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
  storageBucket: 'taebaek-3abe4.firebasestorage.app',
  messagingSenderId: '426912093935',
  appId: '1:426912093935:web:2bd399b729b553edf82d1a',
};

const app = initializeApp(cfg);
const auth = getAuth(app);
const storage = getStorage(app);

const data = new Uint8Array([116, 101, 115, 116]); // "test"

async function tryPath(path) {
  const r = ref(storage, path);
  try {
    await uploadBytes(r, data);
    console.log(`✅ 업로드 성공: ${path}`);
    await deleteObject(r).catch(() => {});
    return true;
  } catch (e) {
    console.log(`❌ 업로드 실패: ${path}`);
    console.log(`   code: ${e?.code}`);
    console.log(`   message: ${e?.message}`);
    return false;
  }
}

try {
  const cred = await signInAnonymously(auth);
  console.log(`익명 로그인 OK (uid=${cred.user.uid})`);
} catch (e) {
  console.log(`익명 로그인 실패: ${e?.code} ${e?.message}`);
  process.exit(1);
}

await tryPath(`inbound/_diag/${Date.now()}.txt`);
await tryPath(`file-cabinet/진단/_diag/${Date.now()}.txt`);
process.exit(0);
