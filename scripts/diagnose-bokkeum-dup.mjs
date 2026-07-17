// 볶음참깨 / 1KG-볶음참깨 이중화 진단 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'items'));
const all = [];
snap.forEach(d => all.push({ id: d.id, ...d.data() }));

console.log('=== 이름에 "볶음참깨" 포함 품목 전부 ===');
const hits = all.filter(i => String(i.name ?? '').includes('볶음참깨'));
for (const it of hits) {
  console.log(`\n■ ${it.name} (items/${it.id})`);
  console.log(`  category=${it.category} subtype=${it.subtype ?? '-'} unit=${it.unit ?? '-'} stock=${it.stock}`);
  console.log(`  archived=${it.archived ?? false} isRawMaterial=${it.isRawMaterial ?? false} rawMaterialName=${it.rawMaterialName ?? '-'} spec=${it.spec ?? '-'}`);
  console.log(`  lots=${(it.lots ?? []).length}개`);
}

console.log('\n=== 각 품목을 BOM(submaterials)으로 참조하는 완제품 ===');
for (const target of hits) {
  const refs = all.filter(p => (p.submaterials ?? []).some(s => s.id === target.id));
  console.log(`\n${target.name} (${target.id}) ← ${refs.length}개 제품이 참조:`);
  refs.slice(0, 10).forEach(p => console.log(`  - ${p.name} (${p.id}, ${p.category})`));
  if (refs.length > 10) console.log(`  ... 외 ${refs.length - 10}개`);
}

console.log('\n=== 대기 중인 발주필요 알림 ===');
const ar = await getDocs(query(collection(db, 'adjustmentRequests'), where('type', '==', 'reorder_alert'), where('status', '==', 'pending')));
ar.forEach(d => { const r = d.data(); console.log(`  ${r.itemName} (itemId=${r.itemId}): 부족 ${r.requestedQuantity}${r.unit} — ${r.reason}`); });
process.exit(0);
