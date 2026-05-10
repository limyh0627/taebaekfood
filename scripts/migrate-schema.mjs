/**
 * 전체 스키마 마이그레이션 (Firebase Admin SDK)
 *
 * 실행 전:
 *   1. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"
 *   2. 다운로드된 JSON을 scripts/serviceAccountKey.json 으로 저장
 *   3. node scripts/migrate-schema.mjs
 *
 * 수행 작업 (복사만 하며 원본은 삭제하지 않음):
 *  1. products + submaterials → items
 *  2. clients                → partners
 *  3. productClients         → partner_item (Direction='out')
 *  4. productSuppliers       → partner_item (Direction='in')
 *
 * 이미 대상 컬렉션에 같은 ID 문서가 있으면 건너뜀 (중복 방지).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const keyPath = resolve(__dirname, 'serviceAccountKey.json');
if (!existsSync(keyPath)) {
  console.error('\n[오류] scripts/serviceAccountKey.json 파일이 없습니다.');
  console.error('Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" 후 저장하세요.\n');
  process.exit(1);
}

const admin = require('firebase-admin');
const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function omitNull(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

async function copyCollection(srcName, destName, transform = d => d) {
  const snap = await db.collection(srcName).get();
  let copied = 0, skipped = 0;

  for (const docSnap of snap.docs) {
    const destRef = db.collection(destName).doc(docSnap.id);
    const existing = await destRef.get();

    if (existing.exists) { skipped++; continue; }

    const data = transform({ id: docSnap.id, ...docSnap.data() });
    if (!data) { skipped++; continue; }

    const { id, ...rest } = data;
    const targetId = id ?? docSnap.id;
    await db.collection(destName).doc(targetId).set(omitNull(rest));
    console.log(`  ✓ ${srcName}/${docSnap.id} → ${destName}/${targetId}`);
    copied++;
  }

  return { copied, skipped };
}

// ── 마이그레이션 단계 ─────────────────────────────────────────────────────────
async function migrate() {
  const summary = [];

  // 1. products → items
  console.log('\n[1/4] products → items');
  summary.push({ step: 'products → items', ...await copyCollection('products', 'items') });

  // 2. submaterials → items
  console.log('\n[2/4] submaterials → items');
  summary.push({ step: 'submaterials → items', ...await copyCollection('submaterials', 'items') });

  // 3. clients → partners
  console.log('\n[3/4] clients → partners');
  summary.push({ step: 'clients → partners', ...await copyCollection('clients', 'partners') });

  // 4a. productClients → partner_item (Direction='out')
  console.log('\n[4a/4] productClients → partner_item (Direction=out)');
  summary.push({
    step: 'productClients → partner_item(out)',
    ...await copyCollection('productClients', 'partner_item', (d) => {
      const itemId    = d.productId ?? d.Item_ID;
      const partnerId = d.clientId  ?? d.Partner_ID;
      if (!itemId || !partnerId) return null;
      return {
        id:         `${itemId}_${partnerId}_out`,
        Item_ID:    itemId,
        Partner_ID: partnerId,
        Direction:  'out',
        Standard_Price: d.price ?? d.Standard_Price ?? null,
        taxType:    d.taxType ?? null,
        boxTypeId:  d.boxTypeId ?? null,
        qtyPerBox:  d.qtyPerBox ?? null,
        tapeTypeId: d.tapeTypeId ?? null,
        sku:        d.sku ?? null,
      };
    }),
  });

  // 4b. productSuppliers → partner_item (Direction='in')
  console.log('\n[4b/4] productSuppliers → partner_item (Direction=in)');
  summary.push({
    step: 'productSuppliers → partner_item(in)',
    ...await copyCollection('productSuppliers', 'partner_item', (d) => {
      const itemId    = d.productId ?? d.Item_ID;
      const partnerId = d.supplierId ?? d.Partner_ID;
      if (!itemId || !partnerId) return null;
      return {
        id:         `${itemId}_${partnerId}_in`,
        Item_ID:    itemId,
        Partner_ID: partnerId,
        Direction:  'in',
        Standard_Price: d.price ?? d.Standard_Price ?? null,
        taxType:    d.taxType ?? null,
      };
    }),
  });

  // ── 결과 요약 ──
  console.log('\n════════════════════════════════════════');
  console.log('마이그레이션 완료');
  console.log('────────────────────────────────────────');
  for (const s of summary) {
    console.log(`  ${s.step}`);
    console.log(`    복사: ${s.copied}건  |  건너뜀(이미 존재): ${s.skipped}건`);
  }
  console.log('════════════════════════════════════════');
  console.log('\n원본 컬렉션은 삭제되지 않았습니다.');
  console.log('앱이 정상 동작 확인 후 Firebase 콘솔에서 수동 삭제하세요.');

  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
