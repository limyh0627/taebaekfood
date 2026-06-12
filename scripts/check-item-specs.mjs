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
console.log(`총 ${snap.size}개 품목\n`);
console.log('id | name | category | subtype | spec | 용량 | unit');
console.log('---');
for (const d of snap.docs) {
  const x = d.data();
  console.log(`${d.id} | ${x.name} | ${x.category ?? ''} | ${x.subtype ?? ''} | ${x.spec ?? ''} | ${x['용량'] ?? ''} | ${x.unit ?? ''}`);
}

process.exit(0);
