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

const TARGET = 'p-102';
const COLS = [
  'items', 'partner_item', 'shipping_rule', 'item_bom', 'item_formula',
  'orders', 'purchaseOrders', 'issuedStatements', 'partners',
  'adjustmentRequests', 'rawMaterialLedger',
];

for (const col of COLS) {
  let snap;
  try { snap = await getDocs(collection(db, col)); } catch { console.log(`(${col}: 접근 불가)`); continue; }
  const hits = [];
  for (const d of snap.docs) {
    const json = JSON.stringify({ _id: d.id, ...d.data() });
    // "p-102" 정확 일치(필드값) 또는 doc id에 포함 (p-1020... 같은 오탐 방지)
    if (json.includes(`"${TARGET}"`) || d.id === TARGET || d.id.includes(`${TARGET}_`) || d.id.includes(`-${TARGET}-`) || d.id.endsWith(`-${TARGET}`)) {
      hits.push(d);
    }
  }
  if (hits.length === 0) continue;
  console.log(`\n═══ ${col}: ${hits.length}건 ═══`);
  for (const d of hits.slice(0, 8)) {
    const x = d.data();
    if (col === 'orders') {
      const lines = (x.items ?? []).filter(i => i.itemId === TARGET);
      console.log(`  ${d.id} | ${x.partnerName} | ${(x.deliveredAt ?? x.createdAt ?? '').slice(0,10)} | ${lines.map(l => `${l.name} ×${l.quantity}`).join(', ')}`);
    } else if (col === 'partner_item') {
      console.log(`  ${d.id} | 단가: ${x.price ?? '-'} | ${JSON.stringify(x).slice(0, 160)}`);
    } else {
      console.log(`  ${d.id} | ${JSON.stringify(x).slice(0, 200)}`);
    }
  }
  if (hits.length > 8) console.log(`  ... 외 ${hits.length - 8}건`);
}
console.log('\n끝');
process.exit(0);
