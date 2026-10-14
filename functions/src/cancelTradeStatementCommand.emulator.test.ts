import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{constructor(public code:string,message:string,public details?:unknown){super(message);}},onCall:(_options:unknown,handler:unknown)=>handler}));
import {cancelTradeStatement,cancelTradeStatementCommand} from './cancelTradeStatementCommand';
import {issueTradeStatement} from './tradeStatementIssue';
import {issueVoucher} from './voucherIssue';
import {inspectTradeStatement} from './inspectTradeStatementCommand';
import {statementIssueIdentity,statementIssueRef,prepareStatementIssue,STATEMENT_ISSUE_FENCE_GENERATION,STATEMENT_ISSUE_FENCE_WRITERS} from './statementIssueReceipt';
const available=/^(127\.0\.0\.1|localhost):(8082|8182)$/.test(process.env.FIRESTORE_EMULATOR_HOST??'');
const actor='actor',companyId='taebaek',date='2026-10-15',releaseId='cancel-sdk';
let app:admin.app.App,db:admin.firestore.Firestore,sequence=Date.now();
const gate=()=>({status:'active',releaseId,voucherNotBefore:{taebaek:date},oldWritersBlocked:true,oldWritersBlockedEvidence:'로컬 SDK 합성 봉쇄',statementIssueProtocol:{version:1,status:'active',generation:STATEMENT_ISSUE_FENCE_GENERATION,releaseId,oldServerDrained:true,oldServerDrainConfirmedAt:'2026-01-01T00:00:02.000Z',writerEvidence:Object.fromEntries(STATEMENT_ISSUE_FENCE_WRITERS.map(name=>[name,{generation:STATEMENT_ISSUE_FENCE_GENERATION,deployedAt:'2026-01-01T00:00:00.000Z',oldRevisionDrainedAt:'2026-01-01T00:00:01.000Z',evidence:'로컬 SDK 합성 종료 근거'}]))}});
function fixture(){
 const id='stmt-'+(++sequence),command={operationId:id+':ISSUE',releaseId,statement:{id,companyId,type:'매출',partnerId:'p',partnerName:'합성 거래처',tradeDate:date,orderId:'',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'합성 상품',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'800'}]},orderIds:[],poIds:[],costUpdates:[]};
 return {command,identity:statementIssueIdentity(companyId,actor,command),input:{companyId,statementId:id,operationId:command.operationId,cancellationId:randomUUID(),inspectionId:randomUUID()}};
}
const cancel=(input:ReturnType<typeof fixture>['input'])=>cancelTradeStatement(db,companyId,actor,input);
describe.skipIf(!available)('사용자 확인 후 전표 요청 취소 실제 SDK',()=>{
 beforeAll(()=>{const projectId='demo-cancel-'+randomUUID();app=admin.initializeApp({projectId},projectId);db=admin.firestore(app);});
 beforeEach(async()=>{await db.doc('appMeta/releaseCutover').set(gate());await db.doc('partners/p').set({companyId});await db.doc('accountCodes/sale').set({companyId,code:'800'});await db.doc(`appMeta/voucherNo_taebaek_${date}_general`).set({companyId,tradeDate:date,prefix:'',last:0});});
 afterAll(async()=>{for(const col of await db.listCollections())for(const doc of (await col.get()).docs)await doc.ref.delete();expect((await Promise.all((await db.listCollections()).map(col=>col.get()))).every(s=>s.empty)).toBe(true);await app.delete();});
 it.each(['absent','prepared','damaged','rejected'] as const)('%s 원문도 본인 요청을 취소하고 같은 취소 재시도·조회·늦은 최초 송신을 처리한다',async kind=>{
  const f=fixture(),ref=statementIssueRef(db,f.identity);
  if(kind!=='absent')await prepareStatementIssue(db,f.identity);
  if(kind==='damaged')await ref.update({requestText:'{손상된 원문',requestHash:'손상'});
  if(kind==='rejected')await ref.update({status:'rejected',revision:1});
  const result=await cancel(f.input);expect(result).toMatchObject({status:'cancelled',cancellationId:f.input.cancellationId,cancellation:{receiptRevision:kind==='rejected'?2:1}});
  const before=await ref.get();expect(await cancel(f.input)).toEqual(result);expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  expect(await inspectTradeStatement(db,companyId,actor,{companyId,statementId:f.input.statementId,operationId:f.input.operationId,inspectionId:f.input.inspectionId})).toMatchObject({status:'cancelled',cancellation:{cancellationId:f.input.cancellationId}});
  await expect(issueTradeStatement(db,companyId,actor,f.command)).rejects.toThrow('취소한');
  await expect(prepareStatementIssue(db,f.identity)).rejects.toThrow('취소한');
  await expect(issueVoucher(db,companyId,{kind:'issuedStatements',operationId:f.input.statementId,releaseId,tradeDate:date,document:{tradeDate:date,totalSupply:100,totalTax:0,totalAmount:100}})).rejects.toThrow('먼저 저장된');
  expect((await db.doc('issuedStatements/'+f.input.statementId).get()).exists).toBe(false);
 });
 it.each(['actorId','companyId'] as const)('다른 %s 영수증을 취소하지 않는다',async field=>{
  const f=fixture();await prepareStatementIssue(db,f.identity);const ref=statementIssueRef(db,f.identity);await ref.update({[field]:'other'});const before=await ref.get();
  await expect(cancel(f.input)).rejects.toMatchObject({code:'permission-denied'});expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 });
 it('실제 발행된 전표는 취소하지 않고 기존 전표를 반환한다',async()=>{
  const f=fixture();await issueTradeStatement(db,companyId,actor,f.command);const before=await statementIssueRef(db,f.identity).get();
  expect(await cancel(f.input)).toMatchObject({status:'applied',currentStatement:'present',statement:{id:f.input.statementId}});
  expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 });
 it.each([['issuedStatements','id'],['cashEntries','id'],['voucherMutationOperations','statementId'],['voucherMutationOperations','statementIds'],['voucherMutationOperations','cashEntryId'],['voucherMutationOperations','cashEntryIds'],['settlements','statementId'],['settlements','cashEntryId'],['orders','linkedStatementId'],['purchaseOrders','linkedStatementId']])('%s/%s 흔적이 있으면 취소 봉인하지 않는다',async(collection,field)=>{
  const f=fixture(),ref=db.collection(collection).doc(field==='id'?f.input.statementId:randomUUID());await ref.set({companyId,...(field==='id'?{}:{[field]:field.endsWith('Ids')?[f.input.statementId]:f.input.statementId})});
  expect(await cancel(f.input)).toMatchObject({status:'unknown'});expect((await statementIssueRef(db,f.identity).get()).exists).toBe(false);await ref.delete();
 });
 it.each(['missing','not-drained','inactive'] as const)('종료 근거 %s면 unknown과 원문 보존',async kind=>{
  const f=fixture();await prepareStatementIssue(db,f.identity);const ref=statementIssueRef(db,f.identity),before=await ref.get();
  if(kind==='missing')await db.doc('appMeta/releaseCutover').update({statementIssueProtocol:admin.firestore.FieldValue.delete()});
  if(kind==='not-drained')await db.doc('appMeta/releaseCutover').update({'statementIssueProtocol.oldServerDrained':false});
  if(kind==='inactive')await db.doc('appMeta/releaseCutover').update({status:'inactive'});
  expect(await cancel(f.input)).toMatchObject({status:'unknown',reason:expect.stringContaining('서버 확인')});expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 });
 it('발행과 취소가 경합하면 한 쪽만 확정되고 늦은 재송신도 효과를 추가하지 않는다',async()=>{
  const f=fixture();await prepareStatementIssue(db,f.identity);
  const [issued,cancelled]=await Promise.allSettled([issueTradeStatement(db,companyId,actor,f.command),cancel(f.input)]);
  const row=(await statementIssueRef(db,f.identity).get()).data()!,exists=(await db.doc('issuedStatements/'+f.input.statementId).get()).exists;
  if(row.status==='cancelled'){expect(exists).toBe(false);expect(issued.status).toBe('rejected');expect(cancelled).toMatchObject({status:'fulfilled',value:{status:'cancelled'}});await expect(issueTradeStatement(db,companyId,actor,f.command)).rejects.toThrow('취소한');}
  else{expect(row.status).toBe('applied');expect(exists).toBe(true);expect(issued.status).toBe('fulfilled');expect(cancelled).toMatchObject({status:'fulfilled',value:{status:'applied'}});}
 },25000);
 it('영수증 없는 취소와 generic 발행 경합도 한 가지 효과만 확정한다',async()=>{
  const f=fixture(),id=f.input.statementId;
  const results=await Promise.allSettled([cancel(f.input),issueVoucher(db,companyId,{kind:'issuedStatements',operationId:id,releaseId,tradeDate:date,document:{tradeDate:date,totalSupply:100,totalTax:0,totalAmount:100}})]);
  const receipt=await statementIssueRef(db,f.identity).get(),statement=await db.doc('issuedStatements/'+id).get();
  if(receipt.exists){expect(receipt.get('status')).toBe('cancelled');expect(statement.exists).toBe(false);expect(results[0]).toMatchObject({status:'fulfilled',value:{status:'cancelled'}});expect(results[1].status).toBe('rejected');}
  else{expect(statement.exists).toBe(true);expect(results[0]).toMatchObject({status:'fulfilled',value:{status:'unknown'}});expect(results[1].status).toBe('fulfilled');}
 },25000);
 it('동일 취소 동시 요청은 영수증 하나와 같은 결과를 반환한다',async()=>{
  const f=fixture(),results=await Promise.all([cancel(f.input),cancel(f.input)]);expect(results[0]).toEqual(results[1]);
  expect((await statementIssueRef(db,f.identity).get()).get('revision')).toBe(1);
 });
 it('다른 취소 ID와 다른 회사 입력·구형 ID를 거절한다',async()=>{
  const f=fixture();await cancel(f.input);await expect(cancel({...f.input,cancellationId:randomUUID()})).rejects.toThrow('이미 취소');
  await expect(cancel({...f.input,companyId:'punghoe'})).rejects.toMatchObject({code:'invalid-argument'});
  await expect(cancel({...f.input,statementId:'OEMFEE-old',operationId:'OEMFEE-old:ISSUE'})).rejects.toMatchObject({code:'invalid-argument'});
 });
 it('prepare가 끝나 apply가 시작하기 직전에 취소해도 이전 요청은 적용되지 않는다',async()=>{
  const f=fixture(),original=db.runTransaction.bind(db);let calls=0;
  const spy=vi.spyOn(db,'runTransaction').mockImplementation((async(...args:any[])=>{
   calls++;if(calls===2)expect(await cancel(f.input)).toMatchObject({status:'cancelled'});
   return (original as any)(...args);
  }) as typeof db.runTransaction);
  try{await expect(issueTradeStatement(db,companyId,actor,f.command)).rejects.toThrow('취소한');}
  finally{spy.mockRestore();}
  expect((await db.doc('issuedStatements/'+f.input.statementId).get()).exists).toBe(false);
  expect((await statementIssueRef(db,f.identity).get()).get('status')).toBe('cancelled');
 });
 it('callable 실제 관리자 회사와 UID를 사용한다',async()=>{
  const call=cancelTradeStatementCommand as unknown as (request:unknown)=>Promise<unknown>;
  await expect(call({data:{}})).rejects.toMatchObject({code:'unauthenticated'});
  await expect(call({auth:{uid:actor,token:{companyId,isAdmin:false}},data:fixture().input})).rejects.toMatchObject({code:'permission-denied'});
 });
});
