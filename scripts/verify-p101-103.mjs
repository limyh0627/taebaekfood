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

const [itemsSnap, srSnap, piSnap, bomSnap, partnersSnap, ordersSnap, stmtSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'shipping_rule')),
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'item_bom')),
  getDocs(collection(db, 'partners')),
  getDocs(collection(db, 'orders')),
  getDocs(collection(db, 'issuedStatements')),
]);
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));
const iname = (id) => itemMap.get(id)?.name ?? id;
const pname = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));
const bison = partnersSnap.docs.find(d => (d.data().name ?? '').includes('비손'))?.id;

// ── 1. p-101 주문 기록: 어느 거래처가 주문했나 ──────────────────
console.log('═══ p-101 주문 기록 (거래처별) ═══');
const p101Orders = new Map();
for (const d of ordersSnap.docs) {
  const o = d.data();
  for (const oi of o.items ?? []) {
    if (oi.itemId === 'p-101') {
      const k = o.partnerName ?? '?';
      p101Orders.set(k, (p101Orders.get(k) ?? 0) + 1);
    }
  }
}
for (const [k, n] of p101Orders) console.log(`  ${k}: ${n}건`);

// ── 2. 들기름 1800ml 후보 비교 (BOM 상세 + 비손유통 포장설정 유무) ──
console.log('\n═══ 들기름/생들기름 1800ml 후보 상세 ═══');
for (const id of ['p-298', 'p-311', 'p-63']) {
  const x = itemMap.get(id);
  const boms = bomSnap.docs.filter(d => d.data().parent_id === id).map(d => iname(d.data().child_id));
  const snaps = (x.submaterials ?? []).map(s => `${s.name}[${s.category}]`);
  const rules = srSnap.docs.filter(d => d.data().item_id === id);
  const bisonRule = rules.find(d => d.data().partner_id === bison);
  const linkedPartners = piSnap.docs.filter(d => (d.data().Item_ID ?? d.data().itemId) === id).map(d => pname.get(d.data().Partner_ID ?? d.data().partnerId));
  console.log(`  ${id} "${x.name}"`);
  console.log(`    BOM: ${boms.join(', ') || '없음'}`);
  console.log(`    구성품 스냅샷: ${snaps.join(', ') || '없음'}`);
  console.log(`    비손유통 포장설정: ${bisonRule ? `${iname(bisonRule.data().box_item_id)}×${bisonRule.data().qty_per_box}, 테이프 ${iname(bisonRule.data().tape_item_id)}` : '없음'}`);
  console.log(`    연결 거래처: ${linkedPartners.join(', ') || '없음'}`);
}

// ── 3. 비손유통 거래 이력 전체 품목 (p-103 추적) ─────────────────
console.log('\n═══ 비손유통 주문 이력에 등장한 품목 전체 ═══');
const bisonItems = new Map(); // name → { count, itemIds }
for (const d of ordersSnap.docs) {
  const o = d.data();
  if (!(o.partnerName ?? '').includes('비손') && o.partnerId !== bison) continue;
  for (const oi of o.items ?? []) {
    const k = oi.name ?? oi.itemId;
    if (!bisonItems.has(k)) bisonItems.set(k, { count: 0, ids: new Set() });
    bisonItems.get(k).count++;
    if (oi.itemId) bisonItems.get(k).ids.add(oi.itemId);
  }
}
for (const [k, v] of bisonItems) console.log(`  ${k} ×${v.count}  (${[...v.ids].map(id => `${id}${itemMap.has(id) ? '' : '✗삭제'}`).join(', ')})`);

console.log('\n═══ 비손유통 매출전표 품목명 전체 ═══');
const stmtNames = new Map();
for (const d of stmtSnap.docs) {
  const s = d.data();
  if (!(s.partnerName ?? '').includes('비손')) continue;
  for (const it of s.items ?? []) stmtNames.set(it.name, (stmtNames.get(it.name) ?? 0) + 1);
}
for (const [k, n] of stmtNames) console.log(`  ${k} ×${n}`);

// ── 4. p-103이 다른 컬렉션 어디에든 있나 (정밀) ──────────────────
console.log('\n═══ p-103 전체 컬렉션 정밀 스캔 ═══');
const COLS = { items: itemsSnap, shipping_rule: srSnap, partner_item: piSnap, item_bom: bomSnap, orders: ordersSnap, issuedStatements: stmtSnap };
for (const [col, snap] of Object.entries(COLS)) {
  const hits = snap.docs.filter(d => JSON.stringify(d.data()).includes('"p-103"') || d.id.includes('p-103'));
  if (hits.length) console.log(`  ${col}: ${hits.map(d => d.id).join(', ')}`);
}
process.exit(0);
