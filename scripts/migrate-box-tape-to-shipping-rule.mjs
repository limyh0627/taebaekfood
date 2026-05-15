import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
  storageBucket: 'taebaek-3abe4.firebasestorage.app',
  messagingSenderId: '426912093935',
  appId: '1:426912093935:web:2bd399b729b553edf82d1a',
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

await signInAnonymously(auth);

const piSnap = await getDocs(collection(db, 'partner_item'));
const srSnap = await getDocs(collection(db, 'shipping_rule'));

const existingRules = srSnap.docs.map(d => ({ id: d.id, ...d.data() }));

let created = 0, skipped = 0, noBox = 0;

for (const piDoc of piSnap.docs) {
  const pi = { id: piDoc.id, ...piDoc.data() };
  const itemId    = pi.Item_ID    || pi.productId  || pi.item_id;
  const partnerId = pi.Partner_ID || pi.clientId;
  const boxId     = pi.boxTypeId;
  const tapeId    = pi.tapeTypeId;
  const qtyPer    = pi.qtyPerBox ?? pi.qty_per_box ?? 0;

  if (!boxId && !tapeId) { noBox++; continue; }
  if (!itemId || !partnerId) {
    console.log(`  [건너뜀] ID 없음: ${piDoc.id}`);
    skipped++;
    continue;
  }

  const already = existingRules.some(r => r.item_id === itemId && r.partner_id === partnerId);
  if (already) {
    console.log(`  [이미있음] item=${itemId} partner=${partnerId}`);
    skipped++;
    continue;
  }

  const newRule = {
    item_id:    itemId,
    partner_id: partnerId,
    box_item_id: boxId ?? '',
    qty_per_box: qtyPer,
    ...(tapeId ? { tape_item_id: tapeId } : {}),
  };
  await addDoc(collection(db, 'shipping_rule'), newRule);
  console.log(`  [생성] item=${itemId} partner=${partnerId} box=${boxId} tape=${tapeId ?? '-'} qty=${qtyPer}`);
  created++;
}

console.log(`\n완료: 생성 ${created}건 / 이미있음 ${skipped}건 / 박스없음 ${noBox}건`);
process.exit(0);
