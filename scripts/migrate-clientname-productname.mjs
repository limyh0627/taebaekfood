// Migration: clientName → partnerName, productName → itemName
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
  let batch = writeBatch(db), count = 0, bc = 0;
  for (const d of snap.docs) {
    const upd = transform(d.data());
    if (!upd) continue;
    batch.update(doc(db, colName, d.id), upd);
    count++; bc++;
    if (bc === 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
  }
  if (bc > 0) await batch.commit();
  console.log(`[${colName}] ${count}건`);
}

function flatRename(data, ...pairs) {
  const u = {};
  let changed = false;
  for (const [o, n] of pairs) {
    if (o in data) { u[n] = data[o]; u[o] = null; changed = true; }
  }
  return changed ? u : null;
}

async function main() {
  await signInAnonymously(auth);
  console.log('=== clientName→partnerName / productName→itemName 마이그레이션 ===');

  await migrate('issuedStatements', d => flatRename(d, ['clientName', 'partnerName']));
  await migrate('returnRequests', d => flatRename(d, ['clientName', 'partnerName']));
  await migrate('purchaseOrders', d => flatRename(d, ['productName', 'itemName']));
  await migrate('adjustmentRequests', d => flatRename(d, ['productName', 'itemName']));
  await migrate('productionRecords', d => flatRename(d,
    ['productName', 'itemName'],
    ['wipProductName', 'wipItemName'],
    ['wipProductId', 'wipItemId'],
  ));
  await migrate('workOrderItems', d => flatRename(d, ['itemName', 'itemName'])); // already correct
  await migrate('pendingStatementEdits', d => {
    if (!d.proposedData?.clientName) return null;
    return { proposedData: { ...d.proposedData, partnerName: d.proposedData.clientName, clientName: null } };
  });

  console.log('=== 완료 ===');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
