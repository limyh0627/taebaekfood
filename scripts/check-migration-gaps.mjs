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

const [piSnap, srSnap, itemsSnap, partnersSnap] = await Promise.all([
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'shipping_rule')),
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'partners')),
]);

const items    = Object.fromEntries(itemsSnap.docs.map(d => [d.id, d.data().name]));
const partners = Object.fromEntries(partnersSnap.docs.map(d => [d.id, d.data().name]));
const srSet    = new Set(srSnap.docs.map(d => {
  const r = d.data();
  return `${r.item_id}__${r.partner_id}`;
}));

console.log(`\npartner_item 총 ${piSnap.size}건 / shipping_rule 총 ${srSnap.size}건\n`);

// partner_item 중 boxTypeId 또는 tapeTypeId가 있는 것 → 마이그레이션 대상이었어야 함
const shouldHaveMigrated = [];
const missingBoxData     = []; // boxTypeId 없어서 원래 스킵됐어야 하는 것

for (const doc of piSnap.docs) {
  const pi = doc.data();
  const itemId    = pi.Item_ID    || pi.productId  || pi.item_id;
  const partnerId = pi.Partner_ID || pi.clientId   || pi.supplierId;
  const boxId     = pi.boxTypeId;
  const tapeId    = pi.tapeTypeId;
  const qtyPer    = pi.qtyPerBox ?? pi.qty_per_box;
  const direction = pi.Direction;

  if (!boxId && !tapeId) continue; // 박스/테이프 없는 건 원래 대상 아님

  if (!itemId || !partnerId) {
    console.log(`  [ID없음] ${doc.id}`);
    continue;
  }

  const key = `${itemId}__${partnerId}`;
  if (!srSet.has(key)) {
    shouldHaveMigrated.push({ docId: doc.id, itemId, partnerId, boxId, tapeId, qtyPer, direction });
  }
}

// shipping_rule 중 qty_per_box가 0 또는 없는 것
const zeroQty = srSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(r => !r.qty_per_box || r.qty_per_box === 0);

// shipping_rule 중 box_item_id가 비어있는 것
const noBox = srSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(r => !r.box_item_id);

console.log('═══ 마이그레이션 누락 (partner_item에 박스 있는데 shipping_rule 없는 것) ═══');
if (shouldHaveMigrated.length === 0) {
  console.log('  없음 ✓');
} else {
  for (const r of shouldHaveMigrated) {
    const iname = items[r.itemId] ?? r.itemId;
    const pname = partners[r.partnerId] ?? r.partnerId;
    console.log(`  [누락] ${iname} / ${pname}  (box=${r.boxId ?? '-'} tape=${r.tapeId ?? '-'} qty=${r.qtyPer ?? '-'} dir=${r.direction ?? '-'})`);
  }
  console.log(`  → 총 ${shouldHaveMigrated.length}건 누락`);
}

console.log('\n═══ shipping_rule 중 박스당수량이 0 또는 없는 것 ═══');
if (zeroQty.length === 0) {
  console.log('  없음 ✓');
} else {
  for (const r of zeroQty) {
    const iname = items[r.item_id] ?? r.item_id;
    const pname = r.partner_id ? (partners[r.partner_id] ?? r.partner_id) : '전체(기본)';
    console.log(`  [qty=0] ${iname} / ${pname}  (rule id: ${r.id})`);
  }
  console.log(`  → 총 ${zeroQty.length}건`);
}

console.log('\n═══ shipping_rule 중 박스 품목이 없는 것 ═══');
if (noBox.length === 0) {
  console.log('  없음 ✓');
} else {
  for (const r of noBox) {
    const iname = items[r.item_id] ?? r.item_id;
    const pname = r.partner_id ? (partners[r.partner_id] ?? r.partner_id) : '전체(기본)';
    console.log(`  [박스없음] ${iname} / ${pname}  (rule id: ${r.id})`);
  }
  console.log(`  → 총 ${noBox.length}건`);
}

process.exit(0);
