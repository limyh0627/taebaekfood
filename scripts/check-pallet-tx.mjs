// palletTransactions 유형 분포 확인 — 읽기 전용 (지급 변경 영향 범위 파악)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

const snap = await getDocs(collection(db, 'palletTransactions'));
let plainOut = 0, plainOutQty = 0, plainIn = 0, plainInQty = 0, exOut = 0, exDone = 0, exIn = 0;
const byPartnerPlainOut = new Map();
snap.forEach(d => {
  const t = d.data();
  if (t.type === 'out' && !t.status) { plainOut++; plainOutQty += t.quantity ?? 0; byPartnerPlainOut.set(t.partnerId, (byPartnerPlainOut.get(t.partnerId) ?? 0) + (t.quantity ?? 0)); }
  else if (t.type === 'out' && t.status === '교체중') exOut++;
  else if (t.type === 'out' && t.status === '교체완료') exDone++;
  else if (t.type === 'in' && (t.note ?? '').includes('교체완료')) exIn++;
  else if (t.type === 'in') { plainIn++; plainInQty += t.quantity ?? 0; }
});
console.log(`전체 거래: ${snap.size}건`);
console.log(`  일반 지급(out, status 없음): ${plainOut}건 / ${plainOutQty}개  ← 이번 변경 대상`);
console.log(`  일반 입고(in): ${plainIn}건 / ${plainInQty}개`);
console.log(`  교체중(out): ${exOut}건 / 교체완료(out): ${exDone}건 / 교체회수(in): ${exIn}건`);
console.log(`\n일반 지급이 있는 거래처: ${byPartnerPlainOut.size}곳`);
process.exit(0);
