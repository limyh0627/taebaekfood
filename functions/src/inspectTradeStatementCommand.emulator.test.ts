import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'crypto';
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{constructor(public code:string,message:string,public details?:unknown){super(message);}},onCall:(_options:unknown,handler:unknown)=>handler}));
import {inspectTradeStatement,inspectTradeStatementCommand} from './inspectTradeStatementCommand';
import {issueTradeStatement} from './tradeStatementIssue';
import {statementIssueIdentity,statementIssueRef,statementIssueTextHash,prepareStatementIssue,STATEMENT_ISSUE_FENCE_GENERATION} from './statementIssueReceipt';
import {statementOriginalHash} from './deleteIssuedStatementCommand';
import {cashOriginalHash} from './cashMutationReceipt';
import {fingerprint} from './partnerPaymentCommand';

const available=/^(?:127\.0\.0\.1|localhost):(8082|8182)$/.test(process.env.FIRESTORE_EMULATOR_HOST??'');
const projectId='demo-inspect-statement-'+randomUUID();
const actor='합성관리자',companyId='taebaek',date='2026-10-15',releaseId='inspect-test-release';
let app:admin.app.App,db:admin.firestore.Firestore;
const ref=(collection:string,id:string)=>db.collection(collection).doc(id);
function fixture(){
 const id='inspect-'+randomUUID();
 const command={operationId:id+':ISSUE',statement:{id,companyId,tradeDate:date,type:'매출',partnerId:'partner',partnerName:'합성 거래처',orderId:'',
  totalSupply:100,totalTax:0,totalAmount:100,items:[{itemId:'item',name:'합성 상품',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'800'}]},
  orderIds:[] as string[],poIds:[] as string[],costUpdates:[],releaseId};
 const requestText=JSON.stringify(command,null,2),input={companyId,requestText,requestHash:statementIssueTextHash(requestText),inspectionId:'inspect-'+randomUUID()};
 const identity=statementIssueIdentity(companyId,actor,{...command,requestText});
 return {id,command,input,identity};
}
async function state(){
 const collections=await db.listCollections();
 const rows=await Promise.all(collections.map(async collection=>(await collection.get()).docs.map(doc=>[doc.ref.path,doc.updateTime?.toDate().toISOString(),doc.updateTime?.nanoseconds,doc.data()])));
 return rows.flat().sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
}
const inspect=(input:Parameters<typeof inspectTradeStatement>[3])=>inspectTradeStatement(db,companyId,actor,input);
async function applied(f:ReturnType<typeof fixture>){return issueTradeStatement(db,companyId,actor,{...f.command,requestText:f.input.requestText});}

describe.skipIf(!available)('전표 결과 확인의 실제 로컬 SDK 읽기',()=>{
 beforeAll(async()=>{
  app=admin.initializeApp({projectId},projectId);db=admin.firestore(app);
  await Promise.all([ref('partners','partner').set({companyId,name:'합성 거래처'}),ref('accountCodes','sale').set({companyId,code:'800',name:'매출'}),
   ref('appMeta','releaseCutover').set({status:'active',releaseId,voucherNotBefore:{taebaek:date}}),
   ref('appMeta',`voucherNo_taebaek_${date}_general`).set({companyId,tradeDate:date,prefix:'',last:0})]);
 });
 afterAll(async()=>{
  // 임의 demo namespace에 이 파일만 만든 자료를 지운다. 공유 namespace나 전체 초기화는 사용하지 않는다.
  for(const collection of await db.listCollections())for(const row of (await collection.get()).docs)await row.ref.delete();
  expect((await state()).length).toBe(0);await app.delete();
 });
 it.each(['absent','prepared','zero'] as const)('%s 요청은 unknown이며 쓰기·원문 변경이 없다',async kind=>{
  const f=fixture();
  if(kind==='zero'){f.command.statement.totalSupply=0;f.command.statement.totalAmount=0;f.command.statement.items[0].supply=0;f.command.statement.items[0].total=0;
   f.input.requestText=JSON.stringify(f.command);f.input.requestHash=statementIssueTextHash(f.input.requestText);}
  if(kind!=='absent')await prepareStatementIssue(db,statementIssueIdentity(companyId,actor,{...f.command,requestText:f.input.requestText}));
  const before=await state();expect(await inspect(f.input)).toMatchObject({status:'unknown',currentStatement:'unverified',requestHash:f.input.requestHash,inspectionId:f.input.inspectionId});expect(await state()).toEqual(before);
 });
 it('원문 없는 취소 봉인도 실제 회사·사용자와 취소 근거로 읽기만 한다',async()=>{
  const f=fixture();await statementIssueRef(db,f.identity).set({version:2,companyId,actorId:actor,statementId:f.id,operationId:f.command.operationId,
   status:'cancelled',revision:1,cancellationId:'cancel-proof',cancelledAt:'2026-01-01T00:00:03.000Z',drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:releaseId});
  const before=await state(),input={companyId,statementId:f.id,operationId:f.command.operationId,inspectionId:f.input.inspectionId};
  expect(await inspect(input)).toMatchObject({status:'cancelled',requestHash:'',cancellation:{cancellationId:'cancel-proof',receiptRevision:1}});expect(await state()).toEqual(before);
  await statementIssueRef(db,f.identity).update({actorId:'다른 사람'});await expect(inspect(input)).rejects.toMatchObject({code:'permission-denied'});
 });
 it.each(['absent','prepared','applied','foreignActor','tampered'] as const)('로컬 원문이 없어도 알려진 작업 ID의 %s 서버 원문을 안전하게 조회한다',async kind=>{
  const f=fixture();
  if(kind==='applied'||kind==='foreignActor'||kind==='tampered')await applied(f);
  if(kind==='prepared')await prepareStatementIssue(db,f.identity);
  if(kind==='foreignActor')await statementIssueRef(db,f.identity).update({actorId:'다른 사용자'});
  if(kind==='tampered')await statementIssueRef(db,f.identity).update({requestHash:'0'.repeat(64)});
  const input={companyId,inspectionId:f.input.inspectionId,statementId:f.id,operationId:f.command.operationId},before=await state();
  if(kind==='foreignActor'||kind==='tampered')await expect(inspect(input)).rejects.toThrow();
  else{
   const result=await inspect(input);expect(result.status).toBe(kind==='applied'?'applied':'unknown');
   if(kind==='absent'){expect(result.requestHash).toBe('');expect(result.serverRequestText).toBeUndefined();}
   else expect(result).toMatchObject({serverRequestText:f.input.requestText,requestHash:f.input.requestHash});
  }
  expect(await state()).toEqual(before);
 });
 it('정확 발행 뒤 비활성 전환에서도 동일 ID 본문을 읽고 쓰지 않는다',async()=>{
  const f=fixture();await applied(f);await ref('appMeta','releaseCutover').update({status:'inactive'});
  const before=await state();const result=await inspect(f.input);expect(result).toMatchObject({status:'applied',currentStatement:'present',statement:{id:f.id,companyId},actorId:actor});expect(result.docNo).toBeTruthy();expect(await state()).toEqual(before);
  await ref('appMeta','releaseCutover').update({status:'active'});
 });
 it.each(['changed','deleted'] as const)('실제 %s 감사 사슬은 공용 reader로 최초 발행을 확인한다',async kind=>{
  const f=fixture();await applied(f);const current=ref('issuedStatements',f.id),original=(await current.get()).data()!;
  if(kind==='changed'){
   const after={...original,note:'수정한 비고',mutationRevision:1};
   await Promise.all([current.set(after),ref('voucherMutationOperations',f.id+'-edit').set({kind:'issuedStatements',action:'edit-statement',status:'applied',companyId,statementId:f.id,uid:actor,
    expectedRevision:0,revision:1,beforeSnapshot:original,beforeHash:cashOriginalHash(original),afterHash:cashOriginalHash(after)})]);
  }else await Promise.all([current.delete(),ref('voucherMutationOperations',f.id+'-delete').set({kind:'issuedStatements',action:'delete',status:'applied',companyId,voucherId:f.id,statementIds:[f.id],createdBy:actor,
   beforeSnapshot:original,beforeHash:statementOriginalHash(original),afterHash:null})]);
  const before=await state();expect(await inspect(f.input)).toMatchObject({status:'applied',currentStatement:kind});expect(await state()).toEqual(before);
 });
 it.each(['actor','hash','body','company','inspection','receiptActor'] as const)('%s 변조는 결과 확인을 거절한다',async kind=>{
  const f=fixture();await applied(f);const input={...f.input};
  if(kind==='hash')input.requestHash='0'.repeat(64);
  if(kind==='body')input.requestText+=' ';
  if(kind==='company')input.companyId='punghoe';
  if(kind==='inspection')input.inspectionId='../other';
  if(kind==='receiptActor')await statementIssueRef(db,f.identity).update({actorId:'other'});
  const before=await state();await expect(kind==='actor'?inspectTradeStatement(db,companyId,'other',input):inspect(input)).rejects.toThrow();expect(await state()).toEqual(before);
 });
 it('영수증 없이 다른 본문만 존재하거나 발행 원본이 바뀌면 확인 ACK를 주지 않는다',async()=>{
  const absent=fixture();await ref('issuedStatements',absent.id).set({companyId,docNo:'다른 전표'});expect(await inspect(absent.input)).toMatchObject({status:'unknown',currentStatement:'unverified'});
  const f=fixture();await applied(f);await ref('issuedStatements',f.id).update({totalAmount:999});expect(await inspect(f.input)).toMatchObject({status:'unknown',currentStatement:'unverified'});
 });
 it('기존 봉쇄 완료 거절만 그대로 반환하고 prepared를 승격하지 않는다',async()=>{
  const f=fixture();await prepareStatementIssue(db,f.identity);await statementIssueRef(db,f.identity).update({status:'rejected',revision:1,failureCode:'invalid-argument',failureMessage:'금액을 확인해 주세요.',
   drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:releaseId,rejectedAt:new Date().toISOString()});
  const before=await state();expect(await inspect(f.input)).toMatchObject({status:'rejected',rejection:{...f.identity,operationStatus:'rejected',financialWrites:false,receiptRevision:1}});expect(await state()).toEqual(before);
  await statementIssueRef(db,f.identity).update({drainGeneration:'위조'});expect(await inspect(f.input)).toMatchObject({status:'unknown'});
 });
 it.each(['applied','rejected','absent','wrongActor','wrongEntry','changed','deleted'] as const)('수금 %s 결과는 전표와 별도로 조회하고 계좌 활성화를 요구하지 않는다',async kind=>{
  const f=fixture();await applied(f);const operationId='payment-'+randomUUID();
  const payment={operationId,tradeDate:date,partnerId:'partner',direction:'입금',amount:100,cashAccountId:'inactive',pin:false,allocations:[{statementId:f.id,amount:100}],note:'',expectedRevision:0,releaseId};
  const requestHash=fingerprint(payment),business={companyId,partnerId:'partner',date,cashAccountId:'inactive',dir:'입금',amount:100,lines:[{accountCode:'108',amount:100}],note:''};
  if(kind!=='absent')await ref('partnerPaymentOperations',operationId).set({companyId,partnerId:'partner',createdBy:kind==='wrongActor'?'other':actor,requestHash,
   ...(kind==='rejected'?{status:'rejected',failureCode:'failed-precondition',failureMessage:'계좌를 확인해 주세요.'}:{entryHash:fingerprint(business),docNo:'번호',cashEntryId:operationId,issuePrefix:'',settlements:[]})});
  if(kind!=='absent'&&kind!=='rejected')await ref('cashEntries',operationId).set({...business,amount:kind==='wrongEntry'?999:100,docNo:'번호',issuePrefix:'',issueOperationId:operationId,issuePayloadHash:requestHash});
  if(kind==='changed'||kind==='deleted'){
   const original=(await ref('cashEntries',operationId).get()).data()!,after={...original,note:'수정된 현금 비고',mutationRevision:1};
   await ref('voucherMutationOperations',operationId+'-audit').set({kind:'cashEntries',status:'applied',action:kind==='deleted'?'delete':'edit',companyId,voucherId:operationId,cashEntryIds:[operationId],createdBy:actor,
    expectedRevision:0,beforeSnapshot:original,beforeHash:cashOriginalHash(original),afterHash:kind==='deleted'?null:cashOriginalHash(after)});
   if(kind==='deleted')await ref('cashEntries',operationId).delete();else await ref('cashEntries',operationId).set(after);
  }
  const before=await state(),request={...f.input,paymentRequestText:JSON.stringify(payment)};
  if(kind==='wrongActor')await expect(inspect(request)).rejects.toThrow('사용자');
  else expect(await inspect(request)).toMatchObject({status:'applied',payment:{status:kind==='wrongEntry'||kind==='absent'?'unknown':kind==='rejected'?'rejected':'applied',operationId,requestHash}});
  expect(await state()).toEqual(before);
 });
 it.each(['cancelled-applied','cancelled-rejected','cancelled-absent','missing-applied','wrongActor','wrongCompany','wrongAllocation','wrongPartner','wrongHash'] as const)('전표 원문이 없는 %s에서도 기존 결제 결과만 검증해 읽는다',async kind=>{
  const f=fixture(),operationId='payment-'+randomUUID(),payment={operationId,tradeDate:date,partnerId:'partner',direction:'입금',amount:100,cashAccountId:'inactive',pin:false,allocations:[{statementId:f.id,amount:100}],note:'',expectedRevision:0,releaseId};
  const requestHash=fingerprint(payment),business={companyId,partnerId:'partner',date,cashAccountId:'inactive',dir:'입금',amount:100,lines:[{accountCode:'108',amount:100}],note:''};
  if(kind!=='missing-applied')await statementIssueRef(db,f.identity).set({version:2,companyId,actorId:actor,statementId:f.id,operationId:f.command.operationId,status:'cancelled',revision:1,cancellationId:'cancel-proof',cancelledAt:'2026-01-01T00:00:03.000Z',drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:releaseId});
  if(kind!=='cancelled-absent'){
   await ref('partnerPaymentOperations',operationId).set({companyId:kind==='wrongCompany'?'punghoe':companyId,partnerId:kind==='wrongPartner'?'other':'partner',createdBy:kind==='wrongActor'?'other':actor,requestHash:kind==='wrongHash'?'tampered':requestHash,
    ...(kind==='cancelled-rejected'?{status:'rejected',failureCode:'failed-precondition',failureMessage:'이미 거절된 결제'}:{entryHash:fingerprint(business),docNo:'결제번호',cashEntryId:operationId,issuePrefix:'',settlements:[]})});
   if(kind!=='cancelled-rejected')await ref('cashEntries',operationId).set({...business,docNo:'결제번호',issuePrefix:'',issueOperationId:operationId,issuePayloadHash:requestHash});
  }
  if(kind==='wrongAllocation')payment.allocations[0].statementId='different-statement';
  const input={companyId,statementId:f.id,operationId:f.command.operationId,inspectionId:f.input.inspectionId,paymentRequestText:JSON.stringify(payment)},before=await state();
  if(kind.startsWith('wrong'))await expect(inspect(input)).rejects.toThrow();
  else expect(await inspect(input)).toMatchObject({status:kind==='missing-applied'?'unknown':'cancelled',payment:{status:kind==='cancelled-absent'?'unknown':kind==='cancelled-rejected'?'rejected':'applied',operationId,requestHash}});
  expect(await state()).toEqual(before);
 });
 it('호출 인증·관리자·회사 권한과 actual UID를 확인한다',async()=>{
  const handler=inspectTradeStatementCommand as unknown as (request:unknown)=>Promise<unknown>;
  const f=fixture();
  await expect(handler({data:f.input})).rejects.toMatchObject({code:'unauthenticated'});
  await expect(handler({auth:{uid:actor,token:{companyId,isAdmin:false}},data:f.input})).rejects.toMatchObject({code:'permission-denied'});
  await expect(handler({auth:{uid:actor,token:{companyId:'other',isAdmin:true}},data:f.input})).rejects.toMatchObject({code:'permission-denied'});
 });
 it.each(['date','quantity'] as const)('잘못된 %s는 기존 작성 서버가 계속 거절한다',async kind=>{
  const f=fixture();if(kind==='date')f.command.statement.tradeDate='2026-02-30';else f.command.statement.items[0].qty=0;
  await expect(issueTradeStatement(db,companyId,actor,f.command)).rejects.toMatchObject({code:'invalid-argument'});expect((await ref('issuedStatements',f.id).get()).exists).toBe(false);
 });
});
