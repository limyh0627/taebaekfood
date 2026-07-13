// 안 쓰는 파레트 3종(목재·플라스틱·검정) 숨김 처리 — 사용자 요청(2026-07-13)
// 문서 삭제 대신 hidden 플래그: 과거 이력·거래처 잔량 계산은 유지, 화면·선택 목록에서만 제거.
// 실행:     node scripts/hide-unused-pallets.mjs
// 되돌리기: node scripts/hide-unused-pallets.mjs --undo
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const undo = process.argv.includes('--undo');

const TARGETS = ['pal-wood', 'pal-plastic', 'pal-black'];
for (const id of TARGETS) {
  const ref = doc(db, 'pallets', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) { console.log(`pallets/${id} 없음 — 건너뜀`); continue; }
  await updateDoc(ref, { hidden: undo ? deleteField() : true });
  console.log(`${snap.data().name} (${id}): ${undo ? 'hidden 해제' : 'hidden=true'}`);
}
console.log(undo ? '되돌림 완료' : '숨김 완료');
process.exit(0);
