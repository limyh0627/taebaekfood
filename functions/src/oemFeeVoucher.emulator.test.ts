import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { issueOemFeeVoucher, issueOemFeeVoucherCommand } from './oemFeeVoucher';
import { issueVoucher } from './voucherIssue';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const projectId = `demo-oem-shared-sequence-${Math.random().toString(36).slice(2)}`;
const date = '2026-10-03';
const counterId = `voucherNo_taebaek_${date}_가공`;
const releaseId = 'oem-test-release';
let app: admin.app.App;
let db: admin.firestore.Firestore;
const statement = (poId: string) => ({
  id: `OEMFEE-${poId}`, companyId: 'taebaek', issuedAt: `${date}T09:00:00.000Z`, tradeDate: date,
  type: '매입', partnerId: 'factory', partnerName: '외주 공장', orderId: poId, docNo: 'untrusted',
  totalSupply: 4545, totalTax: 455, totalAmount: 5000,
  items: [{ name: '외주가공비 (0kg→10kg)', spec: '', qty: 1, price: 4545, supply: 4545, tax: 455,
    total: 5000, isTaxExempt: false, accountCode: '540' }],
});
const command = (poId: string) => ({ poId, perKg: 500, statement: statement(poId), releaseId });
async function seed(poIds: string[], counter = true) {
  await Promise.all([
    db.collection('partners').doc('factory').set({ companyId: 'taebaek', name: '외주 공장' }),
    db.collection('accountCodes').doc('oem-fee').set({ companyId: 'taebaek', code: '540', name: '외주가공비' }),
    ...poIds.map(id => db.collection('purchaseOrders').doc(id).set({
      companyId: 'taebaek', poType: 'oem', status: 'received', oemPartnerId: 'factory',
      partnerName: '외주 공장', oemReceivedKg: 10,
    })),
    counter ? db.collection('appMeta').doc(counterId).set({ companyId: 'taebaek', tradeDate: date, prefix: '가공', last: 0 }) : Promise.resolve(),
    db.collection('appMeta').doc('releaseCutover').set({ status: 'active', releaseId, voucherNotBefore: { taebaek: date } }),
  ]);
}

describe.skipIf(!available)('OEM 가공비 공통 번호 Firestore SDK 거래', () => {
  beforeAll(async () => { app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
  afterAll(async () => { await app?.delete(); });

  it('비관리자와 다른 회사 요청은 발행 전에 거절한다', async () => {
    const callable = issueOemFeeVoucherCommand as unknown as (request: unknown) => Promise<string>;
    await expect(callable({ data: command('po-auth') })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'employee', token: { companyId: 'taebaek', isAdmin: false } }, data: command('po-auth') }))
      .rejects.toThrow('관리자');
    await expect(issueOemFeeVoucher(db, 'punghoe', command('po-auth'))).rejects.toThrow('회사');
  });

  it('가공비 전표·PO 링크·공통 카운터를 같이 쓰고 재시도는 번호를 소비하지 않는다', async () => {
    await seed(['po-1']);
    await db.collection('adjustmentRequests').doc('OEMFEE-po-1').set({ companyId: 'taebaek',
      type: 'oem_fee', oemPoId: 'po-1', oemFeePerKg: 500, oemTotal: 5000, status: 'pending' });
    expect(await issueOemFeeVoucher(db, 'taebaek', command('po-1'))).toBe('OEMFEE-po-1');
    expect((await db.collection('adjustmentRequests').doc('OEMFEE-po-1').get()).data()?.status).toBe('processed');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-1').get()).data()?.docNo).toBe('가공261003-001');
    expect((await db.collection('purchaseOrders').doc('po-1').get()).data()?.linkedStatementId).toBe('OEMFEE-po-1');
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(1);
    await db.collection('appMeta').doc(counterId).delete();
    expect(await issueOemFeeVoucher(db, 'taebaek', command('po-1'))).toBe('OEMFEE-po-1');
    await db.collection('appMeta').doc('releaseCutover').update({ status: 'paused' });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-1'))).rejects.toThrow('활성화');
    await db.collection('appMeta').doc('releaseCutover').update({ status: 'active' });
    await db.collection('purchaseOrders').doc('po-1').update({ linkedStatementId: 'wrong' });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-1'))).rejects.toThrow('다른 가공비');
  });

  it('일반 서버 발행과 OEM 동시 요청도 같은 가공 번호통에서 서로 다른 번호를 받는다', async () => {
    await seed(['po-2']);
    const general = { kind: 'issuedStatements' as const, operationId: 'manual-oem-fee', tradeDate: date, prefix: '가공', releaseId,
      document: { companyId: 'taebaek', tradeDate: date, type: '매입', totalSupply: 100, totalTax: 0,
        totalAmount: 100, items: [{ accountCode: '540', total: 100 }] } };
    const [oemId, issued] = await Promise.all([
      issueOemFeeVoucher(db, 'taebaek', command('po-2')),
      issueVoucher(db, 'taebaek', general),
    ]);
    const oemNo = (await db.collection('issuedStatements').doc(oemId).get()).data()?.docNo;
    expect(oemNo).not.toBe(issued.docNo);
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(2);
  }, 20_000);

  it('카운터 부재 또는 오래된 임의 ID 전표는 PO·전표를 미반영한다', async () => {
    await seed(['po-3', 'po-4'], false);
    await db.collection('appMeta').doc(counterId).delete();
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-3'))).rejects.toThrow('카운터');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-3').get()).exists).toBe(false);
    expect((await db.collection('purchaseOrders').doc('po-3').get()).data()?.linkedStatementId).toBeUndefined();
    await db.collection('appMeta').doc(counterId).set({ companyId: 'taebaek', tradeDate: date, prefix: '가공', last: 0 });
    await db.collection('issuedStatements').doc('legacy-1').set({ companyId: 'taebaek', orderId: 'po-4', type: '매입' });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-4'))).rejects.toThrow('기존 가공비');
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(0);
  });

  it('옛 결정적 ID 전표의 누락된 링크는 원번호를 보존해 복구한다', async () => {
    await seed(['po-5'], false);
    await db.collection('appMeta').doc(counterId).delete();
    await db.collection('issuedStatements').doc('OEMFEE-po-5').set({ ...statement('po-5'), docNo: '옛가공번호' });
    expect(await issueOemFeeVoucher(db, 'taebaek', command('po-5'))).toBe('OEMFEE-po-5');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-5').get()).data()?.docNo).toBe('옛가공번호');
    expect((await db.collection('purchaseOrders').doc('po-5').get()).data()?.linkedStatementId).toBe('OEMFEE-po-5');
    expect((await db.collection('appMeta').doc(counterId).get()).exists).toBe(false);
  });

  it('두 OEM 배치가 동시에 발행하면 가공 번호가 겹치지 않는다', async () => {
    await seed(['po-6', 'po-7']);
    const ids = await Promise.all(['po-6', 'po-7'].map(poId => issueOemFeeVoucher(db, 'taebaek', command(poId))));
    const numbers = await Promise.all(ids.map(async id => (await db.collection('issuedStatements').doc(id).get()).data()?.docNo));
    expect(new Set(numbers).size).toBe(2);
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(2);
  }, 20_000);

  it('손상 카운터 또는 바뀐 가공입고 중량이면 PO 링크와 전표 모두 미반영이다', async () => {
    await seed(['po-8']);
    await db.collection('appMeta').doc(counterId).update({ last: 1.5 });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-8'))).rejects.toThrow('카운터');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-8').get()).exists).toBe(false);
    expect((await db.collection('purchaseOrders').doc('po-8').get()).data()?.linkedStatementId).toBeUndefined();
    await db.collection('appMeta').doc(counterId).update({ last: 0 });
    await db.collection('purchaseOrders').doc('po-8').update({ oemReceivedKg: 11 });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-8'))).rejects.toThrow('중량');
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(0);
  });

  it('PO 링크만 있고 원전표가 사라진 상태에서는 번호를 새로 발급하지 않는다', async () => {
    await seed(['po-9']);
    await db.collection('purchaseOrders').doc('po-9').update({ linkedStatementId: 'OEMFEE-po-9' });
    await expect(issueOemFeeVoucher(db, 'taebaek', command('po-9'))).rejects.toThrow('정합성');
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(0);
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-9').get()).exists).toBe(false);
  });

  it('품목·벌크 가공비 줄을 PO에서 재계산하고 위조 단가·세액·계정·수량을 거절한다', async () => {
    await seed(['po-10']);
    await Promise.all([
      db.collection('purchaseOrders').doc('po-10').update({
        items: [{ itemId: 'product-1', name: '받은 제품', quantity: 2, unit: '개' }],
        oemReceivedBulk: [{ material: '벌크', kg: 3 }],
      }),
      db.collection('items').doc('product-1').set({ companyId: 'taebaek', name: '받은 제품', spec: '3.5kg', packageKg: 3.5, type: 'product' }),
    ]);
    const product = { name: '받은 제품', spec: '3.5kg', qty: 2, price: 1591,
      supply: 3182, tax: 318, total: 3500, isTaxExempt: false, accountCode: '540' };
    const bulk = { name: '벌크 벌크 가공비', spec: 'kg', qty: 3, price: 455,
      supply: 1364, tax: 136, total: 1500, isTaxExempt: false, accountCode: '540' };
    const valid = { ...command('po-10'), statement: { ...statement('po-10'),
      totalSupply: 4546, totalTax: 454, items: [product, bulk] } };
    for (const change of [
      { price: NaN }, { price: -1 }, { supply: -100, tax: 3600 },
      { accountCode: '500' }, { qty: 1 },
    ]) {
      const altered = { ...valid, statement: { ...valid.statement,
        items: [{ ...product, ...change }, bulk] } };
      await expect(issueOemFeeVoucher(db, 'taebaek', altered)).rejects.toThrow();
    }
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(0);
    expect(await issueOemFeeVoucher(db, 'taebaek', valid)).toBe('OEMFEE-po-10');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-10').get()).data()?.items).toHaveLength(2);
  });

  it('BOM으로 묶인 박스 품목의 kg 환산을 PO 줄과 대조한다', async () => {
    await seed(['po-11']);
    await Promise.all([
      db.collection('purchaseOrders').doc('po-11').update({ oemReceivedKg: 4,
        items: [{ itemId: 'box', name: '2개입 박스', quantity: 2, unit: '개' }] }),
      db.collection('items').doc('box').set({ companyId: 'taebaek', name: '2개입 박스', spec: '1kg × 2', unit: '개', type: 'product' }),
      db.collection('items').doc('loose').set({ companyId: 'taebaek', name: '낱개', type: 'product' }),
      db.collection('item_bom').doc('box-loose').set({ parent_id: 'box', child_id: 'loose', quantity: 2 }),
    ]);
    const boxed = { ...command('po-11'), statement: { ...statement('po-11'),
      totalSupply: 1818, totalTax: 182, totalAmount: 2000,
      items: [{ name: '2개입 박스', spec: '1kg × 2', qty: 2, price: 909,
        supply: 1818, tax: 182, total: 2000, isTaxExempt: false, accountCode: '540' }] } };
    expect(await issueOemFeeVoucher(db, 'taebaek', boxed)).toBe('OEMFEE-po-11');
  });
});
