// item_customer → partner_item 포장설정 마이그레이션
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'serviceAccountKey.json'), 'utf8'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function migrate() {
  // 1. item_customer 전체 읽기
  console.log('item_customer 읽는 중...');
  await sleep(2000);
  const icSnap = await db.collection('item_customer').get();
  const ics = icSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`item_customer: ${ics.length}건`);

  // 2. partner_item 전체 읽기
  await sleep(2000);
  console.log('partner_item 읽는 중...');
  const piSnap = await db.collection('partner_item').get();
  const partnerItems = piSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`partner_item: ${partnerItems.length}건`);

  let updated = 0, created = 0, skipped = 0;
  const batch = db.batch();
  let batchCount = 0;

  const flush = async () => {
    if (batchCount > 0) { await batch.commit(); batchCount = 0; }
  };

  for (const ic of ics) {
    const itemId = ic.item_id;
    const customerId = ic.customer_id;
    if (!itemId || !customerId) {
      console.log(`  skip (item_id/customer_id 없음): ${ic.id}`);
      skipped++;
      continue;
    }

    const packFields = {};
    if (ic.qty_per_box  !== undefined) packFields.qty_per_box     = ic.qty_per_box;
    if (ic.displaySize  !== undefined) packFields.displaySize     = ic.displaySize;
    if (ic.packageType  !== undefined) packFields.packageType     = ic.packageType;
    if (ic.containerTypeId !== undefined) packFields.containerTypeId = ic.containerTypeId;
    if (ic.labelId      !== undefined) packFields.labelId         = ic.labelId;
    if (ic.tapeTypeId   !== undefined) packFields.tapeTypeId      = ic.tapeTypeId;
    if (ic.weightInKg   !== undefined) packFields.weightInKg      = ic.weightInKg;
    if (ic.price        !== undefined) packFields.Standard_Price  = ic.price;
    // backward compat 별칭도 저장
    packFields.item_id     = itemId;
    packFields.customer_id = customerId;

    const existing = partnerItems.find(
      pi => pi.Item_ID === itemId && pi.Partner_ID === customerId && pi.Direction === 'out'
    );

    if (existing) {
      batch.update(db.collection('partner_item').doc(existing.id), packFields);
      console.log(`  update: ${itemId} ↔ ${customerId}`);
      updated++;
    } else {
      const newId = `${itemId}_${customerId}_out`;
      batch.set(db.collection('partner_item').doc(newId), {
        id: newId, Item_ID: itemId, Partner_ID: customerId, Direction: 'out',
        ...packFields,
      });
      console.log(`  create: ${itemId} ↔ ${customerId}`);
      created++;
    }

    batchCount++;
    if (batchCount >= 200) {
      await flush();
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await flush();
  console.log(`\n완료: update ${updated}건, create ${created}건, skip ${skipped}건`);
}

migrate().catch(e => { console.error('오류:', e.message); process.exit(1); });
