import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'items'));
let updated = 0, skipped = 0;

for (const d of snap.docs) {
  const data = d.data();
  if (!('용량' in data)) { skipped++; continue; }

  const patch = { spec: data.용량, 용량: deleteField() };
  await updateDoc(doc(db, 'items', d.id), patch);
  console.log(`  ${d.id} "${data.name}": 용량="${data.용량}" → spec`);
  updated++;
}

console.log(`\n완료: ${updated}건 이관, ${skipped}건 skip`);
process.exit(0);
