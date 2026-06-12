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

const [itemsSnap, piSnap, partnersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'partners')),
]);
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));

const partner = partnersSnap.docs.find(d => (d.data().name ?? '').includes('비손'));
if (!partner) { console.log('비손유통 거래처 없음'); process.exit(1); }
const pid = partner.id;
console.log(`거래처: ${partner.data().name} (${pid})\n`);

console.log('═══ partner_item (Direction=out) — 카운트(8)의 근거 ═══');
const outRows = piSnap.docs.filter(d => {
  const x = d.data();
  return (x.Partner_ID ?? x.partnerId) === pid && (x.Direction ?? 'out') === 'out';
});
for (const d of outRows) {
  const x = d.data();
  const iid = x.Item_ID ?? x.itemId;
  const it = itemMap.get(iid);
  const inPartnerIds = it ? ((it.partnerIds ?? []).includes(pid) ? 'partnerIds에 있음' : '✗ partnerIds에 없음') : '';
  console.log(`  ${d.id}`);
  console.log(`    → 품목 ${iid}: ${it ? `${it.name} [${it.category}]${it.archived ? ' (archived)' : ''} | ${inPartnerIds}` : '✗ 삭제된 품목'}`);
}
console.log(`총 ${outRows.length}건`);

console.log('\n═══ 품목 partnerIds 기준 — 상세 목록(5)의 근거 ═══');
let n = 0;
for (const [id, it] of itemMap) {
  if ((it.partnerIds ?? []).includes(pid)) {
    n++;
    console.log(`  ${id}: ${it.name} [${it.category}]${it.archived ? ' (archived)' : ''}`);
  }
}
console.log(`총 ${n}건`);
process.exit(0);
