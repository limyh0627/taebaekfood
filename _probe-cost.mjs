import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const get = async c => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() }));
const items = await get('items'); const partners = await get('partners'); const pi = await get('partner_item');

console.log("=== 이름/품목에 '1800' 또는 '페트병' 포함 items ===");
items.filter(i => /1800|페트병|골드/.test(i.name||'') || /1800|페트병|골드/.test(i.품목||''))
  .forEach(i => console.log(`  id=${i.id} | name="${i.name}" | 품목="${i.품목??'-'}" | category=${i.category} | cost=${i.cost ?? '없음'} | price=${i.price ?? '-'}`));

const hj = partners.find(p => (p.name||'').includes('형제프라콘'));
console.log(`\n=== 형제프라콘: id=${hj?.id} ===`);
const hjIn = pi.filter(p => (p.Partner_ID ?? p.partnerId) === hj?.id && (p.Direction === 'in'));
console.log(`매입 partner_item ${hjIn.length}건:`);
hjIn.forEach(p => {
  const it = items.find(x => x.id === (p.Item_ID ?? p.itemId));
  console.log(`  Item_ID=${p.Item_ID ?? p.itemId} (${it?.name??'?'}) | price=${p.price ?? p.Standard_Price ?? '없음'} | item.cost=${it?.cost ?? '없음'}`);
});
process.exit(0);
