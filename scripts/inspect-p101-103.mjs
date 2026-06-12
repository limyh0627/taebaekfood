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

const [itemsSnap, srSnap, piSnap, bomSnap, partnersSnap, ordersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'shipping_rule')),
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'item_bom')),
  getDocs(collection(db, 'partners')),
  getDocs(collection(db, 'orders')),
]);
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));
const pname = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));
const iname = (id) => itemMap.get(id)?.name ?? id;

for (const TARGET of ['p-102', 'p-101', 'p-103']) {
  console.log(`\n████ ${TARGET} ████`);
  // 포장 설정
  const rules = srSnap.docs.filter(d => d.data().item_id === TARGET);
  console.log(`─ 포장 설정 ${rules.length}건:`);
  for (const d of rules) {
    const r = d.data();
    console.log(`  ${pname.get(r.partner_id) ?? r.partner_id ?? '(전체기본)'}: 박스 ${r.box_item_id ? iname(r.box_item_id) : '없음'} × ${r.qty_per_box}개입, 테이프 ${r.tape_item_id ? iname(r.tape_item_id) : '없음'}`);
  }
  // 거래처 연결
  const links = piSnap.docs.filter(d => (d.data().Item_ID ?? d.data().itemId) === TARGET);
  console.log(`─ 거래처 연결 ${links.length}건: ${links.map(d => pname.get(d.data().Partner_ID ?? d.data().partnerId) ?? '?').join(', ')}`);
  // BOM
  const boms = bomSnap.docs.filter(d => d.data().parent_id === TARGET);
  console.log(`─ BOM: ${boms.map(d => `${iname(d.data().child_id)} ×${d.data().quantity}`).join(', ') || '없음'}`);
  // 주문 기록 이름
  let nm = null; let cnt = 0;
  for (const d of ordersSnap.docs) for (const oi of d.data().items ?? []) if (oi.itemId === TARGET) { nm = nm ?? oi.name; cnt++; }
  console.log(`─ 주문기록: ${cnt}건, 이름 "${nm ?? '복원 실패'}"`);
}

console.log('\n████ 현재 볶음참깨 계열 품목 ████');
for (const [id, x] of itemMap) {
  if ((x.name ?? '').includes('볶음참깨') && !x.archived) {
    const rules = srSnap.docs.filter(d => d.data().item_id === id).length;
    const links = piSnap.docs.filter(d => (d.data().Item_ID ?? d.data().itemId) === id).length;
    console.log(`  ${id}: ${x.name} [${x.category}] — 포장설정 ${rules}건, 거래처연결 ${links}건`);
  }
}
console.log('\n████ 현재 들기름 1800ml 계열 ████');
for (const [id, x] of itemMap) {
  if ((x.name ?? '').includes('들기름') && (x.spec === '1800ml') && !x.archived) {
    const rules = srSnap.docs.filter(d => d.data().item_id === id).length;
    const links = piSnap.docs.filter(d => (d.data().Item_ID ?? d.data().itemId) === id).length;
    console.log(`  ${id}: ${x.name} — 포장설정 ${rules}건, 거래처연결 ${links}건, 품목필드 ${x['품목'] ?? '-'}`);
  }
}
process.exit(0);
