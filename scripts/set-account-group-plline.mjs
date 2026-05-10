/**
 * accountGroups에 plLine 필드 설정
 * 실행: node scripts/set-account-group-plline.mjs
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

const MAPPING = {
  'ag-revenue':      'revenue',
  'ag-cogs':         'cogs',
  'ag-selling':      'sgna',
  'ag-admin':        'sgna',
  // ag-gross-profit, ag-op-profit 은 computed라 plLine 없음
};

async function run() {
  for (const [id, plLine] of Object.entries(MAPPING)) {
    await db.collection('accountGroups').doc(id).set({ plLine }, { merge: true });
    console.log(`  ✓ accountGroups/${id} → plLine: ${plLine}`);
  }
  console.log('\n완료.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
