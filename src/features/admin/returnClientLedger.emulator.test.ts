import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } }, onCall: (_: unknown, handler: unknown) => handler }));
import { processGeneralStockReturn } from '../../../functions/src/processReturnCommand';
import { voucherSequenceKey } from '../../../functions/src/voucherIssue';
import { purchaseReturnRequest, salesReturnRequest } from './purchaseReturnRequest';
import { buildItemLedger } from './itemLedger';
import { auditDataIntegrity } from './dataIntegrityAudit';
import type { IssuedStatement, Item } from '../../shared/types';
import type { ItemReceipt } from '../../shared/receipt';
import type { ReturnStockOperation } from '../../shared/returnStockMovement';
const available = ['127.0.0.1:8082', '127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const runId = `return-client-${randomUUID()}`, date = '2026-10-07', companyId = 'taebaek';
let app: admin.app.App | undefined, db: admin.firestore.Firestore;
const owned = new Set<string>();
async function put(group: string, id: string, data: object) { const ref = db.collection(group).doc(id); owned.add(ref.path); await ref.set(data); }
afterAll(async () => {
  if (!app) return;
  for (const group of ['returnOperations', 'returnApplications', 'itemReceipts', 'issuedStatements']) {
    const docs = await db.collection(group).get();
    for (const row of docs.docs) if (row.id.startsWith(runId) || row.id.startsWith(`return-${runId}`)
      || row.data().returnOperationId?.startsWith(runId) || row.data().operationId?.startsWith(runId)) owned.add(row.ref.path);
  }
  for (const suffix of ['purchase', 'sale']) owned.add(`appMeta/partnerPaymentState_${companyId}_${runId}-${suffix}-partner`);
  for (const path of owned) await db.doc(path).delete(); await app.delete();
});
describe.skipIf(!available)('접수 helper→실제 서버 거래→품목원장', { timeout: 30000 }, () => {
  for (const type of ['매입', '매출'] as const) it(`${type}은 반품 원장과 실제 stock이 일치하고 현금은 생성하지 않는다`, async () => {
    app ??= admin.initializeApp({ projectId: 'demo-taebaekfood-local' }, runId); db = admin.firestore(app);
    const suffix = type === '매입' ? 'purchase' : 'sale', id = `${runId}-${suffix}`, partnerId = `${id}-partner`, itemId = `${id}-item`;
    const item = { id: itemId, companyId, name: '합성 일반재고', type: 'goods', unit: '개', stock: 5,
      stocktakeAnchors: [{ id: 'start', date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', targetQty: 5 }] } as Item;
    const source = { id: `${id}-source`, companyId, partnerId, partnerName: '합성 거래처', type, tradeDate: date, issuedAt: `${date}T00:00:00Z`, docNo: '합성 원전표', orderId: '',
      totalAmount: 220, totalSupply: 200, totalTax: 20, items: [{ itemId, name: item.name, spec: '', qty: 2, price: 100,
        accountCode: type === '매입' ? '500' : '404', supply: 200, tax: 20, total: 220 }] } as IssuedStatement;
    const request = (type === '매입' ? purchaseReturnRequest : salesReturnRequest)('taebaek', partnerId, source, [{ itemId, qty: '1' }], [item]);
    const counterId = voucherSequenceKey(companyId, date, '반품');
    await Promise.all([
      put('partners', partnerId, { companyId, name: '합성 거래처' }), put('items', itemId, item),
      put('issuedStatements', source.id, source), put('returnRequests', `${id}-request`, request),
      put('appMeta', 'releaseCutover', { status: 'active', releaseId: runId, voucherNotBefore: { taebaek: date, punghoe: date } }),
      put('appMeta', counterId, { companyId, tradeDate: date, prefix: '반품', last: 0 }),
      ...['returnCutover', 'partnerPaymentCutover'].map(prefix => put('appMeta', `${prefix}_${companyId}`, { companyId, enabled: true, auditPassed: true, legacyWritersBlocked: true, purchaseGeneralStockEnabled: true })),
      ...['500', '404', '108', '135', '251', '253', '255'].map(code => put('accountCodes', `${id}-${code}`, { companyId, code })),
    ]);
    const input = { operationId: id, returnRequestId: `${id}-request`, tradeDate: date, expectedPartnerRevision: 0, releaseId: runId };
    await processGeneralStockReturn(db, companyId, `${runId}-actor`, input);
    const operationDoc = await db.collection('returnOperations').doc(id).get();
    const operation = { ...operationDoc.data(), id } as ReturnStockOperation;
    const receiptRows = await db.collection('itemReceipts').where('returnOperationId', '==', id).get();
    const receipts = receiptRows.docs.map(row => ({ ...row.data(), id: row.id }) as ItemReceipt);
    const stored = (await db.collection('items').doc(itemId).get()).data() as Item;
    const ledger = buildItemLedger(itemId, [], [{ ...stored, id: itemId }], receipts, [], undefined, [operation]);
    expect(stored.stock).toBe(type === '매입' ? 4 : 6); expect(ledger.gap).toBe(0);
    expect(ledger.rows.at(-1)?.balance).toBe(stored.stock);
    expect((await db.collection('cashEntries').where('partnerId', '==', partnerId).get()).empty).toBe(true);
    const journal = { ...(await db.collection('issuedStatements').doc(operation.journalId).get()).data(), id: operation.journalId } as IssuedStatement;
    expect(auditDataIntegrity({ companyId: 'taebaek', orders: [], items: [{ ...stored, id: itemId }], itemBoms: [], purchaseOrders: [], itemReceipts: receipts,
      rawMaterialLedger: [], rawInventories: [], issuedStatements: [source, journal], productionSalesLogs: [], returnOperations: [operation] }).filter(row => row.id.startsWith('return-stock:'))).toEqual([]);
    const duplicate = await processGeneralStockReturn(db, companyId, `${runId}-actor`, input); expect(duplicate.status).toBe('duplicate');
    expect((await db.collection('items').doc(itemId).get()).data()?.stock).toBe(stored.stock);
    for (const path of [`returnOperations/${id}`, `issuedStatements/${operation.journalId}`, `appMeta/partnerPaymentState_${companyId}_${partnerId}`]) owned.add(path);
    for (const row of receiptRows.docs) owned.add(row.ref.path);
    const apps = await db.collection('returnApplications').where('operationId', '==', id).get(); for (const row of apps.docs) owned.add(row.ref.path);
  });
});
