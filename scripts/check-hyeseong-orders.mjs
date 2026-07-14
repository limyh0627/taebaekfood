// 혜성(C084) 주문 이력 + 연결 품목 확인 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

let orders = [];
try {
  const snap = await getDocs(query(collection(db, 'orders'), where('partnerId', '==', 'C084'), orderBy('orderDate', 'desc'), limit(5)));
  snap.forEach(d => orders.push(d.data()));
} catch (e) {
  // 인덱스 없으면 정렬 없이
  const snap = await getDocs(query(collection(db, 'orders'), where('partnerId', '==', 'C084'), limit(10)));
  snap.forEach(d => orders.push(d.data()));
  orders.sort((a, b) => String(b.orderDate ?? '').localeCompare(String(a.orderDate ?? '')));
  orders = orders.slice(0, 5);
}
console.log(`최근 주문 ${orders.length}건:`);
for (const o of orders) {
  const items = (o.items ?? []).map(i => `${i.itemName ?? i.name ?? i.itemId}×${i.quantity ?? i.qty}`).join(', ');
  console.log(`  ${String(o.orderDate ?? '').slice(0, 10)} [${o.status}] ${items}`);
}

const pi = await getDocs(query(collection(db, 'partner_item'), where('partnerId', '==', 'C084')));
console.log(`\n연결 품목(partner_item): ${pi.size}건`);
pi.forEach(d => { const v = d.data(); console.log(`  itemId=${v.itemId} price=${v.price ?? '-'}`); });
process.exit(0);
