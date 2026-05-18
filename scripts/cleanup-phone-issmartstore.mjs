import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
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

// ── 1. partners: phone → mobile 이관, phone 삭제
{
  const snap = await getDocs(collection(db, 'partners'));
  let migrated = 0, skipped = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (!data.phone) { skipped++; continue; }
    const patch = { phone: deleteField() };
    // mobile이 없을 때만 phone 값을 mobile로 복사
    if (!data.mobile) patch.mobile = data.phone;
    await updateDoc(doc(db, 'partners', d.id), patch);
    migrated++;
    console.log(`  [partners] ${data.name}: phone="${data.phone}" → ${!data.mobile ? `mobile="${data.phone}"` : 'mobile 이미있음'}, phone 삭제`);
  }
  console.log(`\n[partners] phone→mobile 완료: ${migrated}건 처리, ${skipped}건 skip`);
}

// ── 2. partner_item: isSmartStore 삭제
{
  const snap = await getDocs(collection(db, 'partner_item'));
  let updated = 0;
  for (const d of snap.docs) {
    if (!('isSmartStore' in d.data())) continue;
    await updateDoc(doc(db, 'partner_item', d.id), { isSmartStore: deleteField() });
    updated++;
  }
  console.log(`\n[partner_item] isSmartStore 삭제: ${updated}건`);
}

console.log('\n완료');
process.exit(0);
