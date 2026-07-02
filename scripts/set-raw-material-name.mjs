// 청정식품 매입 SKU 2건에 rawMaterialName 지정 — 입고 시 원료 로트로 귀속되도록 (사용자 요청 2026-07-02)
// 이름 변경 대신 rawReceipt.ts:rawLotTarget이 우선 참조하는 전용 필드 사용 (옛 전표 이름 매칭 안 깨짐)
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const TARGETS = [
  { id: 'p-108', raw: '볶음검정참깨' },              // "시골향 볶음검정참깨-벌크/20kg"
  { id: 'p-1780646377919', raw: '볶음참깨' },        // "볶음참깨-자루/20kg"
];

for (const t of TARGETS) {
  const ref = doc(db, 'items', t.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) { console.log(`❌ ${t.id} 없음`); continue; }
  const before = snap.data();
  await updateDoc(ref, { rawMaterialName: t.raw });
  console.log(`✅ [${t.id}] "${before.name}" rawMaterialName: ${before.rawMaterialName ?? '(없음)'} → "${t.raw}"`);
}
console.log('완료 — 이후 이 SKU 입고분은 개수×20kg으로 환산돼 원료 로트+수불부에 기록됩니다.');
process.exit(0);
