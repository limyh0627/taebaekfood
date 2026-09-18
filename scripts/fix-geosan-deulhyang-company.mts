/** 거산 들향기름 거래처 품목에 빠진 companyId를 보충한다. 기본 dry / --apply / --undo. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ID = 'f5_C005_out';
const BACKUP = '로컬전용/백업/geosan-deulhyang-company-2026-09-18.json';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' }, `fix-geosan-${Date.now()}`);
try {
  const ref = getFirestore(app).collection('partner_item').doc(ID);
  if (UNDO) {
    const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
    await ref.set(backup.before, { merge: false });
    console.log('되돌림 완료');
    process.exit(0);
  }
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`거래처 품목 없음: ${ID}`);
  const before = snap.data()!;
  console.log(`${ID}: companyId ${before.companyId || '(누락)'} → taebaek, ${before.partnerId}/${before.itemId}`);
  if (!APPLY || before.companyId === 'taebaek') process.exit(0);
  if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다: ${BACKUP}`);
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify({ createdAt: new Date().toISOString(), before }, null, 2));
  await ref.update({ companyId: 'taebaek' });
  console.log('적용 완료');
} finally { await deleteApp(app); }
