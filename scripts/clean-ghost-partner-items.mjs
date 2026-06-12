/**
 * 삭제된 품목을 가리키는 partner_item 유령 연결 정리
 *  - Item_ID/itemId가 items 컬렉션에 없는 partner_item 문서 삭제
 *  - 거래처 품목 카운트와 실제 목록 불일치의 원인
 *
 * 사용법:
 *   node scripts/clean-ghost-partner-items.mjs          # 드라이런
 *   node scripts/clean-ghost-partner-items.mjs --apply  # 실제 삭제
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');

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
const itemIds = new Set(itemsSnap.docs.map(d => d.id));
const partnerName = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));

const ghosts = [];
for (const d of piSnap.docs) {
  const x = d.data();
  const iid = x.Item_ID ?? x.itemId;
  if (!iid || !itemIds.has(iid)) {
    ghosts.push({ id: d.id, itemId: iid ?? '(없음)', partner: partnerName.get(x.Partner_ID ?? x.partnerId) ?? (x.Partner_ID ?? x.partnerId), dir: x.Direction ?? 'out' });
  }
}

console.log(`═══ 유령 partner_item 연결: ${ghosts.length}건 ═══`);
const byPartner = new Map();
for (const g of ghosts) {
  if (!byPartner.has(g.partner)) byPartner.set(g.partner, []);
  byPartner.get(g.partner).push(g);
}
for (const [p, list] of [...byPartner.entries()].sort()) {
  console.log(`  ${p}: ${list.length}건 (${list.map(g => `${g.itemId}[${g.dir}]`).join(', ')})`);
}

if (!APPLY) {
  console.log('\n(드라이런 — 삭제하려면 --apply)');
  process.exit(0);
}

for (let i = 0; i < ghosts.length; i += 400) {
  const batch = writeBatch(db);
  for (const g of ghosts.slice(i, i + 400)) batch.delete(doc(db, 'partner_item', g.id));
  await batch.commit();
}
console.log(`\n✅ ${ghosts.length}건 삭제 완료`);
process.exit(0);
