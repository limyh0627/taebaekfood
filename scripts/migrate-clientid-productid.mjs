// Migration: clientId → partnerId, productId → itemId, clientIds → partnerIds
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);


async function migrateCollection(colName, transform) {
  const snap = await getDocs(collection(db, colName));
  if (snap.empty) { console.log(`[${colName}] 문서 없음`); return; }

  let batch = writeBatch(db);
  let count = 0;
  let batchCount = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const updates = transform(data);
    if (!updates) continue;

    batch.update(doc(db, colName, docSnap.id), updates);
    count++;
    batchCount++;

    if (batchCount === 400) {
      await batch.commit();
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  console.log(`[${colName}] ${count}건 업데이트`);
}

function renameField(data, oldKey, newKey) {
  if (!(oldKey in data)) return null;
  return { [newKey]: data[oldKey], [oldKey]: null }; // null = delete field in Firestore
}

function flatRename(data, ...pairs) {
  const updates = {};
  let changed = false;
  for (const [oldKey, newKey] of pairs) {
    if (oldKey in data) {
      updates[newKey] = data[oldKey];
      updates[oldKey] = null; // deleteField equivalent
      changed = true;
    }
  }
  return changed ? updates : null;
}

async function main() {
  await signInAnonymously(auth);
  console.log('=== Firestore 필드명 마이그레이션 시작 ===');

  // orders: clientId → partnerId
  await migrateCollection('orders', (data) => {
    const updates = {};
    let changed = false;
    if ('clientId' in data) {
      updates.partnerId = data.clientId;
      updates.clientId = null;
      changed = true;
    }
    // items 배열 내 productId → itemId
    if (data.items?.some(i => 'productId' in i)) {
      updates.items = data.items.map(i => {
        if (!('productId' in i)) return i;
        const { productId, ...rest } = i;
        return { ...rest, itemId: productId };
      });
      changed = true;
    }
    return changed ? updates : null;
  });

  // issuedStatements: clientId → partnerId
  await migrateCollection('issuedStatements', (data) =>
    flatRename(data, ['clientId', 'partnerId'])
  );

  // purchaseOrders: productId → itemId, supplierId → partnerId (supplier)
  // Note: supplierId stays for now since it's a specific role
  await migrateCollection('purchaseOrders', (data) =>
    flatRename(data, ['productId', 'itemId'])
  );

  // palletTransactions: clientId → partnerId
  await migrateCollection('palletTransactions', (data) =>
    flatRename(data, ['clientId', 'partnerId'])
  );

  // productionRecords: productId → itemId
  await migrateCollection('productionRecords', (data) =>
    flatRename(data, ['productId', 'itemId'], ['wipProductId', 'wipItemId'])
  );

  // returnRequests: clientId → partnerId, items[].productId → itemId
  await migrateCollection('returnRequests', (data) => {
    const updates = {};
    let changed = false;
    if ('clientId' in data) {
      updates.partnerId = data.clientId;
      updates.clientId = null;
      changed = true;
    }
    if (data.items?.some(i => 'productId' in i)) {
      updates.items = data.items.map(i => {
        if (!('productId' in i)) return i;
        const { productId, ...rest } = i;
        return { ...rest, itemId: productId };
      });
      changed = true;
    }
    return changed ? updates : null;
  });

  // adjustmentRequests: productId → itemId
  await migrateCollection('adjustmentRequests', (data) =>
    flatRename(data, ['productId', 'itemId'])
  );

  // items: clientIds → partnerIds
  await migrateCollection('items', (data) =>
    flatRename(data, ['clientIds', 'partnerIds'])
  );

  // pendingStatementEdits: proposedData.clientId → partnerId
  await migrateCollection('pendingStatementEdits', (data) => {
    if (!data.proposedData?.clientId) return null;
    return {
      proposedData: {
        ...data.proposedData,
        partnerId: data.proposedData.clientId,
        clientId: null,
      }
    };
  });

  console.log('=== 마이그레이션 완료 ===');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
