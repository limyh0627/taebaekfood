import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { receiveOemFinishedGoods } from './oemReceiptCommand';

const prefix = `oem-receipt-${randomUUID()}`;
const projectId = 'demo-oem-receipt-command';
const poId = `${prefix}-po`;
const itemId = `${prefix}-item`;
const partnerId = `${prefix}-partner`;
const phantomId = `${prefix}-phantom`;
const material = `${prefix}-material`;
const minorPhantomMaterial = `${prefix}-minor-phantom`;
const date = '2026-10-03';
const operationId = `oem-receive:${poId}`;
const counterId = `oemLotSequence_taebaek_20261003_${encodeURIComponent(material)}`;
const paths = [
  `appMeta/releaseCutover`, `appMeta/${counterId}`, `purchaseOrders/${poId}`,
  `partners/${partnerId}`, `items/${itemId}`, `item_formula/${prefix}-formula`,
  `items/${phantomId}`,
  `item_formula/${prefix}-minor-formula`,
  `adjustmentRequests/OEMFEE-${poId}`, `oemReceiptOperations/${operationId}`,
];
let app: admin.app.App;
let db: admin.firestore.Firestore;
const input = (releaseId = prefix) => ({ poId, operationId, date, releaseId,
  returns: [{ itemId, qty: 5 }], unitPricePerKg: 500 });
const saved = async (path: string) => (await db.doc(path).get()).data();

describe('OEM finished-goods server transaction', () => {
  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8182';
    process.env.GCLOUD_PROJECT = projectId;
    app = admin.initializeApp({ projectId }, prefix);
    db = app.firestore();
    for (const path of paths) expect((await db.doc(path).get()).exists).toBe(false);
    await Promise.all([
      db.doc('appMeta/releaseCutover').create({ status: 'active', releaseId: prefix, oemLotCutoverDate: date, testRunId: prefix }),
      db.doc(`appMeta/${counterId}`).create({ companyId: 'taebaek', material, date, lastSequence: 0, testRunId: prefix }),
      db.doc(`purchaseOrders/${poId}`).create({ id: poId, companyId: 'taebaek', poType: 'oem',
        status: 'invoiced', oemPartnerId: partnerId, partnerName: 'demo OEM', oemSent: [{ material, kg: 6 }], testRunId: prefix }),
      db.doc(`partners/${partnerId}`).create({ companyId: 'taebaek', name: 'demo OEM', testRunId: prefix }),
      db.doc(`items/${itemId}`).create({ id: itemId, companyId: 'taebaek', name: `${prefix} product`,
        품목: `${prefix} product`, procureType: '임가공', unit: '개', packageKg: 1,
        stock: 2, lots: [], testRunId: prefix }),
      db.doc(`item_formula/${prefix}-formula`).create({ parent_key: `${prefix} product`, child_name: material,
        ratio: 1, yield_rate: 1, testRunId: prefix }),
    ]);
  }, 30000);
  afterAll(async () => {
    if (db) {
      for (const path of paths.reverse()) {
        const snap = await db.doc(path).get();
        if (!snap.exists) continue;
        if (path === 'appMeta/releaseCutover' && snap.data()?.testRunId !== prefix) throw new Error('gate ownership changed');
        if (path.includes(prefix) || snap.data()?.testRunId === prefix) await db.doc(path).delete();
      }
    }
    if (app) await app.delete();
  }, 30000);

  it('rejects bulk and release mismatch without a write', async () => {
    await expect(receiveOemFinishedGoods(db, 'taebaek', { ...input(), bulk: [{ material, kg: 1 }] }))
      .rejects.toThrow('벌크');
    await expect(receiveOemFinishedGoods(db, 'taebaek', input('other-release'))).rejects.toThrow('배포');
    expect((await saved(`items/${itemId}`))?.stock).toBe(2);
    expect((await saved(`purchaseOrders/${poId}`))?.status).toBe('invoiced');
  });

  it('requires an approved OEM lot start date and rejects earlier dates even with a counter', async () => {
    const gateRef = db.doc('appMeta/releaseCutover');
    try {
      await gateRef.update({ oemLotCutoverDate: admin.firestore.FieldValue.delete() });
      await expect(receiveOemFinishedGoods(db, 'taebaek', input())).rejects.toThrow('OEM_LOT_DATE_BEFORE_CUTOVER');
      await gateRef.update({ oemLotCutoverDate: '2026-10-04' });
      await expect(receiveOemFinishedGoods(db, 'taebaek', input())).rejects.toThrow('OEM_LOT_DATE_BEFORE_CUTOVER');
      expect((await saved(`appMeta/${counterId}`))?.lastSequence).toBe(0);
      expect((await saved(`items/${itemId}`))?.stock).toBe(2);
      expect((await saved(`purchaseOrders/${poId}`))?.status).toBe('invoiced');
    } finally {
      await gateRef.update({ oemLotCutoverDate: date });
    }
  });

  it('rejects same-company phantom formula material even without a BOM child edge or exact item name', async () => {
    await db.doc(`items/${phantomId}`).create({ companyId: 'taebaek', name: `${material}/25kg`,
      phantom: true, stock: 0, testRunId: prefix });
    try {
      await expect(receiveOemFinishedGoods(db, 'taebaek', input())).rejects.toThrow('팬텀');
      expect((await saved(`items/${itemId}`))?.stock).toBe(2);
      expect((await saved(`purchaseOrders/${poId}`))?.status).toBe('invoiced');
      expect((await db.doc(`adjustmentRequests/OEMFEE-${poId}`).get()).exists).toBe(false);
    } finally {
      await db.doc(`items/${phantomId}`).delete();
    }
  });

  it('rejects a lower-ratio phantom branch even when the selected lot material is ordinary', async () => {
    await db.doc(`items/${phantomId}`).create({ companyId: 'taebaek', name: `${minorPhantomMaterial}/25kg`,
      phantom: true, stock: 0, testRunId: prefix });
    await db.doc(`item_formula/${prefix}-minor-formula`).create({ parent_key: `${prefix} product`,
      child_name: minorPhantomMaterial, ratio: 0.1, yield_rate: 1, testRunId: prefix });
    try {
      await expect(receiveOemFinishedGoods(db, 'taebaek', input())).rejects.toThrow('팬텀');
      expect((await saved(`items/${itemId}`))?.stock).toBe(2);
      expect((await saved(`purchaseOrders/${poId}`))?.status).toBe('invoiced');
      expect((await db.doc(`adjustmentRequests/OEMFEE-${poId}`).get()).exists).toBe(false);
      expect((await saved(`appMeta/${counterId}`))?.lastSequence).toBe(0);
    } finally {
      await db.doc(`item_formula/${prefix}-minor-formula`).delete();
      await db.doc(`items/${phantomId}`).delete();
    }
  });

  it('commits stock, lot, counter, PO, fee and operation once; rejects changed retry', async () => {
    const applied = await receiveOemFinishedGoods(db, 'taebaek', input());
    expect(applied).toMatchObject({ status: 'applied', receivedKg: 5, loss: 1 });
    expect(applied.lotNos[itemId]).toBe('261003-01');
    expect((await saved(`items/${itemId}`))?.stock).toBe(7);
    expect((await saved(`items/${itemId}`))?.lots).toHaveLength(2);
    expect((await saved(`appMeta/${counterId}`))?.lastSequence).toBe(1);
    expect((await saved(`purchaseOrders/${poId}`))?.status).toBe('received');
    expect((await saved(`adjustmentRequests/OEMFEE-${poId}`))?.oemTotal).toBe(2500);
    expect((await saved(`oemReceiptOperations/${operationId}`))?.fingerprint).toBeTruthy();
    expect(await receiveOemFinishedGoods(db, 'taebaek', input())).toMatchObject({ status: 'duplicate', lotNos: applied.lotNos });
    await expect(receiveOemFinishedGoods(db, 'taebaek', { ...input(), unitPricePerKg: 600 }))
      .rejects.toThrow('재시도');
    expect((await saved(`appMeta/${counterId}`))?.lastSequence).toBe(1);
  });

  it('rejects a paused duplicate and foreign company', async () => {
    await expect(receiveOemFinishedGoods(db, 'punghoe', input())).rejects.toThrow('회사');
    await db.doc('appMeta/releaseCutover').update({ status: 'paused' });
    await expect(receiveOemFinishedGoods(db, 'taebaek', input())).rejects.toThrow('활성화');
  });
});
