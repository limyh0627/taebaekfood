// 탈피들깨가루: 6/29 재고실사정정 후 0이 된 원인 진단 (읽기 전용)
// 1) raw 품목 stock + lots 상태  2) 수불부 6/25~오늘 전체  3) 최근 DELIVERED 주문 중 탈피들깨가루 사용분
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const MAT = '탈피들깨가루';

const [itemsSnap, ledgerSnap, ordersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'rawMaterialLedger')),
  getDocs(collection(db, 'orders')),
]);

// 1) raw 품목 상태 (raw-탈피들깨가루 + 이름에 탈피들깨 포함 전 품목)
console.log('████ items: 탈피들깨 관련 전 품목 ████');
itemsSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(it => (it.name ?? '').includes('탈피들깨'))
  .forEach(it => {
    console.log(`- [${it.id}] "${it.name}" cat=${it.category} stock=${it.stock}${it.unit ?? ''} lots=${Array.isArray(it.lots) ? it.lots.length : '없음'}`);
    if (Array.isArray(it.lots)) {
      it.lots.forEach((l, i) => console.log(`    [${i}] ${l.supplierName} in=${l.kgIn}kg 잔여=${l.kgRemaining}kg lotNo=${l.lotNo ?? '-'} status=${l.status} 입고=${l.receivedDate} created=${(l.createdAt ?? '').slice(0, 19)}`));
    }
  });

// 2) 수불부: 탈피들깨가루 6/25 이후 전부 (createdAt 오름차순)
console.log(`\n████ 수불부 ${MAT} 2026-06-25 이후 전체 ████`);
ledgerSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(e => (e.material ?? '') === MAT && (e.date ?? '') >= '2026-06-25')
  .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  .forEach(e => console.log(`  ${e.date} +${e.received ?? 0}/-${e.used ?? 0}${e.unit ?? ''} type=${e.type ?? '-'} note="${e.note ?? ''}" createdAt=${(e.createdAt ?? '').slice(0, 19)} id=${e.id}`));

// 3) 6/28 이후 DELIVERED 주문 중 탈피들깨가루 사용 품목(시골향탈피들깨가루) 포함분
console.log('\n████ 6/28 이후 DELIVERED 주문 (시골향탈피들깨가루 포함) ████');
ordersSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(o => o.status === 'DELIVERED' && (o.deliveredAt ?? '') >= '2026-06-28')
  .sort((a, b) => (a.deliveredAt ?? '').localeCompare(b.deliveredAt ?? ''))
  .forEach(o => {
    const hits = (o.items ?? []).filter(i => (i.name ?? '').includes('탈피들깨'));
    if (hits.length === 0) return;
    console.log(`  ${o.deliveredAt?.slice(0, 16)} ${o.partnerName} rawLotsDeducted=${o.rawLotsDeducted ?? false}`);
    hits.forEach(i => console.log(`      ${i.name} x${i.quantity} (${i.capacity ?? '-'})`));
  });

process.exit(0);
