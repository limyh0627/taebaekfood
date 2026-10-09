import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as admin from 'firebase-admin';
import {initializeApp,deleteApp,type FirebaseApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {issueNumberedVoucher,voucherSequenceKey} from './voucherIssue';
import {issueScheduledVoucher} from './autoVoucherCommand';
import {autoVoucherDraft} from './autoVoucherDraft';

const ready=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082'&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099';
describe.skipIf(!ready)('전표 번호: 두 인증 사용자와 예약 Functions 동시 생산',()=>{
 const prefix=`three-${randomUUID()}`,projectId='demo-taebaekfood-local',date='2030-01-09',ym='2030-01';
 const users:string[]=[],clients:FirebaseApp[]=[],paths=new Set<string>();
 const gatePath='appMeta/releaseCutover';
 let app:admin.app.App,db:admin.firestore.Firestore,priorGate:admin.firestore.DocumentData|undefined;
 const template={id:prefix,companyId:'taebaek' as const,name:'격리 시험 비용',amount:100,accountCode:'520',autoIssue:true,issueDay:9,partnerId:prefix,partnerName:'격리 거래처',dir:'줄돈',taxExempt:true};
 const scheduled=autoVoucherDraft(template,ym,date).draft!;
 const issued={...scheduled,operationId:`${prefix}-issued`,releaseId:prefix,document:{...scheduled.document,id:`${prefix}-issued`,orderId:`${prefix}-issued`,docNo:'무시할 미리보기'}};
 const cash={operationId:`${prefix}-cash`,kind:'cashEntries',tradeDate:date,releaseId:prefix,document:{companyId:'taebaek',date,dir:'출금',amount:100,accountCode:'520',note:'격리 자금 전표'}};
 beforeAll(async()=>{
  app=admin.initializeApp({projectId});db=app.firestore();priorGate=(await db.doc(gatePath).get()).data();
  await db.doc(gatePath).set({status:'active',releaseId:prefix,oldWritersBlocked:true,oldWritersBlockedEvidence:'isolated emulator rules verified',voucherNotBefore:{taebaek:date,punghoe:date}});
  for(const [path,row] of [[`partners/${prefix}`,{companyId:'taebaek',name:template.partnerName}],[`accountCodes/${prefix}`,{companyId:'taebaek',code:'520',name:'격리 비용'}]] as const){paths.add(path);await db.doc(path).create(row);}
  for(const path of [`issuedStatements/${issued.operationId}`,`cashEntries/${cash.operationId}`,`issuedStatements/${scheduled.operationId}`,`appMeta/${voucherSequenceKey('taebaek',date)}`]){
   if((await db.doc(path).get()).exists)throw Error('격리 시험 문서가 이미 존재합니다.');
   paths.add(path);
  }
 },90000);
 afterAll(async()=>{
  if(!app)return;
  for(const path of paths)await db.doc(path).delete();
  if(priorGate===undefined)await db.doc(gatePath).delete();else await db.doc(gatePath).set(priorGate);
  for(const uid of users)await app.auth().deleteUser(uid);
  for(const client of clients)await deleteApp(client);
  await app.delete();
 },90000);
 async function actor(){
  const uid=`${prefix}-${randomUUID()}`,employeeId=`employee-${uid}`,email=`${uid}@example.invalid`;
  await app.auth().createUser({uid,email,password:'emulator-only-123'});users.push(uid);
  await app.auth().setCustomUserClaims(uid,{employeeId,companyId:'taebaek',isAdmin:true});
  const client=initializeApp({projectId,apiKey:'emulator-only'},uid);clients.push(client);
  const auth=getAuth(client);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  const signed=await signInWithEmailAndPassword(auth,email,'emulator-only-123');
  const token=await app.auth().verifyIdToken(await signed.user.getIdToken(true));
  expect(token.uid).not.toBe(employeeId);return{uid:token.uid,token};
 }
 it('공개 명령 두 사용자와 실제 예약 발행 본문은 같은 통의 서로 다른 세 번호를 받고 재시도는 추가 소비하지 않는다',async()=>{
  const [a,b]=await Promise.all([actor(),actor()]);
  expect(a.uid).not.toBe(b.uid);
  const [issuedRun,cashRun,scheduledRun]=await Promise.allSettled([
   issueNumberedVoucher.run({auth:a,data:issued} as any),
   issueNumberedVoucher.run({auth:b,data:cash} as any),
   issueScheduledVoucher(db,template,ym,date,prefix),
  ]);
  if(issuedRun.status==='rejected')throw issuedRun.reason;
  if(cashRun.status==='rejected')throw cashRun.reason;
  if(scheduledRun.status==='rejected')throw scheduledRun.reason;
  const results=[issuedRun.value,cashRun.value,scheduledRun.value] as const;
  const scheduledResult=results[2];expect('result' in scheduledResult).toBe(true);
  const numbers=[results[0].docNo,results[1].docNo,'result' in scheduledResult?scheduledResult.result.docNo:''];
  expect(numbers.sort()).toEqual(['300109-001','300109-002','300109-003']);
  const counter=db.doc(`appMeta/${voucherSequenceKey('taebaek',date)}`);
  expect((await counter.get()).data()?.last).toBe(3);
  const before=await Promise.all([...paths].map(path=>db.doc(path).get()));
  const [issuedReplay,cashReplay,scheduledReplay]=await Promise.allSettled([issueNumberedVoucher.run({auth:a,data:issued} as any),issueNumberedVoucher.run({auth:b,data:cash} as any),issueScheduledVoucher(db,template,ym,date,prefix)]);
  if(issuedReplay.status==='rejected')throw issuedReplay.reason;
  if(cashReplay.status==='rejected')throw cashReplay.reason;
  if(scheduledReplay.status==='rejected')throw scheduledReplay.reason;
  const retried=[issuedReplay.value,cashReplay.value,scheduledReplay.value] as const;
  expect([retried[0].docNo,retried[1].docNo,'result' in retried[2]?retried[2].result.docNo:''].sort()).toEqual(numbers);
  expect((await Promise.all([...paths].map(path=>db.doc(path).get()))).map(row=>row.data())).toEqual(before.map(row=>row.data()));
 },90000);
});
