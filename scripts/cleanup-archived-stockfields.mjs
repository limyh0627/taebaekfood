import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};
const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'items'));
let deleted = 0, cleaned = 0;

for (const d of snap.docs) {
  const data = d.data();

  // archived 품목 삭제
  if (data.archived) {
    await deleteDoc(doc(db, 'items', d.id));
    console.log(`  [삭제] ${d.id} ${data.name}`);
    deleted++;
    continue;
  }

  // finishedStock / wipStock / itemType 필드 제거
  const patch = {};
  if ('finishedStock' in data) patch.finishedStock = deleteField();
  if ('wipStock'      in data) patch.wipStock      = deleteField();
  if ('itemType'      in data) patch.itemType      = deleteField();
  if ('archivedAt'    in data) patch.archivedAt    = deleteField();
  if ('archivedReason'in data) patch.archivedReason= deleteField();

  if (Object.keys(patch).length > 0) {
    await updateDoc(doc(db, 'items', d.id), patch);
    cleaned++;
  }
}

console.log(`\n완료: archived 삭제 ${deleted}건 / 필드 정리 ${cleaned}건`);
process.exit(0);
