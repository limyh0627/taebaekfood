// 거래처(partners)에서 "혜성" 검색 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'partners'));
const hits = [];
snap.forEach(d => {
  const p = d.data();
  const name = String(p.name ?? '');
  if (name.includes('혜성')) hits.push({ id: d.id, ...p });
});
console.log(`"혜성" 포함 거래처: ${hits.length}건`);
for (const p of hits) {
  console.log(`\n■ ${p.name} (partners/${p.id})`);
  console.log(`  유형: ${p.partnerType ?? p.type ?? '-'} / 지역: ${p.region ?? p.address ?? '-'}`);
  console.log(`  전화: ${p.phone ?? '-'} / 담당: ${p.contactPerson ?? '-'}`);
  console.log(`  사업자: ${p.businessNumber ?? '-'} / 메모: ${p.memo ?? p.note ?? '-'}`);
}
process.exit(0);
