// 들향기름골드(f6) 기본 박스 수량 12(코드 하드코딩 폴백) → 10 (defaultBoxConfig 지정)
// 실행:      node scripts/set-deulhyang-gold-box10.mjs
// 되돌리기:  node scripts/set-deulhyang-gold-box10.mjs --undo   (defaultBoxConfig 필드 삭제 → 폴백 12로 복귀)
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const ID = 'f6';
const undo = process.argv.includes('--undo');
const ref = doc(db, 'items', ID);
const snap = await getDoc(ref);
if (!snap.exists()) { console.log(`items/${ID} 없음 — 중단`); process.exit(1); }
const before = snap.data();
console.log(`대상: ${before.name} (items/${ID})`);
console.log(`변경 전 defaultBoxConfig: ${JSON.stringify(before.defaultBoxConfig ?? null)}`);

if (undo) {
  await updateDoc(ref, { defaultBoxConfig: deleteField() });
  console.log('되돌림 완료: defaultBoxConfig 삭제 (향미유 폴백 12로 복귀)');
} else {
  await updateDoc(ref, { defaultBoxConfig: { boxType: '', unitsPerBox: 10 } });
  console.log('변경 완료: defaultBoxConfig = { boxType: "", unitsPerBox: 10 }');
}
const after = (await getDoc(ref)).data();
console.log(`변경 후 defaultBoxConfig: ${JSON.stringify(after.defaultBoxConfig ?? null)}`);
process.exit(0);
