import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { issueVoucher, voucherSequenceKey } from './voucherIssue';
import { receiveOemFinishedGoods } from './oemReceiptCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const companyId = 'taebaek', date = '2026-10-04', releaseId = 'new-scope-test';
let app: admin.app.App, db: admin.firestore.Firestore;
const counterId = voucherSequenceKey(companyId, date);
const collections = ['appMeta', 'issuedStatements', 'cashEntries', 'items', 'purchaseOrders', 'partners', 'item_formula', 'oemReceiptOperations', 'adjustmentRequests'];
async function clear() {
  for (const name of collections) {
    const rows = await db.collection(name).get();
    for (const row of rows.docs) await row.ref.delete();
  }
}
const cash = (operationId: string) => ({ operationId, kind: 'cashEntries' as const, tradeDate: date, releaseId,
  document: { companyId, date, amount: 100, accountCode: '101' } });
const statement = (operationId: string) => ({ operationId, kind: 'issuedStatements' as const, tradeDate: date, releaseId,
  document: { companyId, tradeDate: date, totalSupply: 100, totalTax: 0, totalAmount: 100 } });
const counter = () => db.doc(`appMeta/${counterId}`).get();
async function seedOem() {
  await db.doc('partners/supplier').set({ companyId, name: 'OEM' });
  await db.doc('items/product').set({ companyId, name: 'product', 품목: 'product', procureType: '임가공',
    unit: '개', packageKg: 1, stock: 0, lots: [] });
  await db.doc('item_formula/formula').set({ parent_key: 'product', child_name: 'material', ratio: 1, yield_rate: 1 });
  for (const id of ['po1', 'po2']) await db.doc(`purchaseOrders/${id}`).set({ companyId, poType: 'oem', status: 'invoiced',
    oemPartnerId: 'supplier', oemSent: [{ material: 'material', kg: 5 }] });
}
const receipt = (poId: string, businessDate = date) => ({ poId, operationId: `oem-receive:${poId}`, date: businessDate,
  releaseId, returns: [{ itemId: 'product', qty: 2 }], unitPricePerKg: 500 });

describe.skipIf(!available)('신규 날짜 counter 최초 발행 원자화', { timeout: 30000 }, () => {
  beforeAll(() => { app = admin.initializeApp({ projectId: `demo-new-scope-${randomUUID()}` }); db = app.firestore(); });
  beforeEach(async () => {
    await clear();
    await db.doc('appMeta/releaseCutover').set({ status: 'active', releaseId,
      voucherNotBefore: { taebaek: date, punghoe: date }, oemLotCutoverDate: date,
      oldWritersBlocked: true, oldWritersBlockedEvidence: 'emulator verified' });
  });
  afterAll(async () => { await clear(); await app.delete(); });

  it('양쪽 컬렉션 동시 최초 발행은 1,2를 공유하고 재시도는 번호를 소비하지 않는다', async () => {
    const results = await Promise.all([issueVoucher(db, companyId, cash('cash1')), issueVoucher(db, companyId, statement('statement1'))]);
    expect(results.map(row => row.docNo).sort()).toEqual(['261004-001', '261004-002']);
    expect((await counter()).data()?.last).toBe(2);
    await issueVoucher(db, companyId, cash('cash1'));
    expect((await counter()).data()?.last).toBe(2);
  });

  it('어느 컬렉션이든 기존 번호가 있으면 누락 counter를 0으로 복원하지 않는다', async () => {
    for (const name of ['issuedStatements', 'cashEntries']) {
      await db.doc(`${name}/legacy`).set({ companyId, tradeDate: date, date, docNo: '261004-099' });
      await expect(issueVoucher(db, companyId, cash('new'))).rejects.toThrow('카운터');
      expect((await counter()).exists).toBe(false);
      expect((await db.doc('cashEntries/new').get()).exists).toBe(false);
      await db.doc(`${name}/legacy`).delete();
    }
  });

  it('구 writer 차단 근거 없는 날짜와 과거 및 9/30 추가번호는 자동 초기화하지 않는다', async () => {
    for (const patch of [{ oldWritersBlocked: false }, { oldWritersBlocked: true, oldWritersBlockedEvidence: '' }]) {
      await db.doc('appMeta/releaseCutover').update(patch);
      await expect(issueVoucher(db, companyId, cash('blocked'))).rejects.toThrow('카운터');
    }
    await db.doc('appMeta/releaseCutover').update({ oldWritersBlockedEvidence: 'verified',
      catchUp: { companyId, tradeDate: '2026-09-30', status: 'open' } });
    for (const day of ['2026-10-03', '2026-09-30']) {
      await expect(issueVoucher(db, companyId, { ...cash('past'), tradeDate: day,
        document: { ...cash('past').document, date: day } })).rejects.toThrow();
    }
    expect((await db.doc('appMeta/voucherNo_taebaek_2026-09-30_추가').get()).exists).toBe(false);
  });

  it('타회사 번호는 분리하되 날짜 불명확 및 companyId 없는 태백 번호는 차단한다', async () => {
    await db.doc('issuedStatements/foreign').set({ companyId: 'punghoe', tradeDate: date, docNo: '261004-001' });
    await issueVoucher(db, companyId, cash('own'));
    expect((await counter()).data()?.last).toBe(1);
    await db.doc(`appMeta/${counterId}`).delete();
    await db.doc('cashEntries/own').delete();
    await db.doc('issuedStatements/legacy').set({ tradeDate: 'bad-date', docNo: '261004-01' });
    await expect(issueVoucher(db, companyId, cash('blocked'))).rejects.toThrow('카운터');
  });

  it('OEM 같은 material 동시 최초 입고는 별도 로트번호를 생성한다', async () => {
    await seedOem();
    const results = await Promise.all([receiveOemFinishedGoods(db, companyId, receipt('po1')),
      receiveOemFinishedGoods(db, companyId, receipt('po2'))]);
    expect(results.map(row => row.lotNos.product).sort()).toEqual(['261004-01', '261004-02']);
    expect((await db.doc('items/product').get()).data()?.stock).toBe(4);
    expect((await db.doc('appMeta/oemLotSequence_taebaek_20261004_material').get()).data()?.lastSequence).toBe(2);
  });

  it('OEM 기존 로트 및 과거 날짜는 counter/재고/가공비를 남기지 않는다', async () => {
    await seedOem();
    await db.doc('items/old').set({ companyId, lots: [{ material: 'material', receivedDate: date, lotNo: '261004-99' }] });
    await expect(receiveOemFinishedGoods(db, companyId, receipt('po1'))).rejects.toThrow('카운터');
    await expect(receiveOemFinishedGoods(db, companyId, receipt('po1', '2026-10-03'))).rejects.toThrow('CUTOVER');
    expect((await db.doc('appMeta/oemLotSequence_taebaek_20261004_material').get()).exists).toBe(false);
    expect((await db.doc('items/product').get()).data()?.stock).toBe(0);
    expect((await db.doc('adjustmentRequests/OEMFEE-po1').get()).exists).toBe(false);
  });

  it('OEM counter 준비 이후 업무 검증 실패도 counter를 생성하지 않는다', async () => {
    await seedOem();
    await db.doc('items/product').update({ lots: [{ id: 'lot-oem-po1-product', material: 'material',
      receivedDate: '2026-10-03', lotNo: '261003-01', qtyRemaining: 1 }] });
    await expect(receiveOemFinishedGoods(db, companyId, receipt('po1'))).rejects.toThrow('기존 OEM 로트');
    expect((await db.doc('appMeta/oemLotSequence_taebaek_20261004_material').get()).exists).toBe(false);
    expect((await db.doc('items/product').get()).data()?.stock).toBe(0);
    expect((await db.doc('purchaseOrders/po1').get()).data()?.status).toBe('invoiced');
  });
});
