/** ORD-260917-007을 2026-09-17 생산판매일지에 붙이고 주문 이력으로 마감한다. 기본 dry / --apply / --undo. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ORDER_ID = 'ORD-1789612196734';
const DOC_DATE = '2026-09-17';
const BACKUP = '로컬전용/백업/gadeukchan-document-close-2026-09-18.json';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' }, `fix-gadeukchan-${Date.now()}`);
const db = getFirestore(app);

try {
  if (UNDO) {
    const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
    await db.runTransaction(async tx => {
      tx.set(db.collection('orders').doc(ORDER_ID), backup.order, { merge: false });
      if (backup.log) tx.set(db.collection('productionSalesLogs').doc(backup.log.id), backup.log.data, { merge: false });
      else tx.delete(db.collection('productionSalesLogs').doc(backup.createdLogId));
    });
    console.log('되돌림 완료');
    process.exit(0);
  }

  const [orderSnap, logSnap] = await Promise.all([
    db.collection('orders').doc(ORDER_ID).get(),
    db.collection('productionSalesLogs').where('date', '==', DOC_DATE).get(),
  ]);
  if (!orderSnap.exists) throw new Error(`주문 없음: ${ORDER_ID}`);
  const order = orderSnap.data()!;
  const logs = logSnap.docs.filter(doc => (doc.data().companyId || 'taebaek') === 'taebaek');
  if (logs.length > 1) throw new Error(`9/17 태백 생산판매일지가 ${logs.length}건이라 자동 선택하지 않습니다.`);
  const log = logs[0];
  console.log(`주문 ${order.cardNo} ${order.partnerName}: ${order.status} → DELIVERED (${DOC_DATE})`);
  console.log(`9/17 기존 생산판매일지: ${log ? `${log.id} / 주문 ${log.data().orderCount || 0}건` : '없음(새로 생성)'}`);
  if (!APPLY) process.exit(0);
  if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다: ${BACKUP}`);
  mkdirSync(dirname(BACKUP), { recursive: true });
  const createdLogId = `psl-recovery-${DOC_DATE}`;
  writeFileSync(BACKUP, JSON.stringify({
    createdAt: new Date().toISOString(), order: { id: orderSnap.id, ...order },
    log: log ? { id: log.id, data: log.data() } : null, createdLogId,
  }, null, 2));
  await db.runTransaction(async tx => {
    const summary = { partnerName: order.partnerName, items: (order.items || []).map((item: any) => ({ name: item.name, qty: item.quantity ?? 1 })) };
    const logRef = log?.ref || db.collection('productionSalesLogs').doc(createdLogId);
    if (log) tx.update(logRef, {
      orderCount: Number(log.data().orderCount || 0) + 1,
      orderSummaries: FieldValue.arrayUnion(summary),
    });
    else tx.set(logRef, {
      id: createdLogId, companyId: 'taebaek', date: DOC_DATE, createdAt: new Date().toISOString(), createdBy: '복구 스크립트',
      orderCount: 1, productionRows: [], seedRows: [], salesRows: [], extraRows: [], orderSummaries: [summary],
    });
    tx.update(orderSnap.ref, { status: 'DELIVERED', deliveredAt: `${DOC_DATE}T00:00:00.000Z` });
  });
  console.log('적용 완료');
} finally {
  await deleteApp(app);
}
