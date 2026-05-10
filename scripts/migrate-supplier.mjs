/**
 * Migration: products.supplierId → productSuppliers 컬렉션
 *
 * 실행: node scripts/migrate-supplier.mjs
 *
 * 1. products/submaterials 에서 supplierId 있는 문서를 찾아
 *    productSuppliers 컬렉션에 엔트리가 없으면 생성
 * 2. products/submaterials 문서에서 supplierId 필드 제거
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { readFileSync } from 'fs';

// .env 파싱
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf-8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map(s => s.trim()))
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

async function migrate() {
  let created = 0;
  let cleaned = 0;

  for (const col of ['products', 'submaterials']) {
    const snap = await getDocs(collection(db, col));
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (!data.supplierId) continue;

      const productId = docSnap.id;
      const supplierId = data.supplierId;
      const psId = `${productId}_${supplierId}`;

      // productSuppliers 엔트리 없으면 생성
      const psRef = doc(db, 'productSuppliers', psId);
      await setDoc(psRef, { id: psId, productId, supplierId }, { merge: true });
      created++;

      // product 문서에서 supplierId 제거
      await updateDoc(doc(db, col, productId), { supplierId: deleteField() });
      cleaned++;

      console.log(`✓ ${col}/${productId} → productSuppliers/${psId}`);
    }
  }

  console.log(`\n완료: productSuppliers 생성 ${created}건, supplierId 필드 제거 ${cleaned}건`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
