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

const COLS = [
  'items', 'partners', 'partner_item', 'shipping_rule',
  'item_bom', 'item_formula', 'orders',
];

for (const col of COLS) {
  const snap = await getDocs(collection(db, col));
  const fieldCounts = {};
  for (const d of snap.docs) {
    for (const k of Object.keys(d.data())) {
      fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
    }
  }
  const total = snap.size;
  const sorted = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n═══ ${col} (${total}건) ═══`);
  for (const [field, count] of sorted) {
    const pct = Math.round(count / total * 100);
    console.log(`  ${field.padEnd(25)} ${String(count).padStart(4)}건 (${String(pct).padStart(3)}%)`);
  }
}
process.exit(0);
