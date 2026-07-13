// 들향기름골드 품목의 박스 수량 필드 확인 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'items'));
const hits = [];
snap.forEach(d => {
  const it = d.data();
  const name = String(it.name ?? '');
  if (name.includes('들향') && name.includes('골드')) hits.push({ id: d.id, ...it });
});
for (const it of hits) {
  console.log(`\n■ ${it.id} — ${it.name} (category=${it.category}, archived=${it.archived ?? false})`);
  console.log(`  unitsPerBox=${it.unitsPerBox ?? '-'}  boxSize=${it.boxSize ?? '-'}  defaultBoxConfig=${JSON.stringify(it.defaultBoxConfig ?? null)}  spec=${it.spec ?? '-'}`);
}
// partner_item(out) 쪽 qtyPerBox 오버라이드 존재 여부
for (const it of hits) {
  const ps = await getDocs(query(collection(db, 'partner_item'), where('itemId', '==', it.id)));
  const rows = [];
  ps.forEach(p => { const v = p.data(); if (v.qtyPerBox != null) rows.push(`${p.id}: partnerId=${v.partnerId} qtyPerBox=${v.qtyPerBox}`); });
  console.log(`\n${it.name} — partner_item qtyPerBox 지정 ${rows.length}건`);
  rows.forEach(r => console.log('  ' + r));
}
process.exit(0);
