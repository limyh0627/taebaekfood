// 한울유통 ORD-261030-012 삭제(사장님 요청, 주문을 새로 넣어 처리). 끝나지 않은 처리 요청을 서버 명령으로 중단해 예약을 푼 뒤 앱 삭제와 같은 기록을 남기고 지운다.
// 기본 dry / 실제 적용 --apply / 되돌리기 --undo (주문 문서만 복원. 중단한 요청과 풀린 예약은 되살리지 않는다)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const admin: any = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin');
const load = async (path: string): Promise<any> => { const m: any = await import(path); return { ...(m.default ?? {}), ...m }; };
const { executeOrderProductionBatchCommand } = await load('../functions/src/orderProductionBatchCommand.ts');
const { planOrderCancellation } = await load('../functions/src/shared/orderInventoryCancellationPlan.ts');
const { cancellationEvidenceText } = await load('../functions/src/shared/orderCancellationEvidence.ts');

const APPLY = process.argv.includes('--apply'), UNDO = process.argv.includes('--undo');
const ORDER = 'ORD-1793329798910', CARD = 'ORD-261030-012', COMPANY = 'taebaek';
const ATTEMPT = '45ac55e03a94e7843f8a9bde82c09f594859dd78e6ab54029d61ab6321afe3db', OPERATION = 'private-stock-full-v1:' + ATTEMPT;
const BACKUP = '로컬전용/백업/hanul-ORD-261030-012-before-delete.json';
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const orderRef = db.doc('orders/' + ORDER);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error('백업이 없습니다: ' + BACKUP);
  if ((await orderRef.get()).exists) throw new Error('주문이 이미 있습니다. 덮어쓰지 않습니다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const { inventoryOperation: _lock, ...order } = backup.order;
  await orderRef.set(order);
  console.log('주문 문서를 복원했습니다(처리 잠금 제외).');
  process.exit(0);
}

const now = new Date().toISOString(), clock = { now, nowMs: Date.parse(now) };
const adminDoc = (await db.doc('employees/admin').get()).data();
const actor = { uid: adminDoc.authUid, token: { companyId: COMPANY, employeeId: 'admin' } } as any;
const orderSnap = await orderRef.get();
if (!orderSnap.exists) { console.log('주문이 이미 없습니다.'); process.exit(0); }
const order = orderSnap.data();
const attemptSnap = await db.doc('orderStockFullAttemptsV1/' + ATTEMPT).get(), attempt = attemptSnap.data();
const itemIds: string[] = order.items.map((line: any) => line.itemId);
const readItems = async () => Object.fromEntries(await Promise.all(itemIds.map(async id => [id, (await db.doc('items/' + id).get()).data()])));
const items = await readItems();
const heldBy = (item: any) => (item.inventoryReservations ?? []).filter((row: any) => row.orderId === ORDER).map((row: any) => [row.qty, row.state]);

console.log('주문', JSON.stringify({ card: order.cardNo, partner: order.partnerName, status: order.status, lock: order.inventoryOperation?.id?.slice(0, 40), lockState: order.inventoryOperation?.state, refs: !!order.orderProductionRefsV1, producedAt: order.producedAt ?? null, updated: orderSnap.updateTime.toDate().toISOString() }));
console.log('요청', JSON.stringify({ state: attempt?.state, requestedAt: attempt?.clock?.now, updated: attemptSnap.updateTime?.toDate().toISOString() }));
for (const id of itemIds) console.log('품목', id, items[id].name, 'stock', items[id].stock, 'floor', items[id].serverReservedStockFloorV1 ?? null, '이 주문 예약', JSON.stringify(heldBy(items[id])));

const stop = (why: string) => { console.log('중단:', why); process.exit(1); };
if (order.cardNo !== CARD || order.companyId !== COMPANY || !String(order.partnerName).includes('한울')) stop('대상 주문이 아닙니다.');
if (order.status !== 'PENDING' || order.orderProductionRefsV1 || order.producedAt || order.shippedOut) stop('확인한 뒤 상태가 바뀌었습니다.');
if (order.inventoryOperation?.id !== OPERATION || attempt?.state !== 'reserved') stop('확인한 처리 요청과 다릅니다.');
const locator = { reference: attempt.reference, originalOwnerUid: attempt.owner?.uid };
const inspected: any = await executeOrderProductionBatchCommand(db, actor, { version: 1, mode: 'inspect', locator }, clock);
console.log('요청 확인', JSON.stringify({ state: inspected.state, canCancel: inspected.canCancel, canApply: inspected.canApply, reason: inspected.reason, message: inspected.message }));
if (inspected.state !== 'reserved' || !inspected.canCancel) stop('서버가 요청 중단을 허용하지 않습니다.');
const evidenceNow = planOrderCancellation({ ...order, id: ORDER, inventoryOperation: undefined }, 'delete');
console.log('삭제 계획', JSON.stringify({ recordOnly: evidenceNow.recordOnly, deltas: [...evidenceNow.deltas], snapshots: evidenceNow.snapshots.length, lots: evidenceNow.lotTraces.length }));
if (evidenceNow.snapshots.length || evidenceNow.deltas.size || evidenceNow.lotTraces.length) stop('되돌릴 재고가 있는 주문입니다.');
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);

if (existsSync(BACKUP)) stop('기존 백업이 있습니다: ' + BACKUP);
mkdirSync('로컬전용/백업', { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: now, order, attempt: { state: attempt.state, reference: attempt.reference, owner: attempt.owner }, items: Object.fromEntries(itemIds.map(id => [id, { name: items[id].name, stock: items[id].stock, inventoryReservations: items[id].inventoryReservations ?? [], fullReservationRows: items[id].fullReservationRows ?? [], serverReservedStockFloorV1: items[id].serverReservedStockFloorV1 ?? null }])) }, null, 2), 'utf8');

const cancelled: any = await executeOrderProductionBatchCommand(db, actor, { version: 1, mode: 'cancel', locator, expectedRequestHash: attempt.requestHash }, clock);
console.log('요청 중단', JSON.stringify({ state: cancelled.state, reason: cancelled.reason, message: cancelled.message }));
if (cancelled.state !== 'cancelled') stop('요청이 중단되지 않아 삭제하지 않습니다. 주문은 그대로입니다.');

const operationId = await db.runTransaction(async (tx: any) => {
  const snap = await tx.get(orderRef); if (!snap.exists) throw new Error('주문 없음');
  const live = { ...snap.data(), id: ORDER };
  if (live.inventoryOperation) throw new Error('처리 잠금이 남아 있습니다: ' + JSON.stringify(live.inventoryOperation).slice(0, 120));
  const plan = planOrderCancellation(live, 'delete');
  if (plan.snapshots.length || plan.deltas.size || plan.lotTraces.length) throw new Error('되돌릴 재고가 생겼습니다.');
  for (const id of itemIds) {
    const item = (await tx.get(db.doc('items/' + id))).data();
    if (heldBy(item).length) throw new Error('예약이 남아 있습니다: ' + item.name);
  }
  const evidence = createHash('sha256').update(cancellationEvidenceText(live, 'delete')).digest('hex');
  const id = `order-cancellation-delete-${ORDER}-${evidence}`;
  const at = new Date().toISOString();
  tx.set(db.doc('orderStatusAudits/' + id), { id, companyId: COMPANY, orderId: ORDER, partnerName: live.partnerName ?? '', previousStatus: live.status, nextStatus: 'PENDING', approvedBy: '사장님 승인(Claude Code 대리)', approvedAt: at, completedAt: at, state: 'completed', legacyEvidenceWarning: false, stockAdjustments: [], cancellation: { action: 'delete', evidence, deleted: true }, beforeOrderWriteRevision: live.inventoryWriteRevision ?? 0 });
  tx.delete(orderRef);
  return id;
});

if ((await orderRef.get()).exists) throw new Error('적용 뒤 재조회: 주문이 남아 있습니다.');
if (!(await db.doc('orderStatusAudits/' + operationId).get()).exists) throw new Error('적용 뒤 재조회: 삭제 기록이 없습니다.');
const after = await readItems();
for (const id of itemIds) {
  console.log('재조회', after[id].name, 'stock', items[id].stock, '→', after[id].stock, 'floor', after[id].serverReservedStockFloorV1 ?? null, '이 주문 예약', JSON.stringify(heldBy(after[id])));
  if (after[id].stock !== items[id].stock || heldBy(after[id]).length) throw new Error('적용 뒤 재조회: 재고나 예약이 예상과 다릅니다: ' + after[id].name);
}
console.log('삭제·재조회 검증 완료', operationId.slice(0, 60));
process.exit(0);
