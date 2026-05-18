import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
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

let total = 0;

async function cleanFields(colName, fieldsToDelete) {
  const snap = await getDocs(collection(db, colName));
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const patch = {};
    for (const f of fieldsToDelete) {
      if (f in data) patch[f] = deleteField();
    }
    if (Object.keys(patch).length > 0) {
      await updateDoc(doc(db, colName, d.id), patch);
      updated++;
    }
  }
  console.log(`  [${colName}] ${updated}건 업데이트`);
  total += updated;
}

// ── items: deprecated 필드 제거
console.log('\n[items]');
await cleanFields('items', [
  'defaultBoxConfig',
  'clientBoxConfigs',
  'boxSize',
  'itemType',
  'supplierId',
]);

// ── partners: deprecated 필드 제거 (region 포함)
console.log('\n[partners]');
await cleanFields('partners', [
  'productSettings',
  'associatedProductIds',
  'region',
]);

// ── partner_item: shipping_rule로 이관된 필드 + deprecated 제거
console.log('\n[partner_item]');
await cleanFields('partner_item', [
  'boxTypeId',
  'tapeTypeId',
  'qtyPerBox',
  'qty_per_box',
  'Standard_Price',
  'id',
  'displaySize',
  'packageType',
  'containerTypeId',
  'labelId',
  'weightInKg',
  'productId',
  'clientId',
  'supplierId',
  'item_id',
  'customer_id',
]);

// ── item_bom: item_formula 데이터가 잘못 들어간 13건 (parent_key 필드가 있는 것들)
console.log('\n[item_bom] item_formula 잘못 들어간 문서 제거');
{
  const snap = await getDocs(collection(db, 'item_bom'));
  let deleted = 0;
  const { deleteDoc } = await import('firebase/firestore');
  for (const d of snap.docs) {
    const data = d.data();
    // item_formula 필드 구조(parent_key, child_name, ratio, yield_rate)만 있고 parent_id가 없는 것
    if (data.parent_key && !data.parent_id) {
      await deleteDoc(doc(db, 'item_bom', d.id));
      console.log(`  [item_bom] 삭제: ${d.id} (parent_key=${data.parent_key})`);
      deleted++;
    }
  }
  console.log(`  [item_bom] ${deleted}건 삭제`);
  total += deleted;
}

console.log(`\n완료: 총 ${total}건 처리`);
process.exit(0);
