import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
const auth = getAuth(app);

async function migrate(colName, transform) {
  const snap = await getDocs(collection(db, colName));
  if (snap.empty) { console.log(`[${colName}] 없음`); return; }
  let batch = writeBatch(db), count = 0, batchCount = 0;
  for (const d of snap.docs) {
    const upd = transform(d.data());
    if (!upd) continue;
    batch.update(doc(db, colName, d.id), upd);
    count++; batchCount++;
    if (batchCount === 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
  }
  if (batchCount > 0) await batch.commit();
  console.log(`[${colName}] ${count}건`);
}

async function main() {
  await signInAnonymously(auth);
  console.log('=== supplierId → partnerId 마이그레이션 ===');

  // purchaseOrders: supplierId → partnerId, supplierName → partnerName
  await migrate('purchaseOrders', (d) => {
    const u = {};
    let changed = false;
    if ('supplierId' in d) { u.partnerId = d.supplierId; u.supplierId = null; changed = true; }
    if ('supplierName' in d) { u.partnerName = d.supplierName; u.supplierName = null; changed = true; }
    return changed ? u : null;
  });

  // issuedStatements: no supplierId typically, but check
  await migrate('issuedStatements', (d) => {
    const u = {};
    let changed = false;
    if ('supplierId' in d) { u.partnerId = d.supplierId; u.supplierId = null; changed = true; }
    if ('supplierName' in d) { u.partnerName = d.supplierName; u.supplierName = null; changed = true; }
    return changed ? u : null;
  });

  console.log('=== 완료 ===');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
