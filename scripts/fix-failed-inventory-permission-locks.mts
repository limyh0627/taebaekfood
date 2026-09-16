/**
 * 2026-09-16 Firestore 규칙 배포 직후 남은 재고 작업 실패 잠금 5건을 해제한다.
 *
 * 원인인 규칙을 먼저 고쳤고, 실패 시각의 원료 이력·생산기록·재고예약이 생기지 않았음을
 * 별도 진단으로 확인했다. 이 스크립트는 주문 상태나 재고에는 손대지 않고 inventoryOperation만 지운다.
 *
 *   npx tsx scripts/fix-failed-inventory-permission-locks.mts
 *   npx tsx scripts/fix-failed-inventory-permission-locks.mts --apply
 *   npx tsx scripts/fix-failed-inventory-permission-locks.mts --undo
 */
import { FieldValue } from 'firebase-admin/firestore';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb } from './_admin.mts';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 함께 쓸 수 없습니다.');

const TARGET_IDS = [
  'ORD-1788911972480',
  'ORD-1789354129578',
  'ORD-1789515330069',
  'ORD-1789515393469',
  'ORD-1789515434526',
] as const;
const BACKUP = '로컬전용/백업/failed-inventory-permission-locks-2026-09-16.json';
const db = adminDb();

type BackupRow = { id: string; inventoryOperation: Record<string, unknown> };

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const rows = JSON.parse(readFileSync(BACKUP, 'utf8')) as BackupRow[];
  const batch = db.batch();
  for (const row of rows) batch.update(db.collection('orders').doc(row.id), { inventoryOperation: row.inventoryOperation });
  await batch.commit();
  console.log(`${rows.length}건의 실패 잠금을 백업 상태로 되돌렸습니다.`);
  process.exit(0);
}

const snapshots = await Promise.all(TARGET_IDS.map(id => db.collection('orders').doc(id).get()));
const rows: BackupRow[] = snapshots.map((snapshot, index) => {
  const id = TARGET_IDS[index];
  if (!snapshot.exists) throw new Error(`주문이 없습니다: ${id}`);
  const operation = snapshot.data()?.inventoryOperation as Record<string, unknown> | undefined;
  if (operation?.state !== 'failed' || operation?.error !== 'Missing or insufficient permissions.') {
    throw new Error(`예상한 권한 실패 잠금이 아닙니다: ${id}`);
  }
  return { id, inventoryOperation: operation };
});

console.table(rows.map(row => ({
  주문: row.id,
  작업: row.inventoryOperation.id,
  목표상태: row.inventoryOperation.targetStatus,
  실패시각: row.inventoryOperation.startedAt,
})));

if (!APPLY) {
  console.log(`미리보기입니다. ${rows.length}건의 inventoryOperation만 지울 예정입니다.`);
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 실행을 막았습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify(rows, null, 2), 'utf8');

const batch = db.batch();
for (const row of rows) batch.update(db.collection('orders').doc(row.id), { inventoryOperation: FieldValue.delete() });
await batch.commit();

const verified = await Promise.all(TARGET_IDS.map(id => db.collection('orders').doc(id).get()));
const remaining = verified.filter(snapshot => snapshot.data()?.inventoryOperation != null).map(snapshot => snapshot.id);
if (remaining.length) throw new Error(`잠금 해제 확인 실패: ${remaining.join(', ')}`);
console.log(`${rows.length}건의 실패 잠금을 해제하고 재조회로 확인했습니다. 백업: ${BACKUP}`);
