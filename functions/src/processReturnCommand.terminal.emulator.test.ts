import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
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

describe.skipIf(!available)('반품 확정 거절의 실제 Firestore 감사', { timeout: 30000 }, () => {
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


  const terminal = async (data:ReturnType<typeof input>) => {
    try { await issue(data); throw new Error('거절되어야 합니다.'); }
    catch(error) { expect(error).toMatchObject({details:{operationStatus:'rejected',operationId:data.operationId,returnRequestId:requestId,companyId}}); return error; }
  };
  const preserved = async () => Promise.all([ref('items',itemId).get(),ref('returnRequests',requestId).get(),ref('appMeta',counterId).get()]);
  const unchanged = async (before:admin.firestore.DocumentSnapshot[]) => {
    const after=await preserved(); after.forEach((snap,i)=>expect(snap.updateTime?.isEqual(before[i].updateTime!)).toBe(true));
  };
  it('동일 ID 동시 거절은 감사 한 건만 저장하고 gate 정상화 후에도 거절을 유지한다', async()=>{
    await seed({cutover:false}); const data=input('terminal');const before=await preserved();
    await Promise.all([terminal(data),terminal(data)]); await unchanged(before);
    const op=(await ref('returnOperations',data.operationId).get()).data()!;
    expect(op).toMatchObject({status:'rejected',command:data,createdBy:actor,companyId,returnRequestId:requestId});
    for(const group of ['issuedStatements','returnApplications','itemReceipts','rawMaterialLedger']) {
      const field=group==='returnApplications'?'operationId':'returnOperationId';
      expect((await db.collection(group).where(field,'==',data.operationId).get()).empty).toBe(true);
    }
    for(const prefix of ['returnCutover','partnerPaymentCutover']) await put('appMeta',`${prefix}_${companyId}`,{companyId,enabled:true,legacyWritersBlocked:true,auditPassed:true});
    await terminal(data);
    const result=await issue(input('new-attempt'));expect(result.status).toBe('applied');
    await terminal(data);expect((await ref('items',itemId).get()).data()?.stock).toBe(6);
    expect((await ref('appMeta',counterId).get()).data()?.last).toBe(1);
  });
  it('stale revision 및 초과 반품은 금융 없이 확정 거절된다',async()=>{
    for(const invalid of ['revision','quantity']) {
      await seed(); const data=input(invalid);const before=await preserved();
      if(invalid==='revision')data.expectedPartnerRevision=8;
      else await ref('returnRequests',requestId).update({items:[{itemId,quantity:3,isResellable:true}]});
      const updated=invalid==='quantity'?await preserved():before;
      await terminal(data);await unchanged(updated);
      expect((await ref('returnOperations',data.operationId).get()).data()?.status).toBe('rejected');
    }
  });
  it('단위 로트 부족과 원료 mirror 거절은 typed 감사만 남긴다',async()=>{
    await seedPurchase();let data=input('unit-shortage');
    await ref('items',itemId).update({type:'product',spec:'1kg',stock:0,lots:[]});
    await terminal(data);expect((await ref('returnOperations',data.operationId).get()).data()?.status).toBe('rejected');
    expect((await ref('items',itemId).get()).data()?.stock).toBe(0);
    await seed();data=input('raw-mismatch');
    await ref('items',itemId).update({type:'raw',subtype:'벌크',name:'깨분',stock:5,unit:'kg'});
    await terminal(data);expect((await ref('returnOperations',data.operationId).get()).data()?.failureMessage).toContain('어긋나');
    expect((await db.collection('rawMaterialLedger').where('returnOperationId','==',data.operationId).get()).empty).toBe(true);
    expect((await ref('items',itemId).get()).data()?.stock).toBe(5);
  });
  it('commit 실패는 안전 표시와 감사 저장을 만들지 않는다',async()=>{
    await seed({cutover:false});const data=input('commit-error');
    const broken={collection:db.collection.bind(db),runTransaction:(fn:any)=>db.runTransaction(async tx=>{await fn(tx);throw new Error('commit blocked');})};
    const error=await processGeneralStockReturn(broken as unknown as admin.firestore.Firestore,companyId,actor,data).catch(error=>error);
    expect(error.message).toBe('commit blocked');expect(error.details).toBeUndefined();
    expect((await ref('returnOperations',data.operationId).get()).exists).toBe(false);
  });
  it('부분 출력이 있으면 확정 거절 감사로 덮지 않는다',async()=>{
    await seed({cutover:false}); const data=input('partial');
    await put('itemReceipts',`${runId}-partial-receipt`,{companyId,returnOperationId:data.operationId});
    const error=await issue(data).catch(error=>error); expect(error.details).toBeUndefined();
    expect((await ref('returnOperations',data.operationId).get()).exists).toBe(false);
  });
  it('다른 actor 또는 변경된 command와 손상된 감사는 안전 표시를 받지 않는다',async()=>{
    await seed({cutover:false});const data=input('identity');await terminal(data);
    const error=await processGeneralStockReturn(db,companyId,actor+'-other',data).catch(error=>error);
    expect(error.details).toBeUndefined();
    expect((await issue({...data,expectedPartnerRevision:1}).catch(error=>error)).details).toBeUndefined();
    await ref('returnOperations',data.operationId).update({command:{...data,tradeDate:'2026-10-04'}});
    expect((await issue(data).catch(error=>error)).details).toBeUndefined();
  });
  it('읽기 TypeError는 감사도 안전 표시도 만들지 않는다',async()=>{
    await seed();const data=input('read-error');
    const broken={collection:db.collection.bind(db),runTransaction:(fn:any)=>db.runTransaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='get')return ()=>{throw new TypeError('unexpected read');};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}})))};
    const error=await processGeneralStockReturn(broken as unknown as admin.firestore.Firestore,companyId,actor,data).catch(error=>error);
    expect(error).toBeInstanceOf(TypeError);expect(error.details).toBeUndefined();
    expect((await ref('returnOperations',data.operationId).get()).exists).toBe(false);
  });
  it('거절 감사 커밋 후 응답 유실은 같은 ID 재시도로 확인한다',async()=>{
    await seed({cutover:false});const data=input('lost');
    const lost={collection:db.collection.bind(db),runTransaction:async(fn:any)=>{await db.runTransaction(fn);throw new Error('response lost');}};
    const error=await processGeneralStockReturn(lost as unknown as admin.firestore.Firestore,companyId,actor,data).catch(error=>error);
    expect(error.message).toBe('response lost');expect(error.details).toBeUndefined();
    await terminal(data);expect((await ref('returnOperations',data.operationId).get()).data()?.status).toBe('rejected');
  });
  it('다른 UUID 동시 요청은 한 번만 적용하고 나머지 시도는 확정 거절된다',async()=>{
    await seed();const results=await Promise.allSettled([issue(input('race-a')),issue(input('race-b'))]);
    expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(row=>row.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason.details?.operationStatus).toBe('rejected');
    expect((await ref('items',itemId).get()).data()?.stock).toBe(6);expect((await ref('appMeta',counterId).get()).data()?.last).toBe(1);
  });
});
