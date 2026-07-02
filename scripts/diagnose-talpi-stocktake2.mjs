// 탈피들깨가루 후속 진단 (읽기 절약형): 부족알림 + 관련 주문 3건 직접 조회
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

// 1) 6/28 이후 원료부족 알림 — 로트가 언제부터 비었는지 확인
console.log('████ notifications: inventory_shortage (6/28 이후) ████');
try {
  const ns = await getDocs(query(collection(db, 'notifications'), where('type', '==', 'inventory_shortage')));
  ns.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(n => (n.createdAt ?? '') >= '2026-06-28')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .forEach(n => console.log(`  ${(n.createdAt ?? '').slice(0, 19)} ${n.body}`));
} catch (e) { console.log('  (조회 실패:', e.code ?? e.message, ')'); }

// 2) 관련 주문 3건 직접 조회 (전체 컬렉션 안 읽음)
console.log('\n████ 관련 주문 3건 ████');
for (const oid of ['ORD-1782447248346', 'ORD-1782690336602', 'ORD-1782874629968']) {
  const s = await getDoc(doc(db, 'orders', oid));
  if (!s.exists()) { console.log(`  ${oid}: 문서 없음`); continue; }
  const o = s.data();
  console.log(`  ${oid} ${o.partnerName} status=${o.status} deliveredAt=${(o.deliveredAt ?? '').slice(0, 16)} rawLotsDeducted=${o.rawLotsDeducted ?? false}`);
  (o.items ?? []).forEach(i => console.log(`      ${i.name} x${i.quantity}`));
}

process.exit(0);
