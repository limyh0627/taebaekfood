import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const snap = await getDocs(collection(db, 'items'));
console.log('═══ 품목 필드에 "태백" 포함된 품목 ═══');
let n = 0;
for (const d of snap.docs) {
  const x = d.data();
  if ((x['품목'] ?? '').includes('태백')) {
    n++;
    console.log(`${d.id} | name: ${x.name} | 품목: ${x['품목']}`);
  }
}
console.log(`총 ${n}건`);

console.log('\n═══ 품목 필드가 있는 전체 품목 (참고) ═══');
let m = 0;
for (const d of snap.docs) {
  const x = d.data();
  if ((x['품목'] ?? '').trim()) {
    m++;
    if (!((x['품목'] ?? '').includes('태백'))) console.log(`${d.id} | name: ${x.name} | 품목: ${x['품목']}`);
  }
}
console.log(`품목 필드 보유: ${m}건`);
process.exit(0);
