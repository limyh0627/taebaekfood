/**
 * 기존 issuedStatements에서 accountCode 없는 라인에 기본값 채우기
 * - 매출 전표 → 800 (일반매출)
 * - 매입 전표 → 500 (원료매입)
 * 실행: node scripts/fill-statement-account-codes.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const keyPath = resolve(__dirname, 'serviceAccountKey.json');
if (!existsSync(keyPath)) {
  console.error('\n[오류] scripts/serviceAccountKey.json 파일이 없습니다.\n');
  process.exit(1);
}

const admin = require('firebase-admin');
const serviceAccount = require(keyPath);

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function fillAccountCodes() {
  const snap = await db.collection('issuedStatements').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const items = data.items ?? [];
    const defaultCode = data.type === '매출' ? '800' : '500';

    const hasEmpty = items.some(item => !item.accountCode);
    if (!hasEmpty) { skipped++; continue; }

    const newItems = items.map(item => ({
      ...item,
      accountCode: item.accountCode || defaultCode,
    }));

    await doc.ref.update({ items: newItems });
    console.log(`  ✓ ${doc.id} (${data.type} → ${defaultCode}) ${items.length}개 라인`);
    updated++;
  }

  console.log(`\n완료: ${updated}건 업데이트, ${skipped}건 스킵 (이미 코드 있음)`);
  process.exit(0);
}

fillAccountCodes().catch(e => { console.error(e); process.exit(1); });
