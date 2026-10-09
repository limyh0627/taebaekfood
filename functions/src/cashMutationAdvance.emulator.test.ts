import { advanceClaims, readPartnerAdvanceSnapshot } from './partnerAdvanceReader';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { applyPartnerAdvance, preparePartnerAdvance } from './partnerAdvanceCommand';
import { genericVoucherBusiness, semanticHash, statementBusiness } from './shared/partnerAdvanceReceipt';
import { editIssuedStatement } from './editIssuedStatementCommand';
import { deleteIssuedStatement, statementOriginalHash } from './deleteIssuedStatementCommand';
import { processGeneralStockReturn } from './processReturnCommand';
import { voucherSequenceKey } from './voucherIssue';
import { mutateCashEntry, cashOriginalHash } from './cashMutationCommand';
import { kstDateOf } from './shared/calculation';
const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082';
const run = `lifecycle-${randomUUID()}`, actor = `${run}-actor`, company = 'taebaek', date = kstDateOf(new Date());
let app: admin.app.App, db: admin.firestore.Firestore;
const ref = (collection: string, id: string) => db.collection(collection).doc(id);
const globals = ['releaseCutover', 'partnerPaymentCutover_taebaek', 'partnerAdvanceCutover_taebaek', 'returnCutover_taebaek', voucherSequenceKey(company,date,'대체'), voucherSequenceKey(company,date,'반품')];
const originals = new Map<string, admin.firestore.DocumentData | undefined>();
const collections = ['partners','items','accountCodes','cashEntries','issuedStatements','settlements','returnRequests','returnApplications','returnOperations','partnerAdvanceOperations','voucherMutationOperations','appMeta'];
async function fixture(label: string, amount = 100, prepay = false) {
  const partnerId = `${run}-${label}`, cashId = `${partnerId}-cash`, targetId = `${partnerId}-target`, itemId = `${partnerId}-item`;
  const cash = { companyId:company, partnerId, date, dir:prepay?'출금':'입금', amount:100, accountCode:prepay?'133':'254', cashAccountId:'synthetic-bank', createdBy:actor, docNo:'synthetic-cash', issuePrefix:'', issueOperationId:cashId };
  const statement = { companyId:company, partnerId, type:prepay?'매입':'매출', tradeDate:date, totalSupply:100, totalTax:0, totalAmount:100, items:[{itemId,name:'합성 품목',spec:'',qty:5,price:20,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:prepay?'500':'800'}], createdBy:actor, docNo:'synthetic-sale', issuePrefix:'', issueOperationId:`${targetId}:ISSUE` };
  await Promise.all([ref('partners',partnerId).set({companyId:company,name:'합성 거래처'}),ref('cashEntries',cashId).set({...cash,issuePayloadHash:semanticHash(genericVoucherBusiness(cash))}),ref('issuedStatements',targetId).set({...statement,issueStatementHash:semanticHash(statementBusiness(statement))}),ref('items',itemId).set({companyId:company,type:'goods',unit:'개',stock:5,name:'합성 품목'})]);
  const ready = await preparePartnerAdvance(db,company,partnerId);
  const input = {operationId:`${partnerId}-apply`,partnerId,date,source:{collection:'cashEntries' as const,id:cashId,lineKey:prepay?'133':'254'},statementId:targetId,accountCode:(prepay?'251':'108') as '251'|'108',amount,expectedRevision:ready.revision,releaseId:run,expectedSourceFingerprint:ready.sources[0].fingerprint,expectedTargetFingerprint:ready.targets[0].fingerprint};
  const first = await applyPartnerAdvance(db,company,actor,input);
  return {partnerId,cashId,targetId,itemId,input,first};
}
describe.skipIf(!available)('선급·선수 원천 현금 변경의 단일 SDK transaction', {timeout:90000}, () => {
  beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-taebaekfood-local'},run);db=admin.firestore(app);for(const id of globals)originals.set(id,(await ref('appMeta',id).get()).data());await ref('appMeta','releaseCutover').set({status:'active',releaseId:run,voucherNotBefore:{taebaek:'2026-10-03',punghoe:'2026-10-01'}});for(const prefix of ['partnerPaymentCutover','partnerAdvanceCutover','returnCutover'])await ref('appMeta',`${prefix}_taebaek`).set({companyId:company,enabled:true,auditPassed:true,legacyWritersBlocked:true,purchaseGeneralStockEnabled:true});for(const kind of ['대체','반품'])await ref('appMeta',voucherSequenceKey(company,date,kind)).set({companyId:company,tradeDate:date,prefix:kind,last:100});for(const code of ['800','500','108','254','133','251'])await ref('accountCodes',`${run}-${code}`).set({companyId:company,code});},90000);
  afterAll(async()=>{if(!db)return;for(const name of collections){const docs=(await db.collection(name).get()).docs;for(const doc of docs){const row=doc.data();if(doc.id.includes(run)||String(row.partnerId??'').includes(run)||String(row.createdBy??'').includes(run))await doc.ref.delete();}expect((await db.collection(name).get()).docs.filter(doc=>doc.id.includes(run)||String(doc.data().partnerId??'').includes(run))).toHaveLength(0);}for(const [id,row] of originals)row?await ref('appMeta',id).set(row):await ref('appMeta',id).delete();await app.delete();},90000);
  it.each([['edit',false],['delete',false],['edit',true],['delete',true]] as const)('원천 %s 선급=%s는 활성 적용을 원자 취소하고 대상 미결을 복원한다',async (action,prepay)=>{
    const f=await fixture(action+'-'+prepay,100,prepay);const original=await ref('cashEntries',f.cashId).get();
    const beforeCounter=(await ref('appMeta',voucherSequenceKey(company,date,'대체')).get()).get('last');
    const target=await ref('issuedStatements',f.targetId).get();
    const input={operationId:f.partnerId+'-mutation',cashEntryId:f.cashId,action,expectedRevision:0,expectedCashHash:cashOriginalHash(original.data()!),releaseId:run,...(action==='edit'?{patch:{amount:50}}:{})};
    expect((await mutateCashEntry(db,company,actor,input)).status).toBe('applied');
    const ready=await preparePartnerAdvance(db,company,f.partnerId);
    expect(ready.applications).toHaveLength(0);expect(ready.revision).toBe(2);
    const claims=await db.runTransaction(async tx=>{await tx.get(ref('partners',f.partnerId));return advanceClaims(await readPartnerAdvanceSnapshot(db,tx,company,f.partnerId));});
    expect(claims.find(row=>row.id===f.targetId)?.amount).toBe(100);
    if(action==='edit'){expect(ready.sources[0].remaining).toBe(50);expect((await original.ref.get()).get('amount')).toBe(50);}else{expect(ready.sources).toHaveLength(0);expect((await original.ref.get()).exists).toBe(false);}
    expect((await target.ref.get()).updateTime!.isEqual(target.updateTime!)).toBe(true);
    const audit=await ref('voucherMutationOperations',input.operationId).get();expect(audit.get('canceledAdvanceStatementIds')).toHaveLength(1);
    const counter=await ref('appMeta',voucherSequenceKey(company,date,'대체')).get();expect(counter.get('last')).toBe(beforeCounter+1);
    expect((await mutateCashEntry(db,company,actor,input)).status).toBe('duplicate');expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
  });
  it('동시 동일 원천 수정은 취소와 거래처 revision을 한 번만 저장한다',async()=>{
    const f=await fixture('concurrent');const original=await ref('cashEntries',f.cashId).get();
    const input={operationId:f.partnerId+'-mutation',cashEntryId:f.cashId,action:'edit' as const,expectedRevision:0,expectedCashHash:cashOriginalHash(original.data()!),releaseId:run,patch:{amount:50}};
    const results=await Promise.all([mutateCashEntry(db,company,actor,input),mutateCashEntry(db,company,actor,input)]);
    expect(results.map(row=>row.status).sort()).toEqual(['applied','duplicate']);
    const ready=await preparePartnerAdvance(db,company,f.partnerId);expect(ready.applications).toHaveLength(0);expect(ready.revision).toBe(2);
    const cancellations=(await db.collection('issuedStatements').where('partnerId','==',f.partnerId).get()).docs.filter(doc=>doc.get('noncashApplication.kind')==='advance-cancellation');expect(cancellations).toHaveLength(1);
  });
});