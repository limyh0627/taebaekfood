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

const [itemsSnap, bomSnap, ordersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'item_bom')),
  getDocs(collection(db, 'orders')),
]);
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));

const TARGETS = ['유통가교', '비손유통', '늘푸른농산'];
for (const d of ordersSnap.docs) {
  const o = d.data();
  if (o.deliveredAt) continue;
  if (!TARGETS.some(t => (o.partnerName ?? '').includes(t))) continue;
  console.log(`\n═══ 주문 ${d.id} (${o.partnerName}) ═══`);
  for (const oi of o.items ?? []) {
    const it = itemMap.get(oi.itemId);
    console.log(`  ▸ ${oi.name} (itemId: ${oi.itemId})`);
    if (!it) { console.log('    ✗ 품목 없음'); continue; }
    // BOM
    const boms = bomSnap.docs.filter(b => b.data().parent_id === oi.itemId);
    for (const b of boms) {
      const cid = b.data().child_id;
      const child = itemMap.get(cid);
      console.log(`    BOM: ${cid} → ${child ? `${child.name} [${child.subtype ?? child.category}]` : '✗ 삭제됨'}`);
    }
    if (boms.length === 0) console.log('    BOM: 없음');
    // 구성품 스냅샷
    for (const s of it.submaterials ?? []) {
      const cur = itemMap.get(s.id);
      console.log(`    스냅샷: ${s.name} [${s.category}] (id: ${s.id} ${cur ? '존재' : '✗ 삭제됨'})`);
    }
    if (!(it.submaterials ?? []).length) console.log('    스냅샷: 없음');
  }
}
process.exit(0);
