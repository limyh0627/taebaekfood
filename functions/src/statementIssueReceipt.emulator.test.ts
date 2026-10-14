import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{constructor(public code:string,message:string,public details?:unknown){super(message);}},onCall:(_options:unknown,handler:unknown)=>handler}));
import {HttpsError} from 'firebase-functions/v2/https';
import {statementIssueIdentity,statementIssueRef,prepareStatementIssue,rejectStatementIssue,statementIssueTextHash,STATEMENT_ISSUE_FENCE_GENERATION,STATEMENT_ISSUE_FENCE_WRITERS} from './statementIssueReceipt';
import {issueTradeStatement} from './tradeStatementIssue';
import {issueVoucher} from './voucherIssue';
const available=/^(127\.0\.0\.1|localhost):8082$/.test(process.env.FIRESTORE_EMULATOR_HOST??'');
let app:admin.app.App,db:admin.firestore.Firestore;
const date='2026-10-13',releaseId='receipt-test';
let statementNumber=Date.now();
const request=(id='stmt-'+(++statementNumber))=>({operationId:`${id}:ISSUE`,releaseId,statement:{id,companyId:'taebaek',type:'매출',partnerId:'p',partnerName:'합성 거래처',tradeDate:date,orderId:'',docNo:'preview',issuedAt:'',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'품목',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'800'}]},orderIds:[] as string[],poIds:[] as string[],costUpdates:[]});
const gate=()=>({status:'active',releaseId,voucherNotBefore:{taebaek:date},oldWritersBlocked:true,oldWritersBlockedEvidence:'실제 로컬 SDK 합성 봉쇄',statementIssueProtocol:{version:1,status:'active',generation:STATEMENT_ISSUE_FENCE_GENERATION,releaseId,oldServerDrained:true,oldServerDrainConfirmedAt:'2026-01-01T00:00:02.000Z',writerEvidence:Object.fromEntries(STATEMENT_ISSUE_FENCE_WRITERS.map(name=>[name,{generation:STATEMENT_ISSUE_FENCE_GENERATION,deployedAt:'2026-01-01T00:00:00.000Z',oldRevisionDrainedAt:'2026-01-01T00:00:01.000Z',evidence:'실제 로컬 SDK 합성 revision 종료 근거'}]))}});
const issue=(input:ReturnType<typeof request>)=>issueTradeStatement(db,'taebaek','actor',input);
describe.skipIf(!available)('전표 저장 전 거절 실제 Admin SDK 영수증',()=>{
 beforeAll(()=>{app=admin.initializeApp({projectId:'demo-stmt-'+randomUUID().slice(0,8)},'stmt-'+randomUUID());db=admin.firestore(app);});
 beforeEach(async()=>{await db.doc('appMeta/releaseCutover').set(gate());await db.doc('partners/p').set({companyId:'taebaek'});await db.doc('accountCodes/sale').set({companyId:'taebaek',code:'800'});await db.doc(`appMeta/voucherNo_taebaek_${date}_general`).set({companyId:'taebaek',tradeDate:date,prefix:'',last:0});});
 afterAll(async()=>{for(const collection of ['appMeta','partners','accountCodes','issuedStatements','cashEntries','statementIssueOperations','voucherMutationOperations','settlements','orders','purchaseOrders']){const docs=await db.collection(collection).get();await Promise.all(docs.docs.map(doc=>doc.ref.delete()));expect((await db.collection(collection).get()).empty).toBe(true);}await app.delete();});
 it('최초 원문 actor 회사 hash를 고정하고 다른 원문·actor는 원본을 보존한다',async()=>{
  const input=request(),text=JSON.stringify(input,null,2),identity=statementIssueIdentity('taebaek','actor',{...input,requestText:text});
  await prepareStatementIssue(db,identity);const before=await statementIssueRef(db,identity).get();expect(before.data()).toMatchObject({status:'prepared',revision:0,requestText:text,requestHash:statementIssueTextHash(text)});
  await expect(prepareStatementIssue(db,{...identity,actorId:'other'})).rejects.toThrow('원문');
  await expect(prepareStatementIssue(db,{...identity,requestText:JSON.stringify(input)})).rejects.toThrow('원문');
  expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  expect(()=>statementIssueIdentity('taebaek','actor',{...input,requestText:JSON.stringify({...input,orderIds:['other']})})).toThrow('원문');
 });
 it('다른 회사가 같은 ID를 선점했으면 새 prepare도 반대 회사 취소도 허용하지 않는다',async()=>{
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);
  await prepareStatementIssue(db,identity);
  const other={...identity,companyId:'punghoe'};
  await expect(prepareStatementIssue(db,other)).rejects.toThrow('다른 회사');
  expect((await statementIssueRef(db,other).get()).exists).toBe(false);
 });
 it('저장 전 확정 거절은 원문 증거를 주고 같은 요청을 영구 봉쇄한다',async()=>{
  const input=request();input.statement.items[0].qty=0;const identity=statementIssueIdentity('taebaek','actor',input);
  await expect(issue(input)).rejects.toMatchObject({details:{...identity,version:2,operationStatus:'rejected',financialWrites:false,receiptRevision:1}});
  const before=await statementIssueRef(db,identity).get();expect(before.get('status')).toBe('rejected');
  await expect(issue(input)).rejects.toMatchObject({details:{receiptRevision:1}});expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  expect((await db.doc('issuedStatements/'+input.statement.id).get()).exists).toBe(false);
  const changed=request(input.statement.id);await expect(issue(changed)).rejects.toThrow('원문');
 });
 it.each(['OEMFEE-po-1','advance-1','return-1','opening-inventory-taebaek-1','stmt-1','stmt-12345678901234'])('전용·구형ID %s는 발행 허용과 무반영 증명 범위를 구분한다',async id=>{
  const input=request(id),identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  expect(await rejectStatementIssue(db,identity,new HttpsError('failed-precondition','확정거절'))).toBeNull();expect((await statementIssueRef(db,identity).get()).get('status')).toBe('prepared');
  expect((await issue(input)).status).toBe('applied');
 });
 it.each(['old-server','sdk','future','missing','native'])('%s는 조회0이어도 prepared와 원문을 보존한다',async kind=>{
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  if(kind==='old-server')await db.doc('appMeta/releaseCutover').update({'statementIssueProtocol.oldServerDrained':false});
  if(kind==='sdk')await db.doc('appMeta/releaseCutover').update({oldWritersBlocked:false});
  if(kind==='future')await db.doc('appMeta/releaseCutover').update({'statementIssueProtocol.oldServerDrainConfirmedAt':'2999-01-01T00:00:00.000Z'});
  if(kind==='missing')await db.doc('appMeta/releaseCutover').set({status:'active',oldWritersBlocked:true,oldWritersBlockedEvidence:'SDK만 확인'});
  expect(await rejectStatementIssue(db,identity,kind==='native'?new Error('응답유실'):new HttpsError('failed-precondition','업무거절'))).toBeNull();expect((await statementIssueRef(db,identity).get()).get('status')).toBe('prepared');
 });
 it.each(['generation','release','deploy-after-drain','drain-after-confirm','invalid-time','future-confirm','empty-evidence',...STATEMENT_ISSUE_FENCE_WRITERS.map(name=>'missing-'+name)])('%s 증거 불일치는 none만 막고 정상 발행에는 영향을 주지 않는다',async mode=>{
  const configured=gate(),protocol:Record<string,any>=configured.statementIssueProtocol,first=STATEMENT_ISSUE_FENCE_WRITERS[0];
  if(mode==='generation')protocol.generation='과거-fence';if(mode==='release')protocol.releaseId='과거-release';
  if(mode==='deploy-after-drain')protocol.writerEvidence[first].deployedAt='2026-01-01T00:00:02.000Z';
  if(mode==='drain-after-confirm')protocol.writerEvidence[first].oldRevisionDrainedAt='2026-01-01T00:00:03.000Z';
  if(mode==='invalid-time')protocol.writerEvidence[first].deployedAt='2026-02-30T00:00:00.000Z';
  if(mode==='future-confirm')protocol.oldServerDrainConfirmedAt='2999-01-01T00:00:00.000Z';
  if(mode==='empty-evidence')protocol.writerEvidence[first].evidence=' ';
  if(mode.startsWith('missing-'))delete protocol.writerEvidence[mode.slice(8)];
  await db.doc('appMeta/releaseCutover').set(configured);
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  expect(await rejectStatementIssue(db,identity,new HttpsError('failed-precondition','확정거절'))).toBeNull();expect((await statementIssueRef(db,identity).get()).get('status')).toBe('prepared');
  expect((await issue(input)).status).toBe('applied');
 });
 it.each(['generation','release','gate-release'])('rejected의 %s 사슬이 달라지면 새 none 증명을 발급하지 않는다',async mode=>{
  const input=request();input.statement.items[0].qty=0;
  const captured=statementIssueIdentity('taebaek','actor',input);await expect(issue(input)).rejects.toMatchObject({details:{drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:releaseId}});
  const ref=statementIssueRef(db,captured);if(mode==='generation')await ref.update({drainGeneration:'old'});if(mode==='release')await ref.update({drainReleaseId:'old'});
  if(mode==='gate-release')await db.doc('appMeta/releaseCutover').update({releaseId:'new','statementIssueProtocol.releaseId':'new'});
  expect(await rejectStatementIssue(db,captured,new HttpsError('failed-precondition','확정거절'))).toBeNull();expect((await ref.get()).get('status')).toBe('rejected');
 });
 it.each(STATEMENT_ISSUE_FENCE_WRITERS)('%s 배포의 source generation이 다르면 종료 boolean만으로 증명하지 않는다',async name=>{
  const configured=gate();configured.statementIssueProtocol.writerEvidence[name].generation='과거-source';await db.doc('appMeta/releaseCutover').set(configured);
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  expect(await rejectStatementIssue(db,identity,new HttpsError('failed-precondition','확정거절'))).toBeNull();expect((await statementIssueRef(db,identity).get()).get('status')).toBe('prepared');
 });
 it.each([
  ['issuedStatements','id'],['cashEntries','id'],['voucherMutationOperations','statementId'],['voucherMutationOperations','statementIds'],
  ['voucherMutationOperations','cashEntryId'],['voucherMutationOperations','cashEntryIds'],['settlements','statementId'],['settlements','cashEntryId'],
  ['orders','linkedStatementId'],['purchaseOrders','linkedStatementId'],
 ])('%s/%s 근거가 있으면 조회0 또는 업무거절로 해제하지 않는다',async(collection,field)=>{
  const input=request(),id=input.statement.id,identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  const ref=db.collection(collection).doc(field==='id'?id:randomUUID());await ref.set({companyId:'taebaek',...(field==='id'?{}:{[field]:field.endsWith('Ids')?[id]:id})});
  expect(await rejectStatementIssue(db,identity,new HttpsError('invalid-argument','업무거절'))).toBeNull();expect((await statementIssueRef(db,identity).get()).get('status')).toBe('prepared');await ref.delete();
 });
 it('발행과 영수증 applied를 같은 TX로 저장하고 삭제된 완료 원문을 재생성하지 않는다',async()=>{
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);const result=await issue(input);
  expect((await statementIssueRef(db,identity).get()).data()).toMatchObject({status:'applied',docNo:result.docNo,revision:1});expect(await issue(input)).toEqual({...result,status:'duplicate'});
  await db.doc('issuedStatements/'+input.statement.id).delete();await expect(issue(input)).rejects.toThrow('완료 전표');expect((await db.doc('issuedStatements/'+input.statement.id).get()).exists).toBe(false);
  expect(await rejectStatementIssue(db,identity,new HttpsError('failed-precondition','완료 후 오류'))).toBeNull();
 });
 it('동시 발행·거절은 동일 영수증을 경쟁하고 둘 다 확정하지 않는다',async()=>{
  const input=request(),identity=statementIssueIdentity('taebaek','actor',input);await prepareStatementIssue(db,identity);
  const [issued,rejected]=await Promise.allSettled([issue(input),rejectStatementIssue(db,identity,new HttpsError('failed-precondition','경합 거절'))]);
  const row=(await statementIssueRef(db,identity).get()).data()!,exists=(await db.doc('issuedStatements/'+input.statement.id).get()).exists;
  if(row.status==='applied'){expect(exists).toBe(true);expect(issued.status).toBe('fulfilled');expect(rejected).toMatchObject({status:'fulfilled',value:null});}
  else{expect(row.status).toBe('rejected');expect(exists).toBe(false);expect(issued.status).toBe('rejected');expect(rejected.status).toBe('fulfilled');}
 },20000);
 it.each(['cashEntries','issuedStatements'] as const)('generic %s와 최초 capture 경합은 claim TX read로 늦은 새 writer를 봉쇄한다',async kind=>{
  const input=request(),id=input.statement.id,identity=statementIssueIdentity('taebaek','actor',input);
  const generic={kind,operationId:id,tradeDate:date,releaseId,document:kind==='cashEntries'?{date,amount:100}:{tradeDate:date,totalSupply:100,totalTax:0,totalAmount:100}};
  const [captured,issued]=await Promise.allSettled([prepareStatementIssue(db,identity),issueVoucher(db,'taebaek',generic)]);
  expect(captured.status).toBe('fulfilled');const exists=(await db.collection(kind).doc(id).get()).exists;
  const none=await rejectStatementIssue(db,identity,new HttpsError('failed-precondition','확정거절'));
  if(issued.status==='fulfilled'){expect(exists).toBe(true);expect(none).toBeNull();}
  else{expect(exists).toBe(false);expect(none).toMatchObject({operationStatus:'rejected'});}
  if(issued.status==='fulfilled')expect(await issueVoucher(db,'taebaek',generic)).toEqual(issued.value);
  else await expect(issueVoucher(db,'taebaek',generic)).rejects.toThrow('최초 요청');
 },20000);
});
