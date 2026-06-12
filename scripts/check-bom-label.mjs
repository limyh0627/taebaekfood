import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const [itemsSnap, bomSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'item_bom')),
]);

const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));

// p-105 (들기름/1.75ML) BOM 구성 확인
console.log('═══ p-105 (들기름/1.75ML) BOM ═══');
for (const d of bomSnap.docs) {
  const b = d.data();
  if (b.parent_id !== 'p-105') continue;
  const child = itemMap.get(b.child_id);
  console.log(`  child: ${b.child_id} → ${child ? child.name : '(품목 없음!)'} ×${b.quantity}`);
}

// BOM에서 라벨로 연결됐는데 이름에 "태백"이 남아있는 케이스 전수 확인
console.log('\n═══ BOM 연결 라벨 중 이름에 "태백" 남은 것 ═══');
let n = 0;
for (const d of bomSnap.docs) {
  const b = d.data();
  const child = itemMap.get(b.child_id);
  if (child && (child.name ?? '').includes('태백')) {
    n++;
    const parent = itemMap.get(b.parent_id);
    console.log(`  ${parent?.name ?? b.parent_id} → ${child.name}`);
  }
}
console.log(`총 ${n}건`);

// items 전체에서 "태백" 남은 품목 (카테고리 무관)
console.log('\n═══ 이름에 "태백" 남은 전체 품목 ═══');
let m = 0;
for (const [id, x] of itemMap) {
  if ((x.name ?? '').includes('태백')) {
    m++;
    console.log(`  ${id} | ${x.name} | ${x.category}/${x.subtype ?? ''}`);
  }
}
console.log(`총 ${m}건`);
process.exit(0);
