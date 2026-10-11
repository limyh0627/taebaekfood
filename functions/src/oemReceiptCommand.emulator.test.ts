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

  it('낡은 unpackTo는 개 중량을 곱하지 않고 현재 BOM 12개입만 박스로 환산한다', async () => {
    for (const boxed of [false, true]) {
      const key = `${prefix}-${boxed ? 'bom12' : 'stale12'}`;
      const product = `${key}-item`, raw = `${key}-raw`, po = `${key}-po`;
      const child = `${key}-child`, formula = `${key}-formula`, bom = `${key}-bom`;
      const counter = `oemLotSequence_taebaek_20261003_${encodeURIComponent(raw)}`;
      const operation = `oem-receive:${po}`;
      paths.push(`items/${product}`, `items/${child}`, `item_formula/${formula}`, `item_bom/${bom}`,
        `purchaseOrders/${po}`, `appMeta/${counter}`, `adjustmentRequests/OEMFEE-${po}`, `oemReceiptOperations/${operation}`);
      await Promise.all([
        db.doc(`items/${product}`).create({ companyId: 'taebaek', name: key, type: 'product', procureType: '임가공', unit: '개', spec: '1kg × 12', stock: 0, lots: [], unpackTo: { count: 12 }, testRunId: prefix }),
        db.doc(`items/${child}`).create({ companyId: 'taebaek', name: `${key} 낱개`, type: 'product', testRunId: prefix }),
        db.doc(`item_formula/${formula}`).create({ parent_key: key, child_name: raw, ratio: 1, yield_rate: 1, testRunId: prefix }),
        db.doc(`purchaseOrders/${po}`).create({ companyId: 'taebaek', poType: 'oem', status: 'invoiced', oemPartnerId: partnerId, partnerName: 'demo OEM', oemSent: [{ material: raw, kg: 30 }], testRunId: prefix }),
        db.doc(`appMeta/${counter}`).create({ companyId: 'taebaek', material: raw, date, lastSequence: 0, testRunId: prefix }),
      ]);
      if (boxed) await db.doc(`item_bom/${bom}`).create({ parent_id: product, child_id: child, quantity: 12, testRunId: prefix });
      const expectedKg = boxed ? 24 : 2;
      const result = await receiveOemFinishedGoods(db, 'taebaek', { ...input(), poId: po, operationId: operation, returns: [{ itemId: product, qty: 2 }] });
      expect(result.receivedKg).toBe(expectedKg);
      expect((await saved(`items/${product}`))?.stock).toBe(2);
      expect((await saved(`items/${product}`))?.lots[0].unitKg).toBe(boxed ? 12 : 1);
      expect((await saved(`adjustmentRequests/OEMFEE-${po}`))?.oemTotal).toBe(expectedKg * 500);
      expect((await saved(`purchaseOrders/${po}`))?.oemReceivedKg).toBe(expectedKg);
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
  it('명시 원가 배치는 소수 중량 두 로트의 합계를 PO·preview·가공비에 동일하게 저장한다',async()=>{
    await db.doc('appMeta/releaseCutover').update({status:'active',releaseId:prefix,oemLotCutoverDate:date});
    const po=`${poId}-fraction`,operation=`oem-receive:${po}`,products=[`${prefix}-fraction-a`,`${prefix}-fraction-b`];
    paths.push(`purchaseOrders/${po}`,`oemReceiptOperations/${operation}`,`adjustmentRequests/OEMFEE-${po}`);
    const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw-fraction',kg:1,supplyAmount:1000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-03T00:00:00Z'};
    for(const product of products){
      paths.push(`items/${product}`,`item_formula/${product}`);
      await db.doc(`items/${product}`).create({companyId:'taebaek',name:product,procureType:'임가공',unit:'개',packageKg:0.3333,stock:0,lots:[],testRunId:prefix});
      await db.doc(`item_formula/${product}`).create({parent_key:product,child_name:material,ratio:1,yield_rate:1,testRunId:prefix});
    }
    await db.doc(`purchaseOrders/${po}`).create({companyId:'taebaek',poType:'oem',status:'invoiced',oemPartnerId:partnerId,oemSent:[{material,rawItemId:'raw-fraction',kg:1}],testRunId:prefix});
    const result=await receiveOemFinishedGoods(db,'taebaek',{...input(),poId:po,operationId:operation,returns:products.map(itemId=>({itemId,qty:1})),unitPricePerKg:1000,oemCostEvidence:evidence});
    const stored=await saved(`purchaseOrders/${po}`);
    const lots=await Promise.all(products.map(async product=>(await saved(`items/${product}`))?.lots[0]));
    expect(result.receivedKg).toBe(0.666);
    expect(lots.map(lot=>lot.kgIn)).toEqual([0.333,0.333]);
    expect(stored?.oemReceivedKg).toBe(0.666);
    expect(stored?.oemBatchCost.receivedKg).toBe(0.666);
    expect(stored?.oemBatchCost.rows.reduce((sum:number,row:{kg:number})=>sum+row.kg,0)).toBe(0.666);
    expect((await saved(`adjustmentRequests/OEMFEE-${po}`))?.oemTotal).toBe(666);
  });  it('신규 원가 근거는 미확정 preview로 고정하고 변조·증가수율과 누락을 구분한다',async()=>{
    await db.doc('appMeta/releaseCutover').update({status:'active',releaseId:prefix,oemLotCutoverDate:date});
    for(const mode of ['confirmed','yield','missing','receipt']){
      const newPo=`${poId}-cost-${mode}`,newOperation=`oem-receive:${newPo}`;
      paths.push(`purchaseOrders/${newPo}`,`oemReceiptOperations/${newOperation}`,`adjustmentRequests/OEMFEE-${newPo}`);
      const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw-source',kg:6,supplyAmount:12000}],packaging:{confirmed:true,supplyAmount:3000},capturedAt:'2026-10-03T00:00:00Z'};
      await db.doc(`purchaseOrders/${newPo}`).create({companyId:'taebaek',poType:'oem',status:'invoiced',oemPartnerId:partnerId,partnerName:'demo OEM',oemSent:[{material,rawItemId:'raw-source',kg:6}],...(['missing','receipt'].includes(mode)?{}:{oemCostEvidence:evidence}),testRunId:prefix});
      if(!['missing','receipt'].includes(mode))await db.doc(`purchaseOrders/${newPo}`).update({partnerId,oemIssueDate:date,oemIssueFingerprint:JSON.stringify({companyId:'taebaek',partnerId,sent:[{material,rawItemId:'raw-source',kg:6}],date,note:'',oemCostEvidence:evidence})});
      const request={...input(),poId:newPo,operationId:newOperation,returns:[{itemId,qty:mode==='yield'?7:5}],...(mode==='receipt'?{oemCostEvidence:evidence}:{})};
      const beforeCost=(await saved(`items/${itemId}`))?.cost;
      expect((await receiveOemFinishedGoods(db,'taebaek',request)).status).toBe('applied');
      const cost=(await saved(`purchaseOrders/${newPo}`))?.oemBatchCost;
      expect(cost).toMatchObject(['confirmed','receipt'].includes(mode)?{status:'pending-fee',rawSupplyAmount:12000,packagingSupplyAmount:3000,receivedKg:5,lossKg:1}:{status:'blocked',reason:mode==='yield'?'yield-unconfirmed':'missing-evidence'});
      expect(cost.totalSupplyAmount).toBeUndefined();expect((await saved(`items/${itemId}`))?.cost).toBe(beforeCost);
      expect((await receiveOemFinishedGoods(db,'taebaek',request)).status).toBe('duplicate');
      if(mode==='receipt'){
        expect((await saved(`purchaseOrders/${newPo}`))?.oemCostEvidenceSource).toBe('receipt');
        expect((await saved(`oemReceiptOperations/${newOperation}`))?.oemCostEvidence).toEqual(evidence);
        await expect(receiveOemFinishedGoods(db,'taebaek',{...request,oemCostEvidence:{...evidence,capturedAt:'2026-10-04T00:00:00Z'}})).rejects.toThrow();
        await db.doc(`oemReceiptOperations/${newOperation}`).update({'oemCostEvidence.rawMaterials':[{rawItemId:'raw-source',kg:6,supplyAmount:1}]});
        await expect(receiveOemFinishedGoods(db,'taebaek',request)).rejects.toThrow('고정한 원가 근거');
      }
      if(mode==='confirmed'){
        await db.doc(`purchaseOrders/${newPo}`).update({'oemCostEvidence.rawMaterials':[{rawItemId:'raw-source',kg:6,supplyAmount:1}]});
        await expect(receiveOemFinishedGoods(db,'taebaek',request)).rejects.toThrow('원가 입력 근거');
      }
    }
  });
});
