/** 품목 체크 수와 작업 전 상태(PENDING/PROCESSING/DISPATCHED)를 맞춘다. 기본 dry, --apply, --undo. */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OrderStatus, type Order } from '../src/shared/types';
import { workStatusFromItems } from '../src/shared/orderCompletion';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = '로컬전용/백업/order-work-status-2026-09-17.json';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const app = getApps()[0] ?? initializeApp({ credential: keyPath ? cert(JSON.parse(readFileSync(keyPath, 'utf8'))) : applicationDefault(), projectId: 'taebaek-3abe4' });
const db = getFirestore(app);

if (UNDO) {
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { before: { id: string; status: OrderStatus }[] };
  for (let i = 0; i < backup.before.length; i += 400) {
    const batch = db.batch();
    for (const row of backup.before.slice(i, i + 400)) batch.update(db.collection('orders').doc(row.id), { status: row.status });
    await batch.commit();
  }
  console.log(`되돌림 완료: ${backup.before.length}건`);
  process.exit(0);
}

const snap = await db.collection('orders').get();
const workStates = new Set<OrderStatus>([OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED]);
const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
const changes = rows.flatMap(order => {
  if (!workStates.has(order.status) || !Array.isArray(order.items)) return [];
  const expected = workStatusFromItems(order.items);
  return expected === order.status ? [] : [{ id: order.id, cardNo: order.cardNo ?? order.id, partnerName: order.partnerName, before: order.status, after: expected, checked: order.items.filter(item => item.checked === true).length, total: order.items.length }];
});
console.log(`전체 주문 ${rows.length}건 / 상태 불일치 ${changes.length}건`);
for (const row of changes) console.log(`${row.cardNo} ${row.partnerName}: ${row.before} → ${row.after} (${row.checked}/${row.total})`);
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ createdAt: new Date().toISOString(), before: changes.map(row => ({ id: row.id, status: row.before })) }, null, 2));
for (let i = 0; i < changes.length; i += 400) {
  const batch = db.batch();
  for (const row of changes.slice(i, i + 400)) batch.update(db.collection('orders').doc(row.id), { status: row.after });
  await batch.commit();
}
console.log(`적용 완료: ${changes.length}건`);
