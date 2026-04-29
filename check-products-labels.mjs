import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE",
  authDomain: "taebaek-3abe4.firebaseapp.com",
  projectId: "taebaek-3abe4",
  storageBucket: "taebaek-3abe4.firebasestorage.app",
  messagingSenderId: "426912093935",
  appId: "1:426912093935:web:2bd399b729b553edf82d1a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDocs(collection(db, "products"));
const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

// 완제품만, 라벨 submaterial 있는 것
const withLabel = products.filter(p =>
  (p.category === '완제품' || p.itemType === 'FINISHED') &&
  p.submaterials?.some(s => s.category === '라벨' || s.name?.includes('라벨'))
);

// 라벨 없는 완제품
const noLabel = products.filter(p =>
  (p.category === '완제품' || p.itemType === 'FINISHED') &&
  !p.submaterials?.some(s => s.category === '라벨' || s.name?.includes('라벨'))
);

console.log("=== 라벨 연결된 완제품 ===");
for (const p of withLabel) {
  const labels = p.submaterials.filter(s => s.category === '라벨' || s.name?.includes('라벨'));
  console.log(`[${p.id}] ${p.name} | 용량:${p.용량 ?? '-'} | 품목:${p.품목 ?? '-'} | 라벨: ${labels.map(l => l.name).join(', ')}`);
}

console.log(`\n=== 라벨 없는 완제품 (${noLabel.length}개) ===`);
for (const p of noLabel) {
  console.log(`[${p.id}] ${p.name} | 용량:${p.용량 ?? '-'} | 품목:${p.품목 ?? '-'}`);
}

process.exit(0);
