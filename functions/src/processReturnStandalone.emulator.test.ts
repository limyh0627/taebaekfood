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

  const standalone=async(purchase=false,resellable=true)=>{
    if(purchase)await seedPurchase('540');else await seed();
    await ref('returnRequests',requestId).set({companyId,partnerId,status:'pending',returnType:purchase?'매입':'매출',totalAmount:110,
      ...(purchase&&{payableAccountCode:'253'}),items:[{itemId,quantity:1,isResellable:resellable,supply:100,tax:10,accountCode:purchase?'540':'404'}]});
    if(!purchase){await put('accountCodes',runId+'-255',{companyId,code:'255'});}
  };
  it('원전표 미지정 매출 반품은 명시 금액과 FIFO를 같은 거래로 저장하고 재시도는 불변이다',async()=>{
    await standalone();
    await ref('issuedStatements',sourceId).update({totalSupply:50,totalAmount:50,items:[{itemId,accountCode:'404',qty:1,supply:50,tax:0,total:50}]});
    await put('issuedStatements',sourceId+'-later',{companyId,partnerId,type:'매출',tradeDate:date,totalAmount:100,totalSupply:100,totalTax:0,items:[{itemId,accountCode:'404',qty:1,supply:100,tax:0,total:100}]});
    const data=input('standalone');expect((await issue(data)).status).toBe('applied');
    const operation=(await ref('returnOperations',data.operationId).get()).data()!;
    expect(operation).toMatchObject({sourceMode:'standalone',amount:110});expect(operation.sourceStatementId).toBeUndefined();
    expect(operation.applications.map((r:any)=>[r.statementId,r.amount])).toEqual([[sourceId,50],[sourceId+'-later',60]]);
    const journal=(await ref('issuedStatements','return-'+data.operationId).get()).data()!;
    expect(journal).toMatchObject({sourceMode:'standalone',totalSupply:100,totalTax:10,totalAmount:110});expect(journal.reverseOfStatementId).toBeUndefined();
    expect((await ref('items',itemId).get()).data()?.stock).toBe(6);expect((await issue(data)).status).toBe('duplicate');
    expect((await ref('appMeta',counterId).get()).data()?.last).toBe(1);expect((await db.collection('cashEntries').where('partnerId','==',partnerId).get()).empty).toBe(true);
  });
  it('원전표 미지정 매출 폐기는 linked와 같이 금융만 처리하고 재입고하지 않는다',async()=>{
    await standalone(false,false);const data=input('disposal');expect((await issue(data)).status).toBe('applied');
    expect((await ref('items',itemId).get()).data()?.stock).toBe(5);expect((await db.collection('itemReceipts').where('returnOperationId','==',data.operationId).get()).empty).toBe(true);
    expect((await issue(data)).status).toBe('duplicate');
  });
  it('원전표 미지정 매입은 명시253 역분개와 출고를 함께 저장하고 재시도는 불변이다',async()=>{
    await standalone(true,false);const data=input('standalone-purchase');expect((await issue(data)).status).toBe('applied');
    expect((await ref('items',itemId).get()).data()?.stock).toBe(4);
    const journal=(await ref('issuedStatements','return-'+data.operationId).get()).data()!;expect(journal.items).toContainEqual(expect.objectContaining({accountCode:'253',side:'차변',total:110}));
    expect((await issue(data)).status).toBe('duplicate');
  });
  it('명시금액 없는 입력·foreign 품목·미결 초과는 거절 감사만 남기며 원문 재고·번호는 불변이다',async()=>{
    for(const kind of ['amount','foreign','over'] as const){
      await standalone();
      if(kind==='amount')await ref('returnRequests',requestId).update({items:[{itemId,quantity:1,isResellable:true}]});
      if(kind==='foreign')await ref('items',itemId).update({companyId:'punghoe'});
      if(kind==='over')await ref('issuedStatements',sourceId).update({totalAmount:1,totalSupply:1,items:[{itemId,accountCode:'404',qty:1,supply:1,tax:0,total:1}]});
      const before=(await ref('items',itemId).get()).data(),data=input('reject-'+kind);
      await expect(issue(data)).rejects.toThrow();expect((await ref('items',itemId).get()).data()).toEqual(before);
      expect((await ref('issuedStatements','return-'+data.operationId).get()).exists).toBe(false);expect((await ref('returnOperations',data.operationId).get()).data()?.status).toBe('rejected');
      expect((await ref('appMeta',counterId).get()).data()?.last).toBe(0);
    }
  });
});
