import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { processGeneralStockReturn } from './processReturnCommand';
import { voucherSequenceKey } from './voucherIssue';
import { inventoryDocId } from './shared/rawInventoryCore';

const available = ['127.0.0.1:8182', '127.0.0.1:8082'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const runId = `return-${randomUUID()}`, companyId = 'taebaek', date = '2026-10-03';
const requestId = `${runId}-request`, sourceId = `${runId}-source`, itemId = `${runId}-item`;
const partnerId = `${runId}-partner`, actor = `${runId}-actor`;
const releaseId = runId;
const counterId = voucherSequenceKey(companyId, date, '반품');
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const ref = (group: string, id: string) => db.collection(group).doc(id);
async function put(group: string, id: string, data: Record<string, unknown>) {
  await ref(group, id).set({ ...data, testRunId: runId });
  owned.add(`${group}/${id}`);
}
async function clearGenerated() {
  for (const group of ['returnOperations', 'returnApplications', 'returnRequests', 'itemReceipts', 'issuedStatements', 'cashEntries', 'settlements', 'rawMaterialLedger']) {
    const rows = await db.collection(group).get();
    for (const row of rows.docs) {
      if (row.id.startsWith(runId) || row.id.startsWith(`return-${runId}`)
        || row.data().returnOperationId?.startsWith(runId))
        await row.ref.delete();
    }
  }
  const state = ref('appMeta', `partnerPaymentState_${companyId}_${partnerId}`);
  if ((await state.get()).data()?.partnerId === partnerId) await state.delete();
}
async function seed(options: { cutover?: boolean; counter?: boolean; releaseStatus?: 'active' | 'paused' } = {}) {
  await clearGenerated();
  await Promise.all([
    put('partners', partnerId, { companyId, name: '시험 거래처' }),
    put('items', itemId, { companyId, name: '일반 상품', type: 'goods', stock: 5, unit: '개' }),
    put('issuedStatements', sourceId, { companyId, partnerId, type: '매출', tradeDate: date,
      totalSupply: 200, totalTax: 0, totalAmount: 200,
      items: [{ itemId, accountCode: '404', qty: 2, supply: 200, tax: 0, total: 200 }] }),
    put('returnRequests', requestId, { companyId, partnerId, linkedStatementId: sourceId,
      returnType: '매출', status: 'pending', totalAmount: 100,
      items: [{ itemId, quantity: 1, isResellable: true }] }),
    put('accountCodes', `${runId}-404`, { companyId, code: '404' }),
    put('accountCodes', `${runId}-108`, { companyId, code: '108' }),
    options.counter === false ? ref('appMeta', counterId).delete() :
      put('appMeta', counterId, { companyId, tradeDate: date, prefix: '반품', last: 0 }),
    put('appMeta', 'releaseCutover', { releaseId, status: options.releaseStatus ?? 'active',
      voucherNotBefore: { taebaek: date, punghoe: date } }),
    ...['returnCutover', 'partnerPaymentCutover'].map(prefix => options.cutover === false
      ? ref('appMeta', `${prefix}_${companyId}`).delete()
      : put('appMeta', `${prefix}_${companyId}`, { companyId, enabled: true,
        legacyWritersBlocked: true, auditPassed: true })),
  ]);
}
const input = (suffix: string) => ({ operationId: `${runId}-${suffix}`, returnRequestId: requestId,
  tradeDate: date, expectedPartnerRevision: 0, releaseId });
const issue = (data: ReturnType<typeof input>, company = companyId) =>
  processGeneralStockReturn(db, company, actor, data);

async function seedPurchase(code = '500', enabled = true) {
  await seed();
  await ref('issuedStatements', sourceId).update({ type: '매입', totalTax: 20, totalAmount: 220,
    items: [{ itemId, accountCode: code, qty: 2, supply: 200, tax: 20, total: 220 }] });
  // 실제 서버 입력 계약 fixture. 별도 미배포 UI helper의 동작을 검증하는 시험이 아니다.
  await ref('returnRequests', requestId).update({ returnType: '매입', totalAmount: 110,
    items: [{ itemId, quantity: 1, isResellable: false }] });
  await ref('appMeta', `returnCutover_${companyId}`).update({ purchaseGeneralStockEnabled: enabled });
  for (const accountCode of [code, '135', '251', '253'])
    await put('accountCodes', `${runId}-${accountCode}`, { companyId, code: accountCode });
}

describe.skipIf(!available)('general-stock return actual Firestore transaction', { timeout: 30000 }, () => {
  beforeAll(() => { app = admin.initializeApp({ projectId: 'demo-taebaekfood-local' }, runId); db = admin.firestore(app); });
  afterAll(async () => {
    if (!db) return;
    await clearGenerated();
    for (const path of owned) {
      const [group, id] = path.split('/'), target = ref(group, id);
      const data = (await target.get()).data();
      if (data?.testRunId === runId || (group === 'rawInventories' && data?.rawItemId?.startsWith(runId))) await target.delete();
    }
    await app.delete();
  });

  it('매입 출고와 역분개를 한 번만 저장하고 음수 입고를 만들지 않는다', async () => {
    await seedPurchase();
    const data = input('purchase');
    const results = await Promise.all([issue(data), issue(data)]);
    expect(results.map(row => row.status).sort()).toEqual(['applied', 'duplicate']);
    expect((await ref('items', itemId).get()).data()?.stock).toBe(4);
    const journal = (await ref('issuedStatements', `return-${data.operationId}`).get()).data()!;
    expect(journal.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '251', side: '차변', total: 110 }),
      expect.objectContaining({ accountCode: '500', side: '대변', total: 100 }),
      expect.objectContaining({ accountCode: '135', side: '대변', total: 10 }),
    ]));
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await ref('appMeta', `partnerPaymentState_${companyId}_${partnerId}`).get()).data()?.revision).toBe(1);
    const operation = (await ref('returnOperations', data.operationId).get()).data()!;
    expect(operation.receipts).toEqual([]);
    expect(operation.stockMovements).toEqual([expect.objectContaining({ itemId, quantityDelta: -1 })]);
    expect((await db.collection('itemReceipts').where('returnOperationId', '==', data.operationId).get()).empty).toBe(true);
    expect((await db.collection('cashEntries').where('partnerId', '==', partnerId).get()).empty).toBe(true);
    await ref('returnOperations', data.operationId).update({ stockMovements: [] });
    await expect(issue(data)).rejects.toThrow();
    expect((await ref('items', itemId).get()).data()?.stock).toBe(4);
  });

  it('재판매 불가 매출 반품은 재고와 로트를 움직이지 않고 역분개와 상계만 저장한다', async () => {
    await seed();
    await ref('returnRequests', requestId).update({ items: [{ itemId, quantity: 1, isResellable: false }] });
    await ref('items', itemId).update({ type: 'product', lots: [{ id: 'existing', qtyRemaining: 5 }] });
    const before = await ref('items', itemId).get();
    const data = input('nonresellable');
    expect((await issue(data)).status).toBe('applied');
    expect((await issue(data)).status).toBe('duplicate');
    const after = await ref('items', itemId).get();
    expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('processed');
    expect((await ref('returnApplications', `return-${data.operationId}`).get()).data()?.amount).toBe(100);
    const operation = (await ref('returnOperations', data.operationId).get()).data()!;
    expect(operation.receipts).toEqual([]);
    expect(operation.stockMovements).toEqual([]);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  });

  it('완제품 매출 반품은 BOM 중량의 새 로트와 재고를 같은 거래로 복귀한다', async () => {
    await seed();
    const looseId = `${runId}-loose`;
    // 회사 필드 없는 태백의 기존 낱개도 같은 BOM 중량을 사용한다.
    await put('items', looseId, { name: '낱개', type: 'product', spec: '1kg' });
    await put('item_bom', `${runId}-bom`, { parent_id: itemId, child_id: looseId, quantity: 20 });
    await ref('items', itemId).update({ type: 'product', unit: '박스', spec: '1kg * 20', lots: [{
      id: 'existing', material: '시험 제품', supplierName: '생산', qtyIn: 5, qtyRemaining: 5,
      unitKg: 20, kgIn: 100, kgRemaining: 100, receivedDate: date, status: 'active',
    }] });
    const data = input('product-receipt');
    expect((await issue(data)).status).toBe('applied');
    expect((await issue(data)).status).toBe('duplicate');
    const item = (await ref('items', itemId).get()).data()!;
    expect(item.stock).toBe(6);
    expect(item.lots).toHaveLength(2);
    expect(item.lots[1]).toMatchObject({ qtyIn: 1, qtyRemaining: 1, unitKg: 20, kgIn: 20, kgRemaining: 20 });
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await db.collection('itemReceipts').where('returnOperationId', '==', data.operationId).get()).size).toBe(1);
  });

  it('완제품 매입 반품은 두 FIFO 로트에 걸쳐 개수와 kg를 함께 차감한다', async () => {
    await seedPurchase();
    await ref('items', itemId).update({ type: 'product', spec: '1kg', stock: 1.5, lots: [
      { id: 'first', material: '제품', supplierName: '매입', qtyIn: 0.5, qtyRemaining: 0.5, unitKg: 1,
        kgIn: 0.5, kgRemaining: 0.5, receivedDate: date, status: 'active' },
      { id: 'second', material: '제품', supplierName: '매입', qtyIn: 1, qtyRemaining: 1, unitKg: 1,
        kgIn: 1, kgRemaining: 1, receivedDate: date, status: 'active' },
    ] });
    const data = input('product-issue');
    expect((await issue(data)).status).toBe('applied');
    expect((await issue(data)).status).toBe('duplicate');
    const item = (await ref('items', itemId).get()).data()!;
    expect(item.stock).toBe(0.5);
    expect(item.lots.map((lot: any) => [lot.qtyRemaining, lot.kgRemaining])).toEqual([[0, 0], [0.5, 0.5]]);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await ref('returnApplications', `return-${data.operationId}`).get()).data()?.amount).toBe(110);
  });

  it('원료 매출·매입 반품은 실제 원료 상태·로트·수불부·금융을 함께 한 번만 반영한다', async () => {
    for (const purchase of [false, true]) {
      if (purchase) await seedPurchase(); else await seed();
      const lot = { id: 'raw-existing', material: '참깨', supplierName: '매입', qtyIn: 5,
        kgIn: 5, kgRemaining: 5, receivedDate: date, status: 'active' };
      await ref('items', itemId).update({ name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', lots: [lot] });
      const stateId = inventoryDocId('taebaek', itemId);
      await put('rawInventories', stateId, { id: stateId, companyId, rawItemId: itemId, materialSnapshot: '참깨',
        stockKg: 5, activeLots: [lot], recentDepletedLots: [], revision: 0, lastProcessedAt: `${date}T00:00:00Z` });
      const data = input(purchase ? 'raw-issue' : 'raw-receipt');
      expect((await issue(data)).status).toBe('applied');
      expect((await issue(data)).status).toBe('duplicate');
      const expectedStock = purchase ? 4 : 6;
      const state = (await ref('rawInventories', stateId).get()).data()!;
      const item = (await ref('items', itemId).get()).data()!;
      expect(state.stockKg).toBe(expectedStock);
      expect(state.revision).toBe(1);
      expect(item.stock).toBe(expectedStock);
      expect(item.lots.reduce((sum: number, row: any) => sum + row.kgRemaining, 0)).toBe(expectedStock);
      const movements = await db.collection('rawMaterialLedger').where('returnOperationId', '==', data.operationId).get();
      expect(movements.size).toBe(1);
      expect(movements.docs[0].data()).toMatchObject({ received: purchase ? 0 : 1, used: purchase ? 1 : 0 });
      expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
      expect((await ref('returnApplications', `return-${data.operationId}`).get()).data()?.amount).toBe(purchase ? 110 : 100);
      await movements.docs[0].ref.update({ note: '변조' });
      await expect(issue(data)).rejects.toThrow('원료 반품 이력');
      expect((await ref('rawInventories', stateId).get()).data()?.revision).toBe(1);
    }
  });

  it('같은 원료 홀더로 두 품목이 돌아오면 가상 상태를 누적해 두 입고를 모두 보존한다', async () => {
    await seed();
    const secondId = `${runId}-raw-sku`;
    await put('items', secondId, { companyId, name: '참깨/포대', rawMaterialName: '참깨', type: 'goods', unit: 'kg', stock: 0 });
    const lot = { id: 'raw-original', material: '참깨', supplierName: '매입', qtyIn: 5,
      kgIn: 5, kgRemaining: 5, receivedDate: date, status: 'active' };
    await ref('items', itemId).update({ name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', lots: [lot] });
    const stateId = inventoryDocId('taebaek', itemId);
    await put('rawInventories', stateId, { id: stateId, companyId, rawItemId: itemId, materialSnapshot: '참깨',
      stockKg: 5, activeLots: [lot], recentDepletedLots: [], revision: 0, lastProcessedAt: `${date}T00:00:00Z` });
    await ref('issuedStatements', sourceId).update({ items: [
      { itemId, accountCode: '404', qty: 1, supply: 100, tax: 0, total: 100 },
      { itemId: secondId, accountCode: '404', qty: 1, supply: 100, tax: 0, total: 100 },
    ] });
    await ref('returnRequests', requestId).update({ totalAmount: 200, items: [
      { itemId, quantity: 1, isResellable: true }, { itemId: secondId, quantity: 1, isResellable: true },
    ] });
    const data = input('raw-two');
    expect((await issue(data)).status).toBe('applied');
    expect((await issue(data)).status).toBe('duplicate');
    const state = (await ref('rawInventories', stateId).get()).data()!;
    expect(state.stockKg).toBe(7);
    expect(state.revision).toBe(2);
    expect(state.activeLots).toHaveLength(3);
    expect((await ref('items', itemId).get()).data()?.stock).toBe(7);
    expect((await ref('items', secondId).get()).data()?.stock).toBe(0);
    expect((await db.collection('rawMaterialLedger').where('returnOperationId', '==', data.operationId).get()).size).toBe(2);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  });

  it('매입 gate와 부족 재고는 모든 쓰기를 차단한다', async () => {
    for (const scenario of ['gate', 'stock', 'lot', 'unit']) {
      await seedPurchase('500', scenario !== 'gate');
      if (scenario === 'stock') await ref('items', itemId).update({ stock: 0.5 });
      if (scenario === 'stock') {
        await ref('appMeta', counterId).delete();
        await ref('issuedStatements', sourceId).update({ docNo: '261003-777' });
        await ref('appMeta', 'releaseCutover').update({ oldWritersBlocked: true, oldWritersBlockedEvidence: 'emulator' });
      }
      if (scenario === 'lot') await ref('items', itemId).update({ lots: [{ quantity: 5 }] });
      if (scenario === 'unit') await ref('items', itemId).update({ unit: admin.firestore.FieldValue.delete() });
      const data = input(`purchase-${scenario}`);
      await expect(issue(data)).rejects.toThrow();
      expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('pending');
      expect((await ref('items', itemId).get()).data()?.stock).toBe(scenario === 'stock' ? 0.5 : 5);
      if (scenario === 'stock') expect((await ref('appMeta', counterId).get()).exists).toBe(false);
      else expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
      expect((await ref('returnOperations', data.operationId).get()).data()?.status).toBe('rejected');
      expect((await ref('issuedStatements', `return-${data.operationId}`).get()).exists).toBe(false);
      expect((await ref('returnApplications', `return-${data.operationId}`).get()).exists).toBe(false);
    }
  });

  it('매입 부분 결제 후 동일 계정 채무에만 나누어 배분한다', async () => {
    await seedPurchase();
    const otherId = `${runId}-purchase-other`;
    await put('issuedStatements', otherId, { companyId, partnerId, type: '매입', tradeDate: date,
      totalSupply: 100, totalTax: 0, totalAmount: 100,
      items: [{ itemId, accountCode: '500', qty: 1, supply: 100, tax: 0, total: 100 }] });
    await put('cashEntries', `${runId}-paid`, { companyId, partnerId, dir: '출금', amount: 170,
      lines: [{ accountCode: '251', amount: 170 }] });
    await put('settlements', `${runId}-pinned`, { statementId: sourceId, cashEntryId: `${runId}-paid`, amount: 170 });
    const data = input('purchase-split');
    await issue(data);
    const operation = (await ref('returnOperations', data.operationId).get()).data()!;
    expect(operation.applications).toEqual([
      expect.objectContaining({ statementId: sourceId, amount: 50 }),
      expect.objectContaining({ statementId: otherId, amount: 60 }),
    ]);
    expect((await ref('cashEntries', `${runId}-paid`).get()).data()?.amount).toBe(170);
    expect((await ref('settlements', `${runId}-pinned`).get()).data()?.amount).toBe(170);
  });

  it('기존 음수 청구는 FIFO 공제로 유지하며 새 반품의 재고·상계를 막지 않는다', async () => {
    await seed();
    const creditId = `${runId}-credit`;
    await put('issuedStatements', creditId, { companyId, partnerId, type: '매출', tradeDate: date,
      totalSupply: -30, totalTax: 0, totalAmount: -30,
      items: [{ itemId, accountCode: '404', qty: -1, supply: -30, tax: 0, total: -30 }] });
    const before = await ref('issuedStatements', creditId).get();
    const data = input('negative-credit');
    await issue(data);
    expect((await ref('items', itemId).get()).data()?.stock).toBe(6);
    expect((await ref('returnOperations', data.operationId).get()).data()?.applications)
      .toEqual([expect.objectContaining({ statementId: sourceId, amount: 100 })]);
    expect((await ref('issuedStatements', creditId).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  });

  it('음수 청구에 현금 정산이 붙어 있으면 새 반품을 쓰지 않는다', async () => {
    await seed();
    const creditId = `${runId}-credit`;
    await put('issuedStatements', creditId, { companyId, partnerId, type: '매출', tradeDate: date,
      totalSupply: -30, totalTax: 0, totalAmount: -30,
      items: [{ itemId, accountCode: '404', qty: -1, supply: -30, tax: 0, total: -30 }] });
    await put('cashEntries', `${runId}-paid`, { companyId, partnerId, dir: '입금', amount: 1,
      lines: [{ accountCode: '108', amount: 1 }] });
    await put('settlements', `${runId}-pinned`, { statementId: creditId, cashEntryId: `${runId}-paid`, amount: 1 });
    const data = input('negative-pinned');
    await expect(issue(data)).rejects.toThrow('원청구액');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(5);
    expect((await ref('returnOperations', data.operationId).get()).data()?.status).toBe('rejected');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('pending');
  });

  it('251 반품을 253 채무로 넘기지 않으며 253 자체 반품은 허용한다', async () => {
    await seedPurchase();
    await put('cashEntries', `${runId}-paid`, { companyId, partnerId, dir: '출금', amount: 220,
      lines: [{ accountCode: '251', amount: 220 }] });
    await put('settlements', `${runId}-pinned`, { statementId: sourceId, cashEntryId: `${runId}-paid`, amount: 220 });
    await put('issuedStatements', `${runId}-other253`, { companyId, partnerId, type: '매입', tradeDate: date,
      totalSupply: 500, totalTax: 0, totalAmount: 500,
      items: [{ itemId, accountCode: '800', qty: 1, supply: 500, tax: 0, total: 500 }] });
    await expect(issue(input('purchase-cross-account'))).rejects.toThrow();
    expect((await ref('items', itemId).get()).data()?.stock).toBe(5);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    await seedPurchase('800');
    const result = await issue(input('purchase253'));
    const journal = (await ref('issuedStatements', result.journalId).get()).data()!;
    expect(journal.items).toContainEqual(expect.objectContaining({ accountCode: '253', side: '차변', total: 110 }));
  });

  it('서로 다른 매입 반품이 같은 revision과 재고를 경쟁하면 하나만 반영한다', async () => {
    await seedPurchase();
    await ref('items', itemId).update({ stock: 1 });
    const secondRequestId = `${runId}-request2`, secondSourceId = `${runId}-source2`;
    await put('issuedStatements', secondSourceId, { ...(await ref('issuedStatements', sourceId).get()).data()! });
    await put('returnRequests', secondRequestId, { ...(await ref('returnRequests', requestId).get()).data()!, linkedStatementId: secondSourceId });
    const results = await Promise.allSettled([issue(input('purchase-race1')),
      issue({ ...input('purchase-race2'), returnRequestId: secondRequestId })]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await ref('items', itemId).get()).data()?.stock).toBe(0);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  });

  it('fails closed for missing cutover, counter, and the other company without writes', async () => {
    await seed({ releaseStatus: 'paused' });
    await expect(issue(input('paused'))).rejects.toThrow('활성화');
    await seed({ cutover: false });
    await expect(issue(input('gate'))).rejects.toThrow('전환');
    await seed({ counter: false });
    await expect(issue(input('counter'))).rejects.toThrow('카운터');
    await seed();
    await expect(issue(input('foreign'), 'punghoe')).rejects.toThrow('회사');
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('pending');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(5);
  });

  it('quarantines a partner with legacy ledger exceptions without changing stock or counter', async () => {
    await seed();
    await ref('appMeta', `returnCutover_${companyId}`).update({ auditScope: 'unblocked-partners', blockedPartnerIds: [partnerId] });
    await expect(issue(input('quarantined'))).rejects.toThrow('과거 정산');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(5);
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('pending');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
  });

  it('commits reverse journal, stock, receipt, noncash application and status once; retries safely', async () => {
    await seed();
    const data = input('success');
    const first = await issue(data);
    expect(first.status).toBe('applied');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(6);
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('processed');
    expect((await ref('issuedStatements', first.journalId).get()).data()?.docNo).toBe(first.docNo);
    expect((await ref('returnApplications', first.journalId).get()).data()?.amount).toBe(100);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await issue(data)).status).toBe('duplicate');
    await ref('returnOperations', data.operationId).update({ applications: admin.firestore.FieldValue.delete() });
    expect((await issue(data)).status).toBe('duplicate');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(6);
    await ref('returnRequests', requestId).update({ totalAmount: 101 });
    await expect(issue(data)).rejects.toThrow('요청이 다릅니다');
    await ref('returnRequests', requestId).update({ totalAmount: 100,
      items: [{ itemId, quantity: 1.005, isResellable: true }] });
    await expect(issue(data)).rejects.toThrow('요청이 다릅니다');
  });

  it('uses source open balance first, then another claim after pinned cash, atomically', async () => {
    await seed();
    const otherId = `${runId}-other`, cashId = `${runId}-cash`, settlementId = `${runId}-settlement`;
    await Promise.all([
      put('issuedStatements', otherId, { companyId, partnerId, type: '매출', tradeDate: date,
        totalSupply: 100, totalTax: 0, totalAmount: 100,
        items: [{ itemId, accountCode: '404', qty: 1, supply: 100, tax: 0, total: 100 }] }),
      put('cashEntries', cashId, { companyId, partnerId, date, dir: '입금', amount: 150,
        lines: [{ accountCode: '108', amount: 150 }] }),
      put('settlements', settlementId, { companyId, statementId: sourceId, cashEntryId: cashId, amount: 150 }),
    ]);
    const data = input('split');
    const first = await issue(data);
    expect(first.status).toBe('applied');
    const ledger = (await ref('returnOperations', data.operationId).get()).data()!;
    expect(ledger.applications.map((row: { statementId: string; amount: number }) =>
      [row.statementId, row.amount])).toEqual([[sourceId, 50], [otherId, 50]]);
    expect((await ref('returnApplications', `return-${data.operationId}`).get()).data()?.amount).toBe(50);
    expect((await ref('returnApplications', `return-${data.operationId}-${otherId}`).get()).data()?.amount).toBe(50);
    expect((await issue(data)).status).toBe('duplicate');
    await ref('returnApplications', `return-${data.operationId}-${otherId}`).update({ amount: 49 });
    await expect(issue(data)).rejects.toThrow();
  });

  it('accounts for unpinned cash and rejects prior return plus settlement over the claim', async () => {
    await seed();
    const cashId = `${runId}-cash-unpinned`;
    await put('cashEntries', cashId, { companyId, partnerId, date, dir: '입금', amount: 150,
      lines: [{ accountCode: '108', amount: 150 }] });
    await expect(issue(input('cash-over'))).rejects.toThrow();
    expect((await ref('returnRequests', requestId).get()).data()?.status).toBe('pending');
    expect((await ref('items', itemId).get()).data()?.stock).toBe(5);
    await seed();
    const oldId = `${runId}-old-return`, settlementId = `${runId}-old-settlement`;
    await Promise.all([
      put('returnApplications', oldId, { companyId, partnerId, statementId: sourceId,
        returnRequestId: `${runId}-old-request`, operationId: oldId, amount: 100 }),
      put('cashEntries', cashId, { companyId, partnerId, date, dir: '입금', amount: 150,
        lines: [{ accountCode: '108', amount: 150 }] }),
      put('settlements', settlementId, { companyId, statementId: sourceId, cashEntryId: cashId, amount: 150 }),
    ]);
    await expect(issue(input('prior-over'))).rejects.toThrow();
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
  });

  it('accepts a legacy Taebaek return application without companyId in the partner snapshot', async () => {
    await seed();
    const legacyId = `${runId}-legacy-application`;
    await put('returnApplications', legacyId, { partnerId, statementId: sourceId,
      returnRequestId: `${runId}-legacy-request`, operationId: legacyId, amount: 50 });
    await ref('returnApplications', legacyId).update({ companyId: admin.firestore.FieldValue.delete() });
    const result = await issue(input('after-legacy'));
    expect(result.status).toBe('applied');
    expect((await ref('returnApplications', `return-${runId}-after-legacy`).get()).data()?.amount).toBe(100);
  });

  it('allocates entirely to another open claim when the linked source is fully settled', async () => {
    await seed();
    const otherId = `${runId}-other`, cashId = `${runId}-cash-full`, settlementId = `${runId}-settlement-full`;
    await Promise.all([
      put('issuedStatements', otherId, { companyId, partnerId, type: '매출', tradeDate: date,
        totalSupply: 100, totalTax: 0, totalAmount: 100,
        items: [{ itemId, accountCode: '404', qty: 1, supply: 100, tax: 0, total: 100 }] }),
      put('cashEntries', cashId, { companyId, partnerId, date, dir: '입금', amount: 200,
        lines: [{ accountCode: '108', amount: 200 }] }),
      put('settlements', settlementId, { companyId, statementId: sourceId, cashEntryId: cashId, amount: 200 }),
    ]);
    const data = input('fully-paid-source');
    expect((await issue(data)).status).toBe('applied');
    expect((await ref('returnApplications', `return-${data.operationId}`).get()).data()?.statementId).toBe(otherId);
    expect((await issue(data)).status).toBe('duplicate');
  });

  it('serializes different operation IDs for the same request', async () => {
    await seed();
    const results = await Promise.allSettled([issue(input('race-a')), issue(input('race-b'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await ref('items', itemId).get()).data()?.stock).toBe(6);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  }, 15000);
});
