// 볶음참깨 마무리 배선 (2026-07-13 #2)
//  1) 낱개/1kg → 스마트스토어 노출 (isSmartStore) — 삭제된 스마트스토어 품목 대체
//  2) 볶음참깨(벌크)/20kg → rawMaterialName 연결 (자루 SKU 삭제로 끊긴 벌크 입고 경로 복구)
//  3) 박스 품목 spec 정정 (표시용)
// 실행: node scripts/wire-bokkeum-final.mjs   / 되돌리기: --undo
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const undo = process.argv.includes('--undo');
const BACKUP = 'scripts/wire-bokkeum-final-backup.json';

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const [path, data] of Object.entries(bak.docs)) {
    const [col, id] = path.split('/');
    if (data === null) await deleteDoc(doc(db, col, id));
    else await setDoc(doc(db, col, id), data);
    console.log(`복원: ${path}`);
  }
  console.log('되돌림 완료'); process.exit(0);
}

const backup = { at: new Date().toISOString(), docs: {} };
const save = async (id) => { const s = await getDoc(doc(db, 'items', id)); backup.docs[`items/${id}`] = s.exists() ? s.data() : null; };

// 1) 낱개 → 스마트스토어 노출
await save('PLDhkjOgcPIhO1hhReHm');
await updateDoc(doc(db, 'items', 'PLDhkjOgcPIhO1hhReHm'), { isSmartStore: true });
console.log('볶음참깨-낱개/1kg: isSmartStore=true (스마트스토어 주문에 노출)');

// 2) 벌크 매입 SKU → 원료 로트 연결
await save('p-1779937553909');
await updateDoc(doc(db, 'items', 'p-1779937553909'), { rawMaterialName: '볶음참깨', packageType: '자루', packageKg: 20 });
console.log('볶음참깨(벌크)/20kg: rawMaterialName=볶음참깨, 자루 20kg (입고 → 벌크 로트 복구)');

// 3) 박스 spec 정정 (표시용 — 차감은 완사입이라 spec 미사용)
await save('p-1780625531675');
await updateDoc(doc(db, 'items', 'p-1780625531675'), { spec: '10kg' });
await save('p-1780625559322');
await updateDoc(doc(db, 'items', 'p-1780625559322'), { spec: '20kg' });
console.log('10kg박스/20kg박스: spec 10kg/20kg 정정');

fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`백업 저장: ${BACKUP} — 완료`);
process.exit(0);
