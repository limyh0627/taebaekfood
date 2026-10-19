import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{constructor(public code:string,message:string,public details?:unknown){super(message);}},onCall:(_options:unknown,handler:unknown)=>handler}));
import {preparePartnerAdvance,applyPartnerAdvance,cancelPartnerAdvance,applyPartnerAdvanceCommand,inspectPartnerAdvanceRecovery,stopPartnerAdvanceRecovery,listPartnerAdvanceRecoveryHistory} from './partnerAdvanceCommand';
import {genericVoucherBusiness,semanticHash,statementBusiness} from './shared/partnerAdvanceReceipt';
import {cashOriginalHash} from './cashMutationReceipt';
const available=['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
const prefix=`advance-${randomUUID()}`;let app:admin.app.App,db:admin.firestore.Firestore;
const ref=(collection:string,id:string)=>db.collection(collection).doc(id);
const actor=`${prefix}-actor`,releaseId=prefix;
const globals=['releaseCutover','partnerPaymentCutover_taebaek','partnerPaymentCutover_punghoe','partnerAdvanceCutover_taebaek','partnerAdvanceCutover_punghoe','voucherNo_taebaek_2026-10-08_대체','voucherNo_punghoe_2026-10-08_대체'];
const before=new Map<string,admin.firestore.DocumentData|undefined>();
async function fixture(label:string,companyId:'taebaek'|'punghoe'='taebaek'){
 const partnerId=`${prefix}-${label}`,cashId=`${partnerId}-cash`,targetId=`${partnerId}-target`;
 const cash={id:cashId,companyId,partnerId,date:'2026-10-07',dir:companyId==='taebaek'?'출금':'입금',amount:100,accountCode:companyId==='taebaek'?'133':'254',lines:[{accountCode:companyId==='taebaek'?'133':'254',amount:150},{accountCode:companyId==='taebaek'?'133':'254',amount:-50}],cashAccountId:'synthetic-bank',createdBy:actor,docNo:'261007-001',issuePrefix:'',issueOperationId:cashId};
 const statement={id:targetId,companyId,partnerId,type:companyId==='taebaek'?'매입':'매출',tradeDate:'2026-10-07',totalSupply:80,totalTax:0,totalAmount:80,items:[{accountCode:companyId==='taebaek'?'501':'800',name:'합성',spec:'',qty:1,price:80,supply:80,tax:0,total:80}],createdBy:actor,docNo:'261007-002',issuePrefix:'',issueOperationId:`${targetId}:ISSUE`};
 await Promise.all([ref('partners',partnerId).set({companyId,name:'시험 거래처'}),ref('cashEntries',cashId).set({...cash,issuePayloadHash:semanticHash(genericVoucherBusiness(cash))}),ref('issuedStatements',targetId).set({...statement,issueStatementHash:semanticHash(statementBusiness(statement))})]);
 const prepared=await preparePartnerAdvance(db,companyId,partnerId);
 const input={operationId:`${partnerId}-apply`,partnerId,date:'2026-10-08',source:{collection:'cashEntries' as const,id:cashId,lineKey:companyId==='taebaek'?'133':'254'},statementId:targetId,accountCode:companyId==='taebaek'?'251' as const:'108' as const,amount:60,expectedRevision:prepared.revision,releaseId,expectedSourceFingerprint:prepared.sources[0]?.fingerprint??'',expectedTargetFingerprint:prepared.targets[0]?.fingerprint??''};
 return {companyId,partnerId,cashId,targetId,prepared,input};
}
describe.skipIf(!available)('선급·선수 actual Admin SDK transaction',()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:`demo-recovery27-${randomUUID()}`},prefix);db=admin.firestore(app);for(const id of globals)before.set(id,(await ref('appMeta',id).get()).data());await ref('appMeta','releaseCutover').set({status:'active',releaseId,voucherNotBefore:{taebaek:'2026-10-03',punghoe:'2026-10-01'},oldWritersBlocked:true,oldWritersBlockedEvidence:'synthetic-test'});for(const companyId of ['taebaek','punghoe'])await Promise.all([ref('appMeta',`partnerPaymentCutover_${companyId}`).set({companyId,enabled:true,auditPassed:true,legacyWritersBlocked:true}),ref('appMeta',`partnerAdvanceCutover_${companyId}`).set({companyId,enabled:true,auditPassed:true}),ref('appMeta',`voucherNo_${companyId}_2026-10-08_대체`).set({companyId,tradeDate:'2026-10-08',prefix:'대체',last:100})]);},90000);
 afterAll(async()=>{if(!db)return;for(const collection of ['partners','cashEntries','issuedStatements','partnerAdvanceOperations','voucherMutationOperations','appMeta']){for(const doc of (await db.collection(collection).get()).docs)if(doc.id.includes(prefix))await doc.ref.delete();expect((await db.collection(collection).get()).docs.filter(doc=>doc.id.includes(prefix))).toHaveLength(0);}for(const [id,row]of before)row?await ref('appMeta',id).set(row):await ref('appMeta',id).delete();await app.delete();},90000);
 it('차대 순액 원천 단건 적용·취소·원 적용 재시도는 번호를 추가하지 않는다',async()=>{
  const f=await fixture('replay');expect(f.prepared.sources[0].originalAmount).toBe(100);expect(f.prepared.targets[0].remaining).toBe(80);
  const first=await applyPartnerAdvance(db,f.companyId,actor,f.input);const counter=(await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()?.last;
  expect((await applyPartnerAdvance(db,f.companyId,actor,f.input)).status).toBe('duplicate');expect((await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()?.last).toBe(counter);
  const prepared=await preparePartnerAdvance(db,f.companyId,f.partnerId);expect(prepared.sources[0].remaining).toBe(40);expect(prepared.targets[0].remaining).toBe(20);
  const cancel={operationId:`${f.partnerId}-cancel`,partnerId:f.partnerId,date:'2026-10-08',applicationStatementId:first.id,reason:'명시 취소',expectedRevision:1,releaseId};
  expect((await cancelPartnerAdvance(db,f.companyId,actor,cancel)).status).toBe('applied');expect((await cancelPartnerAdvance(db,f.companyId,actor,cancel)).status).toBe('duplicate');
  const cancelled=await preparePartnerAdvance(db,f.companyId,f.partnerId);expect(cancelled.sources[0].remaining).toBe(100);expect(cancelled.targets[0].remaining).toBe(80);expect(cancelled.applications).toHaveLength(0);
  const after=(await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()?.last;expect((await applyPartnerAdvance(db,f.companyId,actor,f.input)).status).toBe('duplicate');expect((await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()?.last).toBe(after);
  expect((await ref('cashEntries',f.cashId).get()).data()?.amount).toBe(100);expect((await ref('issuedStatements',f.targetId).get()).data()?.totalAmount).toBe(80);
 });
 it('동시 다른 요청은 partner revision으로 한건만 적용한다',async()=>{const f=await fixture('race');const results=await Promise.allSettled([applyPartnerAdvance(db,f.companyId,actor,f.input),applyPartnerAdvance(db,f.companyId,actor,{...f.input,operationId:`${f.partnerId}-other`})]);expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);expect((await ref('appMeta',`partnerPaymentState_taebaek_${f.partnerId}`).get()).data()?.revision).toBe(1);});
 it('초과/회사교차/원문변경은 금융·번호 쓰기0',async()=>{const f=await fixture('invalid');const beforeCounter=(await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data();await expect(applyPartnerAdvance(db,f.companyId,actor,{...f.input,amount:81})).rejects.toThrow();await expect(applyPartnerAdvance(db,'punghoe',actor,{...f.input,operationId:`${f.partnerId}-cross`})).rejects.toThrow();await ref('cashEntries',f.cashId).update({note:'변경'});await expect(applyPartnerAdvance(db,f.companyId,actor,{...f.input,operationId:`${f.partnerId}-changed`})).rejects.toThrow();expect((await ref('partnerAdvanceOperations',f.input.operationId).get()).data()?.status).toBe('rejected');expect((await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()).toEqual(beforeCounter);});
 it('선택 원천보다 앞선 감소는 신규원천을 소비하지 않고 같은날 감소는 개별보류한다',async()=>{const f=await fixture('historic');const reduction=`${f.partnerId}-old`;await ref('cashEntries',reduction).set({companyId:f.companyId,dir:'입금',amount:10,accountCode:'133',date:'2026-10-06'});const valid=await preparePartnerAdvance(db,f.companyId,f.partnerId);expect(valid.sources).toHaveLength(1);await ref('cashEntries',reduction).update({date:'2026-10-07'});const held=await preparePartnerAdvance(db,f.companyId,f.partnerId);expect(held.enabled).toBe(true);expect(held.sources).toHaveLength(0);expect(held.diagnostics.length).toBeGreaterThan(0);await ref('cashEntries',reduction).delete();});
 it('합법 수정 현금의 생성 감사 사슬을 읽고 현재 원천액으로 적용한다',async()=>{const f=await fixture('mutation');const original=(await ref('cashEntries',f.cashId).get()).data()!;const after={...original,note:'합법 수정',mutationRevision:1};await Promise.all([ref('cashEntries',f.cashId).set(after),ref('voucherMutationOperations',`${f.partnerId}-edit`).set({kind:'cashEntries',status:'applied',action:'edit',createdBy:actor,companyId:f.companyId,voucherId:f.cashId,cashEntryIds:[f.cashId],expectedRevision:0,beforeSnapshot:original,beforeHash:cashOriginalHash(original),afterHash:cashOriginalHash(after)})]);const prepared=await preparePartnerAdvance(db,f.companyId,f.partnerId);expect(prepared.sources).toHaveLength(1);await expect(applyPartnerAdvance(db,f.companyId,actor,{...f.input,expectedSourceFingerprint:prepared.sources[0].fingerprint})).resolves.toMatchObject({status:'applied'});});
 it('풍회 선수254는 매출108을 줄이고 타회사 자료는 변경하지 않는다',async()=>{const f=await fixture('punghoe','punghoe');expect(f.prepared.sources[0].code).toBe('254');await expect(applyPartnerAdvance(db,'punghoe',actor,{...f.input,operationId:`${f.partnerId}-cross`})).resolves.toMatchObject({status:'applied'});expect((await preparePartnerAdvance(db,'punghoe',f.partnerId)).targets[0].remaining).toBe(20);});
 it('disabled gate와 직원 callable은 쓰기를 시작하지 않는다',async()=>{const f=await fixture('gate');await ref('appMeta','partnerAdvanceCutover_taebaek').update({enabled:false});try{await expect(applyPartnerAdvance(db,'taebaek',actor,f.input)).rejects.toThrow('활성화');expect((await preparePartnerAdvance(db,'taebaek',f.partnerId)).enabled).toBe(false);expect((await ref('partnerAdvanceOperations',f.input.operationId).get()).data()?.status).toBe('rejected');await expect((applyPartnerAdvanceCommand as any)({auth:{uid:actor,token:{companyId:'taebaek',isAdmin:false}},data:f.input})).rejects.toThrow('관리자');}finally{await ref('appMeta','partnerAdvanceCutover_taebaek').update({enabled:true});}});
 it('확정 사전 거절은 원문 감사로 재시도하며 금융·번호는 쓰지 않는다',async()=>{const f=await fixture('rejected');const input={...f.input,amount:81};const counter=(await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data();let first:any;try{await applyPartnerAdvance(db,f.companyId,actor,input);}catch(error){first=error;}expect(first.details.partnerAdvanceFailure).toMatchObject({version:1,companyId:f.companyId,partnerId:f.partnerId,actorId:actor,operationId:input.operationId,operationRejected:true,financialWrites:false,command:input});expect((await ref('partnerAdvanceOperations',input.operationId).get()).data()).toMatchObject({status:'rejected',command:input});await expect(applyPartnerAdvance(db,f.companyId,actor,input)).rejects.toThrow();await expect(applyPartnerAdvance(db,f.companyId,actor,{...input,amount:60})).rejects.toThrow('이전 요청');expect((await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()).toEqual(counter);expect((await ref('appMeta',`partnerPaymentState_taebaek_${f.partnerId}`).get()).exists).toBe(false);expect((await ref('issuedStatements',`advance-${input.operationId}`).get()).exists).toBe(false);});

 it('ACK 유실 뒤 readonly 조회와 완료 요청 중단은 금융·번호·revision을 바꾸지 않는다',async()=>{
  const f=await fixture('recovery-complete');const applied=await applyPartnerAdvance(db,f.companyId,actor,f.input);
  const reference={companyId:f.companyId,partnerId:f.partnerId,operationId:f.input.operationId};
  const paths=[ref('partnerAdvanceOperations',f.input.operationId),ref('issuedStatements',applied.id),ref('appMeta',`partnerPaymentState_taebaek_${f.partnerId}`),ref('appMeta','voucherNo_taebaek_2026-10-08_대체')];
  const before=await Promise.all(paths.map(async path=>(await path.get()).data()));
  await ref('appMeta','partnerAdvanceCutover_taebaek').update({enabled:false});
  try{expect(await inspectPartnerAdvanceRecovery(db,reference,actor)).toMatchObject({status:'applied',statementId:applied.id,amount:60,action:'apply'});expect(await stopPartnerAdvanceRecovery(db,reference,actor)).toMatchObject({status:'applied'});}finally{await ref('appMeta','partnerAdvanceCutover_taebaek').update({enabled:true});}
  expect(await Promise.all(paths.map(async path=>(await path.get()).data()))).toEqual(before);
 });
 it('부재 조회는 쓰지 않고 미처리 중단은 늦은 apply를 같은 영수증으로 막는다',async()=>{
  const f=await fixture('stop');const reference={companyId:f.companyId,partnerId:f.partnerId,operationId:f.input.operationId};
  expect(await inspectPartnerAdvanceRecovery(db,reference,actor)).toMatchObject({status:'unknown',requestHash:null});expect((await ref('partnerAdvanceOperations',f.input.operationId).get()).exists).toBe(false);
  const counter=(await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data();
  expect(await stopPartnerAdvanceRecovery(db,reference,actor)).toMatchObject({status:'cancelled'});
  await expect(applyPartnerAdvance(db,f.companyId,actor,f.input)).rejects.toThrow('중단');
  expect((await ref('issuedStatements',`advance-${f.input.operationId}`).get()).exists).toBe(false);expect((await ref('appMeta','voucherNo_taebaek_2026-10-08_대체').get()).data()).toEqual(counter);
 });
 it('stop과 apply 동시 경합은 완료 또는 미처리 중단 하나이며 역분개는 만들지 않는다',async()=>{
  const f=await fixture('stop-race');const reference={companyId:f.companyId,partnerId:f.partnerId,operationId:f.input.operationId};
  await Promise.allSettled([stopPartnerAdvanceRecovery(db,reference,actor),applyPartnerAdvance(db,f.companyId,actor,f.input)]);
  const result=await inspectPartnerAdvanceRecovery(db,reference,actor);expect(['applied','cancelled']).toContain(result.status);
  const statements=(await db.collection('issuedStatements').get()).docs.filter(doc=>doc.id===`advance-${f.input.operationId}`);expect(statements.length).toBe(result.status==='applied'?1:0);
 });
 it('다른 UID·회사·거래처 조회와 중단은 원문 상태를 노출하지 않는다',async()=>{
  const f=await fixture('private');await applyPartnerAdvance(db,f.companyId,actor,f.input);const reference={companyId:f.companyId,partnerId:f.partnerId,operationId:f.input.operationId};
  for(const other of [{reference,actor:'other'},{reference:{...reference,companyId:'punghoe'},actor},{reference:{...reference,partnerId:'other'},actor}]){await expect(inspectPartnerAdvanceRecovery(db,other.reference,other.actor)).rejects.toThrow('다른');await expect(stopPartnerAdvanceRecovery(db,other.reference,other.actor)).rejects.toThrow('다른');}
  expect((await listPartnerAdvanceRecoveryHistory(db,f.companyId,f.partnerId,'other')).entries).toHaveLength(0);
 });
 it('손상된 영수증과 연결 전표는 완료로 승격하지 않고 본인 이력만 메타로 반환한다',async()=>{
  const f=await fixture('damaged');await applyPartnerAdvance(db,f.companyId,actor,f.input);const reference={companyId:f.companyId,partnerId:f.partnerId,operationId:f.input.operationId};
  expect((await listPartnerAdvanceRecoveryHistory(db,f.companyId,f.partnerId,actor)).entries.find(row=>row.reference.operationId===f.input.operationId)).toMatchObject({status:'applied',amount:60});
  await ref('partnerAdvanceOperations',f.input.operationId).update({commandHash:'bad'});expect(await inspectPartnerAdvanceRecovery(db,reference,actor)).toMatchObject({status:'unknown',requestHash:null});
  expect(JSON.stringify(await listPartnerAdvanceRecoveryHistory(db,f.companyId,f.partnerId,actor))).not.toContain('expectedSourceFingerprint');  const rejected=await fixture('damaged-rejection');await expect(applyPartnerAdvance(db,rejected.companyId,actor,{...rejected.input,amount:81})).rejects.toThrow();
  await ref('partnerAdvanceOperations',rejected.input.operationId).update({commandHash:'bad'});
  expect(await inspectPartnerAdvanceRecovery(db,{companyId:rejected.companyId,partnerId:rejected.partnerId,operationId:rejected.input.operationId},actor)).toMatchObject({status:'unknown',requestHash:null});
 }); it('이력은 본인 UID 50건 빈 페이지 뒤 다음 항목을 찾고 페이지 범위 교체를 거절한다',async()=>{
  const pageActor=`${prefix}-page-actor`,partnerId=`${prefix}-page-partner`;
  const batch=db.batch();
  for(let i=0;i<51;i++){
   const operationId=`${prefix}-page-${String(i).padStart(3,'0')}`;
   batch.create(ref('partnerAdvanceOperations',operationId),{companyId:i===50?'taebaek':'punghoe',partnerId:i===50?partnerId:`${prefix}-other`,createdBy:pageActor,operationId,status:'cancelled',recoveryFence:true,requestHash:null});
  }
  const foreignId=`${prefix}-page-foreign`;
  batch.create(ref('partnerAdvanceOperations',foreignId),{companyId:'taebaek',partnerId,createdBy:`${prefix}-foreign`,operationId:foreignId,status:'cancelled',recoveryFence:true,requestHash:null});
  await batch.commit();
  const first=await listPartnerAdvanceRecoveryHistory(db,'taebaek',partnerId,pageActor);
  expect(first.entries).toHaveLength(0);expect(first.nextCursor).toBeTypeOf('string');expect(first.nextCursor).not.toContain(`${prefix}-page-049`);
  const second=await listPartnerAdvanceRecoveryHistory(db,'taebaek',partnerId,pageActor,first.nextCursor!);
  expect(second.entries).toHaveLength(1);expect(second.entries[0].reference.operationId).toBe(`${prefix}-page-050`);expect(second.nextCursor).toBeNull();
  for(const scope of [{companyId:'punghoe' as const,partnerId,actor:pageActor},{companyId:'taebaek' as const,partnerId:`${prefix}-other`,actor:pageActor},{companyId:'taebaek' as const,partnerId,actor:`${prefix}-foreign`}])
   await expect(listPartnerAdvanceRecoveryHistory(db,scope.companyId,scope.partnerId,scope.actor,first.nextCursor!)).rejects.toThrow('페이지');
 });});
