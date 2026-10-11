import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { submitReturnRequest } from './submitReturnRequestCommand';
import { cancelPendingReturn, type PendingReturnCancellationInput } from './cancelPendingReturnCommand';
import { updatePendingReturnQuantity } from './updatePendingReturnQuantityCommand';
import { processGeneralStockReturn } from './processReturnCommand';
import { inventoryDocId } from './shared/rawInventoryCore';
import { voucherSequenceKey } from './voucherIssue';
const available = ['127.0.0.1:8082', '127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const run = `cancel-return-${randomUUID()}`, companyId = 'taebaek' as const, date = '2026-10-09';
const actor = { uid: `${run}-uid`, token: {companyId, isAdmin: true, employeeId: `${run}-employee`} };
let app: App, db: Firestore;
const owned = new Set<string>(), sharedBefore = new Map<string, FirebaseFirestore.DocumentData | undefined>();
const counterId = voucherSequenceKey(companyId, date, '반품');
describe.skipIf(!available)('대기 반품 취소 실제 Admin transaction', () => {
  beforeAll(async () => {
    app = initializeApp({projectId: 'demo-taebaekfood-local'}, run); db = getFirestore(app);
    const shared = {
      'appMeta/releaseCutover': {releaseId: run, status: 'active', voucherNotBefore: {taebaek: date, punghoe: date}},
      'appMeta/returnCutover_taebaek': {companyId, enabled: true, legacyWritersBlocked: true, auditPassed: true, purchaseGeneralStockEnabled: true},
      'appMeta/partnerPaymentCutover_taebaek': {companyId, enabled: true, legacyWritersBlocked: true, auditPassed: true},
      [`appMeta/${counterId}`]: {companyId, tradeDate: date, prefix: '반품', last: 0},
    };
    for (const [path, data] of Object.entries(shared)) { sharedBefore.set(path, (await db.doc(path).get()).data()); await db.doc(path).set(data); }
  }, 90000);
  afterAll(async () => {
    if (!app) return;
    try {
      for (const group of ['returnOperations', 'returnApplications', 'issuedStatements', 'itemReceipts', 'rawMaterialLedger']) {
        for (const row of (await db.collection(group).get()).docs) {
          if (row.id.startsWith(run) || row.id.startsWith(`return-${run}`) || row.data().returnRequestId?.startsWith(run)) owned.add(row.ref.path);
        }
      }
      for (const path of owned) await db.doc(path).delete();
    } finally {
      for (const [path, data] of sharedBefore) { if (data) await db.doc(path).set(data); else await db.doc(path).delete(); }
      await deleteApp(app);
    }
  }, 90000);
  async function seed(label: string) {
    const requestId = `${run}-${label}`, partnerId = `${requestId}-partner`, itemId = `${requestId}-item`;
    const request = {companyId, partnerId, partnerName: '시험', returnType: '매출', status: 'pending', totalAmount: 100,
      createdAt: '2026-10-09T00:00:00Z', items: [{itemId, quantity: 2, isResellable: false, supply: 100, tax: 0, accountCode: '404'}]};
    for (const [path, data] of [[`partners/${partnerId}`, {companyId, name: '시험'}], [`items/${itemId}`, {companyId, name: '시험', type: 'goods', stock: 5, unit: '개'}]] as const) {
      owned.add(path); await db.doc(path).set(data);
    }
    for (const code of ['404', '108', '255']) { const path = `accountCodes/${requestId}-${code}`; owned.add(path); await db.doc(path).set({companyId, code}); }
    owned.add(`returnRequests/${requestId}`); owned.add(`returnSubmissionOperations/${requestId}`);
    owned.add(`appMeta/partnerPaymentState_${companyId}_${partnerId}`);
    const submission = {companyId, requestId, request};
    await submitReturnRequest(db, companyId, actor.uid, submission);
    const expectedRequest = (await db.doc(`returnRequests/${requestId}`).get()).data()!;
    const input: PendingReturnCancellationInput = {companyId, requestId, operationId: `${requestId}-cancel`, expectedRequest};
    return {input, submission, itemId, partnerId};
  }
  const process = (input: PendingReturnCancellationInput) => processGeneralStockReturn(db, companyId, actor.uid,
    {operationId: `${input.requestId}-process`, returnRequestId: input.requestId, tradeDate: date, expectedPartnerRevision: 0, releaseId: run});

  // 혼합 단위는 원전표 행 번호로 식별하며 취소 접수는 물리 원장을 변경하지 않는다.
  async function seedMixed(label: string) {
    const requestId = run + '-mixed-' + label, partnerId = requestId + '-partner', itemId = requestId + '-raw', sourceId = requestId + '-source';
    const stateId = inventoryDocId(companyId, itemId);
    const lot = {id: requestId + '-lot', supplierName: '시험', kgIn: 45, kgRemaining: 45, receivedDate: date, status: 'active', createdAt: date + 'T00:00:00Z'};
    const lines = [20,25].map((unitKg,sourceLineIndex)=>({itemId,sourceLineIndex,accountCode:'500',qty:1,supply:100,tax:10,total:110,purchaseUnitId:'old-'+unitKg,purchaseUnit:'포',purchaseQty:1,unitKg,inventoryQty:unitKg}));
    const docs: Array<[string, Record<string, any>]> = [
      ['partners/'+partnerId,{companyId,name:'혼합 단위 시험'}],
      ['items/'+itemId,{companyId,name:'혼합원료',type:'raw',subtype:'벌크',unit:'L',stock:45,lots:[lot]}],
      ['rawInventories/'+stateId,{id:stateId,companyId,rawItemId:itemId,materialSnapshot:'혼합원료',stockKg:45,activeLots:[lot],recentDepletedLots:[],revision:0,lastProcessedAt:date+'T00:00:00Z'}],
      ['issuedStatements/'+sourceId,{companyId,partnerId,type:'매입',tradeDate:date,totalSupply:200,totalTax:20,totalAmount:220,items:lines}],
    ];
    for(const code of ['500','135','251','253','255'])docs.push(['accountCodes/'+requestId+'-'+code,{companyId,code}]);
    for(const [path,data] of docs){owned.add(path);await db.doc(path).set(data);}
    owned.add('returnRequests/'+requestId);owned.add('returnSubmissionOperations/'+requestId);owned.add('appMeta/partnerPaymentState_'+companyId+'_'+partnerId);
    const request={companyId,partnerId,partnerName:'혼합 단위 시험',linkedStatementId:sourceId,returnType:'매입',status:'pending',totalAmount:220,createdAt:date+'T00:00:00Z',items:[0,1].map(sourceLineIndex=>({itemId,sourceLineIndex,quantity:1,isResellable:false}))};
    await submitReturnRequest(db,companyId,actor.uid,{companyId,requestId,request});
    const input: PendingReturnCancellationInput={companyId,requestId,operationId:requestId+'-cancel',expectedRequest:(await db.doc('returnRequests/'+requestId).get()).data()!};
    return {input,itemId,stateId,sourceId,partnerId};
  }
  it('혼합 단위 접수 취소는 원행과 raw 재고·로트·금액·번호를 보존한다',async()=>{
    const f=await seedMixed('pending');
    const before=await Promise.all(['items/'+f.itemId,'rawInventories/'+f.stateId,'issuedStatements/'+f.sourceId,'appMeta/'+counterId].map(path=>db.doc(path).get()));
    expect((await cancelPendingReturn(db,actor,f.input)).status).toBe('cancelled');
    const current=(await db.doc('returnRequests/'+f.input.requestId).get()).data()!;
    expect(current.items.map((row:any)=>row.sourceLineIndex)).toEqual([0,1]);expect(current.totalAmount).toBe(220);
    for(const old of before){const next=await old.ref.get();expect(next.data()).toEqual(old.data());expect(next.updateTime!.isEqual(old.updateTime!)).toBe(true);}
    expect((await db.collection('rawMaterialLedger').where('returnRequestId','==',f.input.requestId).get()).empty).toBe(true);
  },90000);
  it('혼합 단위 처리 완료 후 접수 취소 거절은 원장·로트·원행·금액·번호를 변경하지 않는다',async()=>{
    const f=await seedMixed('processed');expect((await process(f.input)).status).toBe('applied');
    const movements=await db.collection('rawMaterialLedger').where('returnRequestId','==',f.input.requestId).get();
    expect(movements.size).toBe(2);expect(movements.docs.map(row=>row.get('sourceLineIndex')).sort()).toEqual([0,1]);expect(movements.docs.map(row=>row.get('used')).sort((a,b)=>a-b)).toEqual([20,25]);
    const paths=['items/'+f.itemId,'rawInventories/'+f.stateId,'issuedStatements/'+f.sourceId,'appMeta/'+counterId,'appMeta/partnerPaymentState_'+companyId+'_'+f.partnerId];
    const current=(await db.doc('returnRequests/'+f.input.requestId).get()).data()!;paths.push('issuedStatements/'+current.returnJournalId,'returnApplications/'+current.returnApplicationId,'returnOperations/'+f.input.requestId+'-process');
    const before=[...movements.docs,...await Promise.all(paths.map(path=>db.doc(path).get()))];
    expect((await db.doc('rawInventories/'+f.stateId).get()).get('stockKg')).toBe(0);
    const originalItems=current.items,originalAmount=current.totalAmount;
    await expect(cancelPendingReturn(db,actor,{...f.input,expectedRequest:current})).rejects.toThrow('대기');
    for(const old of before){expect(old.exists).toBe(true);const next=await old.ref.get();expect(next.data()).toEqual(old.data());expect(next.updateTime!.isEqual(old.updateTime!)).toBe(true);}
    const after=(await db.doc('returnRequests/'+f.input.requestId).get()).data()!;expect(after.items).toEqual(originalItems);expect(after.totalAmount).toBe(originalAmount);expect(after.status).toBe('processed');expect(after.cancelledAt).toBeUndefined();
  },90000);

  it('수량 수정 후 취소·동시 재시도·원접수 재개가 원문과 금융을 보존한다', async () => {
    const f = await seed('normal'), ref = db.doc(`returnRequests/${f.input.requestId}`);
    await updatePendingReturnQuantity(db, actor, {companyId, requestId: f.input.requestId, operationId: `${f.input.requestId}-quantity`, updates: [{itemId: f.itemId, previousQuantity: 2, quantity: 3}]});
    f.input.expectedRequest = (await ref.get()).data()!;
    const before = await Promise.all([db.doc(`returnSubmissionOperations/${f.input.requestId}`).get(), db.doc(`items/${f.itemId}`).get(), db.doc(`appMeta/${counterId}`).get()]);
    const results = await Promise.all([cancelPendingReturn(db, actor, f.input), cancelPendingReturn(db, actor, f.input)]);
    expect(results.map(row => row.status).sort()).toEqual(['cancelled', 'duplicate']);
    const cancelled = await ref.get(); expect(cancelled.data()?.items[0].quantity).toBe(3);
    expect((await submitReturnRequest(db, companyId, actor.uid, f.submission)).status).toBe('duplicate');
    expect((await ref.get()).updateTime!.isEqual(cancelled.updateTime!)).toBe(true);
    await expect(updatePendingReturnQuantity(db, actor, {companyId, requestId: f.input.requestId, operationId: `${f.input.requestId}-new-quantity`, updates: [{itemId: f.itemId, previousQuantity: 3, quantity: 4}]})).rejects.toThrow('취소');
    await expect(process(f.input)).rejects.toThrow('취소');
    expect((await cancelPendingReturn(db,actor,f.input)).status).toBe('duplicate');
    for (const row of before) expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
    expect((await db.collection('returnApplications').where('returnRequestId', '==', f.input.requestId).get()).empty).toBe(true);
    expect((await db.doc(`issuedStatements/return-${f.input.requestId}-process`).get()).exists).toBe(false);
  }, 90000);
  it('완료·취소 동시 요청은 한 상태만 확정하고 재고·번호를 중복하지 않는다', async () => {
    const f = await seed('process-race'), counterBefore = (await db.doc(`appMeta/${counterId}`).get()).get('last');
    const results = await Promise.allSettled([cancelPendingReturn(db, actor, f.input), process(f.input)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const current = (await db.doc(`returnRequests/${f.input.requestId}`).get()).data()!;
    const processed = current.status === 'processed';
    expect(Boolean(current.cancelledAt)).toBe(!processed);
    expect((await db.doc(`appMeta/${counterId}`).get()).get('last')).toBe(counterBefore + (processed ? 1 : 0));
    expect((await db.doc(`items/${f.itemId}`).get()).get('stock')).toBe(5);
    if (processed) await expect(cancelPendingReturn(db, actor, f.input)).rejects.toThrow('대기');
    else expect((await cancelPendingReturn(db, actor, f.input)).status).toBe('duplicate');
  }, 90000);
  it('수량·취소 경합은 오래된 원문을 승인하지 않는다', async () => {
    const f = await seed('quantity-race');
    const results = await Promise.allSettled([cancelPendingReturn(db, actor, f.input), updatePendingReturnQuantity(db, actor,
      {companyId, requestId: f.input.requestId, operationId: `${f.input.requestId}-quantity`, updates: [{itemId: f.itemId, previousQuantity: 2, quantity: 3}]})]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const current = (await db.doc(`returnRequests/${f.input.requestId}`).get()).data()!;
    expect(current.items[0].quantity).toBe(current.cancelledAt ? 2 : 3);
    if (!current.cancelledAt) await expect(cancelPendingReturn(db, actor, f.input)).rejects.toThrow('변경');
  }, 90000);
  it('직원·타회사·legacy와 접수증명 변조는 원문 변경0이다', async () => {
    const f = await seed('permission'), ref = db.doc(`returnRequests/${f.input.requestId}`), before = await ref.get();
    await expect(cancelPendingReturn(db, {...actor, token: {...actor.token, isAdmin: false}}, f.input)).rejects.toThrow('관리자');
    await expect(cancelPendingReturn(db, {...actor, token: {...actor.token, companyId: 'punghoe'}}, f.input)).rejects.toThrow('관리자');
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    await db.doc(`returnSubmissionOperations/${f.input.requestId}`).delete();
    await expect(cancelPendingReturn(db, actor, f.input)).rejects.toThrow('증명');
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  }, 90000);
  it('오래된 원문 거절은 terminal 증명으로 확정되고 새 원문 취소는 재개한다', async () => {
    const f=await seed('terminal'), ref=db.doc(`returnRequests/${f.input.requestId}`);
    await updatePendingReturnQuantity(db,actor,{companyId,requestId:f.input.requestId,operationId:`${f.input.requestId}-quantity`,updates:[{itemId:f.itemId,previousQuantity:2,quantity:3}]});
    const before=await Promise.all([db.doc(`items/${f.itemId}`).get(),db.doc(`appMeta/${counterId}`).get(),db.doc(`returnSubmissionOperations/${f.input.requestId}`).get()]);
    const errors=await Promise.all([cancelPendingReturn(db,actor,f.input).catch(error=>error),cancelPendingReturn(db,actor,f.input).catch(error=>error)]);
    for(const error of errors) expect(error.details.cancellationRejected).toMatchObject({terminalConfirmed:true,status:'rejected',command:f.input});
    expect(errors[0].details).toEqual(errors[1].details);
    const rejected=await ref.get(); expect(Object.keys(rejected.get('cancellationOperations'))).toEqual([f.input.operationId]);
    await expect(cancelPendingReturn(db,actor,f.input)).rejects.toThrow('변경');
    expect((await ref.get()).updateTime!.isEqual(rejected.updateTime!)).toBe(true);
    const next={...f.input,operationId:`${f.input.requestId}-retry`,expectedRequest:rejected.data()!};
    expect((await cancelPendingReturn(db,actor,next)).status).toBe('cancelled');
    expect((await cancelPendingReturn(db,actor,next)).status).toBe('duplicate');
    expect((await ref.get()).get('items')[0].quantity).toBe(3);
    for(const row of before) expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
  },90000);

  it('서로 다른 취소 작업 경합은 성공 하나와 terminal 거절 하나로 재개한다',async()=>{
    const f=await seed('two-cancel'),inputs=[f.input,{...f.input,operationId:`${f.input.requestId}-other`}];
    const results=await Promise.allSettled(inputs.map(input=>cancelPendingReturn(db,actor,input)));
    expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
    const loser=results.findIndex(row=>row.status==='rejected'),winner=1-loser;
    const error=(results[loser] as PromiseRejectedResult).reason;
    expect(error.details.cancellationRejected).toMatchObject({terminalConfirmed:true,command:inputs[loser]});
    const ref=db.doc(`returnRequests/${f.input.requestId}`),before=await ref.get();
    await expect(cancelPendingReturn(db,actor,inputs[loser])).rejects.toThrow('이미 취소');
    expect((await cancelPendingReturn(db,actor,inputs[winner])).status).toBe('duplicate');
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  },90000);

});
