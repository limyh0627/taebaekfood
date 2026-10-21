import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {initializeApp as initializeClientApp,deleteApp as deleteClientApp,type FirebaseApp} from 'firebase/app';
import {getAuth as clientAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {executeFinancialOpeningForActor,type FinancialOpeningInput} from './financialOpeningCommand';
import {writeFileSync} from 'node:fs';
const project=process.env.FINANCIAL_OPENING_TEST_PROJECT??'demo-taebaekfood-local',runId=`financial-auth-${crypto.randomUUID()}`;
const clients:FirebaseApp[]=[],users:string[]=[],ownedPaths=new Set<string>();
const fixedPaths=['appMeta/releaseCutover','openingBalances/main-punghoe'] as const;
const original=new Map<string,FirebaseFirestore.DocumentData|undefined>();
const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const ready=project.startsWith('demo-')&&['127.0.0.1:8082','127.0.0.1:8182'].includes(firestoreHost??'')&&['127.0.0.1:9099','127.0.0.1:9199'].includes(authHost??'');
let app:App;
describe.skipIf(!ready)('금융 기초 실제 Auth와 Admin transaction',()=>{
 beforeAll(async()=>{app=initializeApp({projectId:project},runId);const db=getFirestore(app);for(const path of fixedPaths)original.set(path,(await db.doc(path).get()).data());writeFileSync(`work/financial-opening-receipt-A-${runId}-fixture-backup.json`,JSON.stringify({project,paths:fixedPaths.map(path=>({path,exists:original.get(path)!==undefined,data:original.get(path)??null}))},null,2));await db.doc(fixedPaths[0]).set({status:'active',releaseId:runId});await db.doc(fixedPaths[1]).set({companyId:'punghoe',date:'2026-07-31',amounts:{}});},90000);
 afterAll(async()=>{
  if(!app)return;const db=getFirestore(app);
  for(const path of ownedPaths)await db.doc(path).delete();
  for(const path of fixedPaths){if(!original.has(path))continue;const row=original.get(path);if(row===undefined)await db.doc(path).delete();else await db.doc(path).set(row);}
  for(const uid of users)await getAuth(app).deleteUser(uid);
  const ownRemoved=(await Promise.all([...ownedPaths].map(path=>db.doc(path).get()))).every(row=>!row.exists);
  const fixedRestored=(await Promise.all(fixedPaths.map(async path=>JSON.stringify((await db.doc(path).get()).data())===JSON.stringify(original.get(path))))).every(Boolean);
  const usersRemoved=(await getAuth(app).getUsers(users.map(uid=>({uid})))).users.length===0;
  writeFileSync(`work/financial-opening-receipt-A-${runId}-fixture-cleanup.json`,JSON.stringify({project,ownPaths:ownedPaths.size,ownRemoved,fixedRestored,users:users.length,usersRemoved},null,2));
  expect(ownRemoved&&fixedRestored&&usersRemoved).toBe(true);
  for(const client of clients)await deleteClientApp(client);await deleteApp(app);
 },90000);
 async function actor(companyId:string,isAdmin:boolean){const uid=`${runId}-${users.length}`,employeeId=`employee-${uid}`,email=`${uid}@local.invalid`;await getAuth(app).createUser({uid,email,password:'emulator-only-123'});users.push(uid);await getAuth(app).setCustomUserClaims(uid,{companyId,isAdmin,employeeId});const client=initializeClientApp({apiKey:'demo-key',projectId:project},uid);clients.push(client);const auth=clientAuth(client);connectAuthEmulator(auth,`http://${authHost}`,{disableWarnings:true});const signed=await signInWithEmailAndPassword(auth,email,'emulator-only-123');const token=await getAuth(app).verifyIdToken(await signed.user.getIdToken(true));expect(token.uid).not.toBe(token.employeeId);return {uid:token.uid,token};}
 const input=():FinancialOpeningInput=>{const id=`${runId}-${crypto.randomUUID()}`,operationId=`${runId}-${crypto.randomUUID()}`;ownedPaths.add(`loanContracts/${id}`);ownedPaths.add(`issuedStatements/opening-loan-punghoe-${id}`);ownedPaths.add(`financialOpeningOperations/${operationId}`);return {kind:'loan-create',companyId:'punghoe',operationId,releaseId:runId,loan:{id,companyId:'punghoe',name:'시험',lenderName:'은행',accountCode:'293',openingDate:'2026-07-31',openingPrincipal:1000,createdAt:'2026-07-31'}};};
 it('실제 관리자 claim 원문을 원자 저장하고 응답유실 동일요청은 번호·금융문서 추가0',async()=>{const auth=await actor('punghoe',true),body=input(),db=getFirestore(app);const countersBefore=(await db.collection('voucherSeq').get()).docs.map(row=>({id:row.id,data:row.data()}));expect(await executeFinancialOpeningForActor(db,auth,body)).toBe('created');const paths=[...ownedPaths],before=await Promise.all(paths.map(path=>db.doc(path).get()));expect(await executeFinancialOpeningForActor(db,auth,body)).toBe('created');const after=await Promise.all(paths.map(path=>db.doc(path).get()));expect(after.map(s=>s.data())).toEqual(before.map(s=>s.data()));expect((await db.collection('voucherSeq').get()).docs.map(row=>({id:row.id,data:row.data()}))).toEqual(countersBefore);if(body.kind==='loan-create')expect((await db.doc(`issuedStatements/opening-loan-punghoe-${body.loan.id}`).get()).data()?.docNo).toBe(`기초대출-${body.loan.id}`);},90000);
 it('실제 직원·다른회사·미인증은 금융문서와 성공감사 쓰기0',async()=>{const db=getFirestore(app);for(const auth of [await actor('punghoe',false),await actor('taebaek',true),undefined]){const body=input();await expect(executeFinancialOpeningForActor(db,auth,body)).rejects.toThrow();expect((await db.doc(`financialOpeningOperations/${body.operationId}`).get()).exists).toBe(false);if(body.kind==='loan-create'){expect((await db.doc(`loanContracts/${body.loan.id}`).get()).exists).toBe(false);expect((await db.doc(`issuedStatements/opening-loan-punghoe-${body.loan.id}`).get()).exists).toBe(false);}}},90000);
 const reference=(body:FinancialOpeningInput)=>({companyId:body.companyId,operationId:body.operationId,kind:body.kind});
 it('본문 없는 부재 조회는 서버 문서 생성 없이 unknown이다',async()=>{
  const who=await actor('punghoe',true),body=input(),db=getFirestore(app);
  expect(await executeFinancialOpeningForActor(db,who,{mode:'inspect',reference:reference(body)})).toMatchObject({status:'unknown',requestHash:null});
  expect((await db.doc(`financialOpeningOperations/${body.operationId}`).get()).exists).toBe(false);
 },90000);
 it('먼저 중단한 요청의 늦은 apply는 typed cancelled이고 금융 문서를 만들지 않는다',async()=>{
  const who=await actor('punghoe',true),body=input(),db=getFirestore(app);
  expect(await executeFinancialOpeningForActor(db,who,{mode:'cancel',reference:reference(body)})).toMatchObject({status:'cancelled'});
  await expect(executeFinancialOpeningForActor(db,who,body)).rejects.toMatchObject({details:{operationStatus:'cancelled',financialOpeningRecovery:{status:'cancelled',reference:reference(body)}}});
  if(body.kind==='loan-create')expect((await db.doc(`loanContracts/${body.loan.id}`).get()).exists).toBe(false);
 },90000);
 it('적용과 중단 경합은 같은 영수증으로 하나만 확정한다',async()=>{
  const who=await actor('punghoe',true),body=input(),db=getFirestore(app);
  const results=await Promise.allSettled([executeFinancialOpeningForActor(db,who,body),executeFinancialOpeningForActor(db,who,{mode:'cancel',reference:reference(body)})]);
  const receipt=(await db.doc(`financialOpeningOperations/${body.operationId}`).get()).data()!;
  expect(['applied','cancelled']).toContain(receipt.status);
  const cancel=results[1];expect(cancel.status).toBe('fulfilled');
  if(cancel.status==='fulfilled')expect(cancel.value).toMatchObject({status:receipt.status});
  if(body.kind==='loan-create')expect((await db.doc(`loanContracts/${body.loan.id}`).get()).exists).toBe(receipt.status==='applied');
  if(receipt.status==='cancelled')expect(results[0].status).toBe('rejected');else expect(results[0]).toMatchObject({status:'fulfilled',value:'created'});
 },90000);
 it('과거 적용은 gate교체·대상삭제 뒤에도 조회하고 재전송해도 재생성하지 않는다',async()=>{
  const who=await actor('punghoe',true),body=input(),db=getFirestore(app);
  await executeFinancialOpeningForActor(db,who,body);
  if(body.kind!=='loan-create')throw Error('fixture');
  await db.doc(`loanContracts/${body.loan.id}`).delete();await db.doc(`issuedStatements/opening-loan-punghoe-${body.loan.id}`).delete();
  await db.doc('appMeta/releaseCutover').set({status:'closed',releaseId:'changed'});
  try{
   expect(await executeFinancialOpeningForActor(db,who,{mode:'inspect',reference:reference(body)})).toMatchObject({status:'applied',result:'created'});
   expect(await executeFinancialOpeningForActor(db,who,{mode:'cancel',reference:reference(body)})).toMatchObject({status:'applied'});
   expect(await executeFinancialOpeningForActor(db,who,body)).toBe('created');
   expect((await db.doc(`loanContracts/${body.loan.id}`).get()).exists).toBe(false);
   const fresh=input();await expect(executeFinancialOpeningForActor(db,who,fresh)).rejects.toThrow();
   expect((await db.doc(`financialOpeningOperations/${fresh.operationId}`).get()).exists).toBe(false);
  }finally{await db.doc('appMeta/releaseCutover').set({status:'active',releaseId:runId});}
 },90000);
 it('타회사·다른UID·업무종류충돌과 손상 영수증은 상태 노출·덮기 없이 거절한다',async()=>{
  const who=await actor('punghoe',true),other=await actor('punghoe',true),foreign=await actor('taebaek',true),body=input(),db=getFirestore(app),ref=reference(body);
  await executeFinancialOpeningForActor(db,who,body);
  for(const [scope,selected] of [[other,ref],[foreign,ref],[who,{...ref,kind:'account-create' as const}] ] as const){
   await expect(executeFinancialOpeningForActor(db,scope,{mode:'inspect',reference:selected})).rejects.toThrow();
   await expect(executeFinancialOpeningForActor(db,scope,{mode:'cancel',reference:selected})).rejects.toThrow();
  }
  const op=db.doc(`financialOpeningOperations/${body.operationId}`);await op.update({requestHash:null});
  const before=(await op.get()).data();await expect(executeFinancialOpeningForActor(db,who,{mode:'cancel',reference:ref})).rejects.toThrow('손상');expect((await op.get()).data()).toEqual(before);
 },90000);
 it('실제 backend 두번째 영수증 쓰기가 실패하면 앞 금융 쓰기도 원자 rollback한다',async()=>{
  const who=await actor('punghoe',true),body=input(),db=getFirestore(app);
  const wrapped={collection:db.collection.bind(db),runTransaction:<T>(run:(tx:FirebaseFirestore.Transaction)=>Promise<T>)=>db.runTransaction(tx=>{
   const proxy=new Proxy(tx,{get(target,key){if(key==='create')return(ref:FirebaseFirestore.DocumentReference,value:FirebaseFirestore.DocumentData)=>ref.path.startsWith('financialOpeningOperations/')?target.update(ref,value):target.create(ref,value);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
   return run(proxy);
  })} as unknown as FirebaseFirestore.Firestore;
  await expect(executeFinancialOpeningForActor(wrapped,who,body)).rejects.toThrow();
  expect((await db.doc(`financialOpeningOperations/${body.operationId}`).get()).exists).toBe(false);
  if(body.kind==='loan-create'){expect((await db.doc(`loanContracts/${body.loan.id}`).get()).exists).toBe(false);expect((await db.doc(`issuedStatements/opening-loan-punghoe-${body.loan.id}`).get()).exists).toBe(false);}
 },90000);
});
