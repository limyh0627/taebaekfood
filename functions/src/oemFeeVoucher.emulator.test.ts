import { buildOemBatchCostPreview } from './shared/oemBatchCost';
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

  it.each([false,true])('소수 제품 줄과 마지막 잔차를 실제 서버 거래에서 대조한다 (면세 %s)',async(exempt)=>{
    const poId=`po-plan-fraction-${exempt}`,a=`plan-product-a-${exempt}`,b=`plan-product-b-${exempt}`;
    await seed([poId]);
    await Promise.all([
      db.collection('purchaseOrders').doc(poId).update({oemReceivedKg:0.667,items:[{itemId:a,name:'A',quantity:1,unit:'개'},{itemId:b,name:'B',quantity:1,unit:'개'}]}),
      ...[a,b].map((id,index)=>db.collection('items').doc(id).set({companyId:'taebaek',name:index?'B':'A',spec:'0.3333kg',packageKg:0.3333,type:'product'})),
    ]);
    const lines=[{name:'A',spec:'0.3333kg',qty:1,price:exempt?333:303,supply:exempt?333:303,tax:exempt?0:30,total:333,isTaxExempt:exempt,accountCode:'540'},
      {name:'B',spec:'0.3333kg',qty:1,price:exempt?334:304,supply:exempt?334:304,tax:exempt?0:30,total:334,isTaxExempt:exempt,accountCode:'540'}];
    const input={poId,perKg:1000,releaseId,statement:{...statement(poId),totalSupply:exempt?667:607,totalTax:exempt?0:60,totalAmount:667,items:lines}};
    // 손상 kg는 기존 서버처럼 거절한다. 공용 Number||0를 써도 fallback으로 우회하지 않는다.
    await db.collection('items').doc(a).update({packageKg:'invalid'});
    await expect(issueOemFeeVoucher(db,'taebaek',input)).rejects.toThrow('입고 내역');
    expect((await db.collection('issuedStatements').doc(`OEMFEE-${poId}`).get()).exists).toBe(false);
    await db.collection('items').doc(a).update({packageKg:0.3333});
    expect(await issueOemFeeVoucher(db,'taebaek',input)).toBe(`OEMFEE-${poId}`);
    const saved=await db.collection('issuedStatements').doc(`OEMFEE-${poId}`).get();
    expect(saved.get('items')).toEqual(lines);expect(saved.get('totalAmount')).toBe(667);
    expect(await issueOemFeeVoucher(db,'taebaek',input)).toBe(`OEMFEE-${poId}`);
    expect((await db.collection('appMeta').doc(counterId).get()).get('last')).toBe(1);
  });  it('BOM으로 묶인 박스 품목의 kg 환산을 PO 줄과 대조한다', async () => {
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

  it('낡은 unpackTo12는 개 중량을 곱하지 않고 재시도는 번호·원문을 보존한다', async () => {
    await seed(['po-12']);
    await Promise.all([
      db.collection('purchaseOrders').doc('po-12').update({ oemReceivedKg: 4,
        items: [{ itemId: 'unpack-only-box', name: '구성만 있는 2개입', quantity: 2, unit: '개' },
          { itemId: 'unpack-test-loose', name: '별도 낱개', quantity: 1, unit: '개' }] }),
      db.collection('items').doc('unpack-only-box').set({ companyId: 'taebaek', name: '구성만 있는 2개입',
        spec: '1kg × 12', unit: '개', type: 'product', unpackTo: { count: 12 } }),
      db.collection('items').doc('unpack-test-loose').set({ companyId: 'taebaek', name: '별도 낱개', spec: '2kg', unit: '개', type: 'product' }),
    ]);
    expect((await db.collection('item_bom').where('parent_id', '==', 'unpack-only-box').get()).empty).toBe(true);
    // 두 줄을 사용해 총중량 보정이 잘못 환산된 첫 줄을 가리지 못하게 한다.
    const request = { ...command('po-12'), statement: { ...statement('po-12'),
      totalSupply: 1818, totalTax: 182, totalAmount: 2000,
      items: [{ name: '구성만 있는 2개입', spec: '1kg × 12', qty: 2, price: 455,
        supply: 909, tax: 91, total: 1000, isTaxExempt: false, accountCode: '540' },
      { name: '별도 낱개', spec: '2kg', qty: 1, price: 909,
        supply: 909, tax: 91, total: 1000, isTaxExempt: false, accountCode: '540' }] } };
    expect(await issueOemFeeVoucher(db, 'taebaek', request)).toBe('OEMFEE-po-12');
    const issuedRef = db.collection('issuedStatements').doc('OEMFEE-po-12');
    const before = await issuedRef.get();
    expect(before.data()).toMatchObject({ totalAmount: 2000, totalSupply: 1818, totalTax: 182, items: request.statement.items });
    expect((await db.collection('purchaseOrders').doc('po-12').get()).data()?.linkedStatementId).toBe('OEMFEE-po-12');
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(1);
    expect(await issueOemFeeVoucher(db, 'taebaek', request)).toBe('OEMFEE-po-12');
    const after = await issuedRef.get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime).toEqual(before.updateTime);
    expect((await db.collection('appMeta').doc(counterId).get()).data()?.last).toBe(1);
  });
  it('현재 BOM12개입은 정상 중량과 가공비를 유지하고 별도 낱개와 섞여도 같게 발행한다', async () => {
    await seed(['po-13']);
    await Promise.all([
      db.collection('purchaseOrders').doc('po-13').update({ oemReceivedKg: 26, items: [
        { itemId: 'bom12-box', name: '현재 12개입', quantity: 2, unit: '개' },
        { itemId: 'bom12-loose-other', name: '별도 낱개', quantity: 1, unit: '개' }] }),
      db.collection('items').doc('bom12-box').set({ companyId: 'taebaek', name: '현재 12개입', spec: '1kg × 12', unit: '개', type: 'product' }),
      db.collection('items').doc('bom12-child').set({ companyId: 'taebaek', name: '구성 낱개', type: 'product' }),
      db.collection('items').doc('bom12-loose-other').set({ companyId: 'taebaek', name: '별도 낱개', spec: '2kg', unit: '개', type: 'product' }),
      db.collection('item_bom').doc('bom12-box-child').set({ parent_id: 'bom12-box', child_id: 'bom12-child', quantity: 12 }),
    ]);
    const request = { ...command('po-13'), statement: { ...statement('po-13'), totalSupply: 11818, totalTax: 1182, totalAmount: 13000,
      items: [{ name: '현재 12개입', spec: '1kg × 12', qty: 2, price: 5455, supply: 10909, tax: 1091, total: 12000, isTaxExempt: false, accountCode: '540' },
        { name: '별도 낱개', spec: '2kg', qty: 1, price: 909, supply: 909, tax: 91, total: 1000, isTaxExempt: false, accountCode: '540' }] } };
    expect(await issueOemFeeVoucher(db, 'taebaek', request)).toBe('OEMFEE-po-13');
    expect((await db.collection('issuedStatements').doc('OEMFEE-po-13').get()).data()?.items).toEqual(request.statement.items);
  });
  it.each(['issue','receipt'])('신규 %s 확인 근거와 발행 공급가를 배치·입고로트에 원자 확정하고 재시도 변조를 거절한다',async source=>{
    const poId=`po-confirmed-cost-${source}`,itemId=`confirmed-cost-product-${source}`;await seed([poId]);
    const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'own-raw',kg:12,supplyAmount:24000}],packaging:{confirmed:true,supplyAmount:3000},capturedAt:'2026-10-03T00:00:00Z'};
    const sent=[{rawItemId:'own-raw',kg:12}];const preview=buildOemBatchCostPreview(evidence,{companyId:'taebaek',sent},[{itemId,kg:10}]);
    await db.collection('items').doc(itemId).set({companyId:'taebaek',name:'원가 완제품',spec:'1kg',unit:'개',packageKg:30,cost:123,stock:10,lots:[{id:`lot-oem-${poId}-${itemId}`,poId,kgIn:10,kgRemaining:10,qtyIn:10,qtyRemaining:10,unitKg:1}]});
    await db.collection('purchaseOrders').doc(poId).update({partnerId:'factory',oemIssueDate:date,oemIssueFingerprint:JSON.stringify({companyId:'taebaek',partnerId:'factory',sent,date,note:'',oemCostEvidence:evidence}),oemSent:sent,oemCostEvidence:evidence,oemBatchCost:preview,items:[{itemId,name:'원가 완제품',quantity:10,unit:'개'}]});
    if(source==='receipt'){
      const receiptId=`oem-receive:${poId}`;
      await db.collection('purchaseOrders').doc(poId).update({oemCostEvidenceSource:'receipt',oemReceiptOperationId:receiptId,oemIssueFingerprint:admin.firestore.FieldValue.delete()});
      await db.collection('oemReceiptOperations').doc(receiptId).set({companyId:'taebaek',poId,oemCostEvidence:evidence});
    }
    const request={...command(poId),statement:{...statement(poId),items:[{name:'원가 완제품',spec:'1kg',qty:10,price:455,supply:4545,tax:455,total:5000,isTaxExempt:false,accountCode:'540'}]}};
    expect(await issueOemFeeVoucher(db,'taebaek',request)).toBe(`OEMFEE-${poId}`);
    const cost=(await db.collection('purchaseOrders').doc(poId).get()).get('oemBatchCost');
    expect(cost).toMatchObject({status:'confirmed',rawSupplyAmount:24000,packagingSupplyAmount:3000,feeSupplyAmount:4545,totalSupplyAmount:31545,costPerKg:3154.5});
    const item=(await db.collection('items').doc(itemId).get()).data()!;expect(item.cost).toBe(123);expect(item.stock).toBe(10);expect(item.lots[0].oemBatchCost).toMatchObject({allocatedSupplyAmount:31545,costPerKg:3154.5});
    expect(await issueOemFeeVoucher(db,'taebaek',request)).toBe(`OEMFEE-${poId}`);
    await db.collection('purchaseOrders').doc(poId).update({items:[{itemId,name:'원가 완제품',quantity:20,unit:'개'}]});
    await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow('원입고 로트 수량');
    await db.collection('purchaseOrders').doc(poId).update({items:[{itemId,name:'원가 완제품',quantity:10,unit:'개'}]});
    await db.collection('purchaseOrders').doc(poId).update({'oemBatchCost.totalSupplyAmount':1});
    await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow('원가 확인 근거');
    expect((await db.collection('appMeta').doc(counterId).get()).get('last')).toBe(1);
  });
});
