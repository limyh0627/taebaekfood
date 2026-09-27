/** 운영 DB에는 연결할 수 없는 이관·원복 통합 검증. 끝나면 팀장 UI 검수용 주문을 남긴다. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrateOrderItemNotes } from '../src/shared/orderNote.ts';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8082';
const db = getFirestore(initializeApp({ projectId: 'demo-taebaekfood-local' }));
mkdirSync('로컬전용/order-item-notes', { recursive: true });
const directory = mkdtempSync('로컬전용/order-item-notes/test-');
const run = (mode: string, path: string, succeeds = true) => {
  const result = spawnSync(process.execPath, ['scripts/fix-order-item-notes.mts', '--emulator', mode, '--plan', path], { encoding: 'utf8', env: process.env });
  assert.equal(result.status === 0, succeeds, result.stderr || result.stdout);
  return result.stdout;
};
const id = 'order-note-migration-qa';
const otherId = 'order-note-migration-punghoe';
const original = {
  companyId: 'taebaek', cardNo: 'ORD-NOTE-QA', partnerId: 'partner-direct', partnerName: '가상직배송마트',
  status: 'PENDING', source: '일반', createdAt: new Date().toISOString(), deliveryDate: new Date().toISOString(),
  totalAmount: 12000, note: '원래 주문 안내', noteBy: '원래 작성자', noteAt: '2026-09-01T00:00:00Z',
  items: [
    { itemId: 'oil-350', name: '가상 참기름/350ml', quantity: 2, price: 3000, note: '이관 장문 전달사항 '.repeat(8), noteImportant: true, noteBy: '직원 A', noteAt: '2026-09-02T00:00:00Z' },
    { itemId: 'powder-1kg', name: '가상 고춧가루/1kg', quantity: 2, price: 3000, note: '두 번째 품목 안내', noteBy: '직원 B' },
  ],
};
const other = { ...original, companyId: 'punghoe', cardNo: 'ORD-NOTE-P-QA' };
const read = async (key: string) => (await db.collection('orders').doc(key).get()).data();
try {
  await db.collection('orders').doc(id).set(original);
  await db.collection('orders').doc(otherId).set(other);
  const path = `${directory}/plan.json`;
  run('--dry', path);
  const plan = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(plan.rows.filter((row: any) => row.id === id || row.id === otherId).length, 2);
  const inventoryBefore = (await db.collection('items').get()).docs.map(doc => doc.data());
  // 승인 뒤 한 주문만 바뀌어도 다른 주문까지 전부 미적용이어야 한다.
  await db.collection('orders').doc(id).update({ note: '동시 수정' });
  run('--apply', path, false);
  assert.deepEqual(await read(otherId), other);
  await db.collection('orders').doc(id).update({ note: original.note });
  run('--apply', path);
  assert.deepEqual(await read(id), migrateOrderItemNotes(original));
  assert.deepEqual(await read(otherId), migrateOrderItemNotes(other));
  assert.deepEqual((await db.collection('items').get()).docs.map(doc => doc.data()), inventoryBefore);
  assert.ok(String((await read(id))?.note).length > 50);
  run('--apply', path, false); // 기존 백업 재적용 차단
  const again = `${directory}/again.json`;
  run('--dry', again);
  assert.equal(JSON.parse(readFileSync(again, 'utf8')).rows.some((row: any) => row.id === id), false);
  await db.collection('orders').doc(id).update({ note: '원복 전 동시 수정' });
  run('--undo', path, false);
  assert.deepEqual(await read(otherId), migrateOrderItemNotes(other));
  await db.collection('orders').doc(id).update({ note: migrateOrderItemNotes(original).note });
  run('--undo', path);
  assert.deepEqual(await read(id), original);
  assert.deepEqual(await read(otherId), other);
  run('--undo', path); // 원복 재실행 무변경
  const finalPath = `${directory}/qa.json`;
  run('--dry', finalPath);
  run('--apply', finalPath);
  console.log(`검증 통과: dry/apply/재적용 차단/무대상/동시변경 전체 차단/undo/원본 메타·재고 보존. UI 주문 ${id}, ORD-NOTE-QA, ${String((await read(id))?.note).length}자`);
} finally { await db.terminate(); }
