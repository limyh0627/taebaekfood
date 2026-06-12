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

const [piSnap, poSnap] = await Promise.all([
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'purchaseOrders')),
]);

// f2, f5 관련 partner_item 모든 raw 데이터
console.log('═══ partner_item RAW (f2, f5 관련) ═══');
for (const d of piSnap.docs) {
  const data = d.data();
  const allValues = Object.values(data).join(' ');
  if (d.id.includes('f2') || d.id.includes('f5') ||
      allValues.includes('f2') || allValues.includes('f5')) {
    console.log(`\n  docId: ${d.id}`);
    console.log(`  data:`, JSON.stringify(data, null, 2));
  }
}

// purchaseOrders 전체 raw
console.log('\n═══ purchaseOrders RAW (전체) ═══');
for (const d of poSnap.docs) {
  console.log(`\n  docId: ${d.id}`);
  console.log(`  data:`, JSON.stringify(d.data(), null, 2));
}

process.exit(0);
