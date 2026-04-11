// migrate-partner-type.mjs
// clients 컬렉션에서 partnerType 없는 문서에 '매출처' 설정
// expirationDate → mfgDate 필드명 마이그레이션도 함께 처리
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
  storageBucket: 'taebaek-3abe4.firebasestorage.app',
  messagingSenderId: '426912093935',
  appId: '1:426912093935:web:2bd399b729b553edf82d1a',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrate() {
  let clientsFixed = 0;
  let ordersFixed = 0;

  // ── 1. clients: partnerType 없는 문서 → '매출처' ───────────────
  console.log('\n[1/2] clients 컬렉션 partnerType 마이그레이션...');
  const clientsSnap = await getDocs(collection(db, 'clients'));
  for (const d of clientsSnap.docs) {
    const data = d.data();
    if (!data.partnerType) {
      await updateDoc(doc(db, 'clients', d.id), { partnerType: '매출처' });
      console.log(`  ✓ ${data.name || d.id} → 매출처`);
      clientsFixed++;
    }
  }
  console.log(`  완료: ${clientsFixed}개 업데이트, ${clientsSnap.size - clientsFixed}개 이미 설정됨`);

  // ── 2. orders: expirationDate → mfgDate 필드명 변경 ───────────
  console.log('\n[2/2] orders 컬렉션 expirationDate → mfgDate 마이그레이션...');
  const ordersSnap = await getDocs(collection(db, 'orders'));
  for (const d of ordersSnap.docs) {
    const data = d.data();
    const items = data.items || [];
    const needsMigration = items.some(item => item.expirationDate !== undefined);
    if (!needsMigration) continue;
    const newItems = items.map(item => {
      if (item.expirationDate === undefined) return item;
      const { expirationDate, ...rest } = item;
      return { ...rest, mfgDate: expirationDate };
    });
    await updateDoc(doc(db, 'orders', d.id), { items: newItems });
    console.log(`  ✓ 주문 ${d.id} — ${items.filter(i => i.expirationDate !== undefined).length}개 아이템 변환`);
    ordersFixed++;
  }
  console.log(`  완료: ${ordersFixed}개 주문 업데이트`);

  console.log('\n✅ 마이그레이션 완료');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
