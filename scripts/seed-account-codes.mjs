/**
 * accountGroups / accountCodes 초기 데이터 Firestore 업로드
 * 실행: node scripts/seed-account-codes.mjs
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

const ACCOUNT_GROUPS = [
  { id: 'ag-revenue',      name: '총매출',     type: '수익' },
  { id: 'ag-cogs',         name: '총매출원가', type: '비용' },
  { id: 'ag-gross-profit', name: '매출총이익', type: '수익' },
  { id: 'ag-selling',      name: '판매비',     type: '비용' },
  { id: 'ag-admin',        name: '관리비',     type: '비용' },
  { id: 'ag-op-profit',    name: '영업이익',   type: '수익' },
];

const ACCOUNT_CODES = [
  { id: '500', code: '500', name: '원료매입',   groupId: 'ag-cogs' },
  { id: '505', code: '505', name: '부자재매입', groupId: 'ag-cogs' },
  { id: '800', code: '800', name: '일반매출',   groupId: 'ag-revenue' },
];

async function seed() {
  for (const g of ACCOUNT_GROUPS) {
    const { id, ...rest } = g;
    await db.collection('accountGroups').doc(id).set(rest, { merge: true });
    console.log(`  ✓ accountGroups/${id} (${g.name})`);
  }
  for (const c of ACCOUNT_CODES) {
    const { id, ...rest } = c;
    await db.collection('accountCodes').doc(id).set(rest, { merge: true });
    console.log(`  ✓ accountCodes/${id} (${c.code} ${c.name})`);
  }
  console.log('\n완료.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
