// 청정식품 매입품목 연결이 선입고에 안 보이는 문제 진단 (읽기 전용)
// 1) 청정* 거래처 문서의 purchaseItems 필드 유무  2) partner_item에 방금 물린 연결의 Direction 확인
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

// 1) 청정 관련 거래처
const partnersSnap = await getDocs(collection(db, 'partners'));
const cheongs = partnersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => (p.name ?? '').includes('청정'));
console.log('████ 청정* 거래처 ████');
for (const p of cheongs) {
  console.log(`- [${p.id}] "${p.name}" type=${p.partnerType ?? '-'} purchaseItems=${Array.isArray(p.purchaseItems) ? p.purchaseItems.length + '건' : '없음'}`);
  if (Array.isArray(p.purchaseItems)) p.purchaseItems.forEach(pi => console.log(`    · ${pi.name ?? pi.id}`));
}

// 2) 이 거래처들의 partner_item 연결 전부 (Direction 표시)
console.log('\n████ partner_item 연결 (청정* 거래처) ████');
const itemsSnap = await getDocs(collection(db, 'items'));
const itemName = (id) => itemsSnap.docs.find(d => d.id === id)?.data()?.name ?? id;
for (const p of cheongs) {
  const piSnap = await getDocs(query(collection(db, 'partner_item'), where('Partner_ID', '==', p.id)));
  console.log(`- ${p.name}: ${piSnap.size}건`);
  piSnap.docs.forEach(d => {
    const x = d.data();
    console.log(`    ${x.Direction ?? '?'} → "${itemName(x.Item_ID)}" [${x.Item_ID}] (doc=${d.id})`);
  });
}

// 3) 볶음검정참깨/볶음참깨 20kg 품목 존재 확인
console.log('\n████ 볶음(검정)참깨 20kg 품목 ████');
itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  .filter(it => /볶음(검정)?참깨/.test(it.name ?? '') && (it.name ?? '').includes('20'))
  .forEach(it => console.log(`- [${it.id}] "${it.name}" cat=${it.category} stock=${it.stock}${it.unit ?? ''}`));

process.exit(0);
