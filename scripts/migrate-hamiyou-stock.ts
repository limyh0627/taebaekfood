import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';

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

const BOX_SIZE = 12;

async function migrate() {

  const snap = await getDocs(collection(db, 'products'));
  const batch = writeBatch(db);
  let count = 0;

  snap.forEach(d => {
    const data = d.data();
    if (data.category === '향미유' && typeof data.stock === 'number' && data.stock > 0) {
      const newStock = data.stock * BOX_SIZE;
      console.log(`${data.name}: ${data.stock}B → ${newStock}개`);
      batch.update(doc(db, 'products', d.id), { stock: newStock });
      count++;
    }
  });

  if (count === 0) {
    console.log('향미유 재고가 없거나 이미 마이그레이션됨');
    process.exit(0);
  }

  await batch.commit();
  console.log(`\n완료: ${count}개 품목 마이그레이션`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
