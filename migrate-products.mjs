// migrate-products.mjs
// 향미유/고춧가루 문서를 submaterials → products 컬렉션으로 이동
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';

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

const MOVE_CATEGORIES = ['향미유', '고춧가루'];

async function migrate() {
  const snap = await getDocs(collection(db, 'submaterials'));
  let moved = 0;
  let skipped = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (!MOVE_CATEGORIES.includes(data.category)) {
      skipped++;
      continue;
    }

    // products 컬렉션에 동일 ID로 복사
    await setDoc(doc(db, 'products', d.id), data);
    // submaterials에서 삭제
    await deleteDoc(doc(db, 'submaterials', d.id));

    console.log(`이동: [${data.category}] ${data.name} (${d.id})`);
    moved++;
  }

  console.log(`\n완료: ${moved}개 이동, ${skipped}개 유지`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
