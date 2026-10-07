/** 사용자 지정 해피유통 탈피 주문만 공용 출고 취소 계산으로 복원한다. */
import { adminDb } from './_admin.mts';
import { planOrderCancellation, prepareCancelledItem, cancellationEvidence } from '../src/features/admin/orderInventoryCancellation';
import { OrderStatus, type Order, type Item } from '../src/shared/types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const db = adminDb(), id = 'ORD-1790915834767', base = 'outputs/happy-shipment-cancel-20261007/';
const apply = process.argv.includes('--apply'), undo = process.argv.includes('--undo');
assert(!(apply && undo)); mkdirSync(base, { recursive: true });
const ref = db.collection('orders').doc(id);
if (undo) {
  const saved = JSON.parse(readFileSync(base + 'verification.json', 'utf8'));
  await db.runTransaction(async tx => {
    const docs = await Promise.all(saved.docs.map((row: any) => tx.get(db.doc(row.path))));
    docs.forEach((doc: any, index: number) => assert.deepStrictEqual(doc.data(), saved.docs[index].after));
    saved.docs.forEach((row: any) => row.before ? tx.set(db.doc(row.path), row.before) : tx.delete(db.doc(row.path)));
  });
  console.log('출고 취소 정정 원복 완료'); process.exit(0);
}
assert(!existsSync(base + 'verification.json'), '이미 검증된 복원을 다시 실행하지 않습니다.');
const snapshot = await ref.get(), original = snapshot.data()!;
const order = { ...original, id } as Order;
assert.equal(order.companyId, 'taebaek'); assert.equal(order.partnerName, '해피유통');
assert.equal(order.cardNo, 'ORD-261002-006'); assert.equal(order.status, OrderStatus.SHIPPED);
assert.equal(order.inventoryOperation, null);
const plan = planOrderCancellation(order, 'cancel-shipment');
assert.equal(plan.rawOriginals.size, 0);
assert.deepStrictEqual([...plan.deltas], [['box-p-1774849779025-10', 36]]);
const evidence = createHash('sha256').update(cancellationEvidence(order, 'cancel-shipment')).digest('hex');
const operationId = `order-cancellation-cancel-shipment-${id}-${evidence}`;
const auditRef = db.collection('orderStatusAudits').doc(operationId);
assert(!(await auditRef.get()).exists);
const rows = await Promise.all([...plan.deltas].map(async ([itemId, delta]) => {
  const doc = await db.collection('items').doc(itemId).get(); assert(doc.exists);
  const item = { ...doc.data(), id: itemId } as Item;
  const patch = prepareCancelledItem({ ...order, inventoryOperation: { id: operationId } as any }, item, delta, 'cancel-shipment', plan.lotTraces);
  assert.equal(item.stock, 0); assert.equal(patch.stock, 36);
  assert.equal((patch.lots as any[]).reduce((sum, lot) => sum + Number(lot.qtyRemaining ?? 0), 0), 36);
  return { path: doc.ref.path, before: doc.data(), patch };
}));
const orderPatch = { status: OrderStatus.DISPATCHED, shippedOut: false, productConsumedLots: [], shipmentConfirmedBy: null, shipmentConfirmedAt: null,
  inventorySnapshots: { ...order.inventorySnapshots, shipment: { ...order.inventorySnapshots!.shipment!, stockDeltas: [], productConsumedLots: [] } }, inventoryOperation: null };
const audit = { id: operationId, companyId: 'taebaek', orderId: id, partnerName: order.partnerName,
  previousStatus: OrderStatus.SHIPPED, nextStatus: OrderStatus.DISPATCHED, state: 'completed', approvedBy: '사용자 요청·Codex',
  approvedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  stockAdjustments: [...plan.deltas].map(([itemId, delta]) => ({ itemId, delta })),
  cancellation: { action: 'cancel-shipment', evidence, deleted: false } };
const docs = [{ path: ref.path, before: original, after: { ...original, ...orderPatch } },
  ...rows.map(row => ({ path: row.path, before: row.before, after: { ...row.before, ...row.patch } })),
  { path: auditRef.path, before: null, after: audit }];
const saved = { orderId: id, operationId, docs };
if (!apply) { writeFileSync(base + 'plan.json', JSON.stringify(saved, null, 2)); console.log('출고 취소 검증: 숫자 재고0→36, 원래 로트0→36, 주문 SHIPPED→DISPATCHED'); process.exit(0); }
assert.deepStrictEqual(JSON.parse(readFileSync(base + 'plan.json', 'utf8')).docs.map((row: any) => ({ path: row.path, before: row.before })), docs.map(row => ({ path: row.path, before: row.before })));
writeFileSync(base + 'before.json', JSON.stringify(saved, null, 2));
await db.runTransaction(async tx => {
  const current = await Promise.all(docs.map(row => tx.get(db.doc(row.path))));
  current.forEach((doc, index) => assert.deepStrictEqual(doc.data() ?? null, docs[index].before));
  tx.update(ref, orderPatch); rows.forEach(row => tx.update(db.doc(row.path), row.patch)); tx.create(auditRef, audit);
});
for (const row of docs) assert.deepStrictEqual((await db.doc(row.path).get()).data(), row.after);
writeFileSync(base + 'verification.json', JSON.stringify({ ...saved, verified: true, verifiedAt: new Date().toISOString() }, null, 2));
console.log('해피유통 탈피 ORD-261002-006 출고 취소: 재고36·원래 로트36·작업완료·잠금없음 재조회 검증 완료');
