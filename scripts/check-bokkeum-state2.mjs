// 볶음참깨 품목 정리 후 상태 재검증 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'items'));
const hits = [];
snap.forEach(d => { const it = d.data(); if (String(it.name ?? '').includes('볶음참깨')) hits.push({ id: d.id, ...it }); });
hits.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
for (const it of hits) {
  console.log(`■ ${it.name} (${it.id})${it.archived ? ' [보관]' : ''}`);
  console.log(`   cat=${it.category} unit=${it.unit} stock=${it.stock} spec=${it.spec ?? '-'} 품목=${it['품목'] ?? '-'}`);
  console.log(`   완사입=${it.procureType ?? '-'} unpackTo=${JSON.stringify(it.unpackTo ?? null)} rawMaterialName=${it.rawMaterialName ?? '-'} isSmartStore=${it.isSmartStore ?? '-'} smartPrice=${it.smartStorePrice ?? '-'}`);
  console.log(`   submaterials=${it.submaterials ? it.submaterials.length + '개' : '없음!'} partnerIds=${(it.partnerIds ?? []).length}개`);
}
process.exit(0);
