import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const RAW_MATERIALS = ['참깨','들깨','검정깨','탈피들깨가루','깨분','볶음참깨','볶음들깨','볶음검정참깨','통깨참기름','깨분참기름','통들깨들기름','수입들기름','생들기름'];
const OIL = new Set(['통깨참기름','깨분참기름','통들깨들기름','수입들기름','생들기름']);

const snap = await getDocs(collection(db, 'items'));
const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

for (const nm of RAW_MATERIALS) {
  const existingRaw = all.find(p => p.category === 'raw' && (p.name === nm || p.품목 === nm));
  if (existingRaw) { console.log(`[skip] ${nm} — 이미 raw 아이템(${existingRaw.id})`); continue; }
  const id = `raw-${nm}`;
  await setDoc(doc(db, 'items', id), {
    name: nm, category: 'raw', stock: 0, minStock: 0,
    unit: OIL.has(nm) ? 'L' : 'kg', price: 0, image: '',
  });
  console.log(`[create] ${nm} → ${id} (category=raw, unit=${OIL.has(nm) ? 'L' : 'kg'})`);
}
console.log('완료');
process.exit(0);
