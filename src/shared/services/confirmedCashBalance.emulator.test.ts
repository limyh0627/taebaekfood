import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, doc, updateDoc } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { saveConfirmedCashBalance, saveConfirmedCashBalanceWithDb } from './confirmedCashBalance';
import type { CashAccount } from '../types';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));

describe.skipIf(process.env.CONFIRMED_BALANCE_EMULATOR_TEST!=='true')('확정 계좌 잔액 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='balance-sdk-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined;
 let adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let auth:Auth;
 const paths=new Set<string>(),uids=new Set<string>();
 const credentials=new Map<string,{email:string;password:string}>();
 const account:CashAccount={id:prefix+'-bank',companyId:'taebaek',name:'합성 계좌',type:'통장',openingDate:'2026-07-31',openingBalance:100,active:true,createdAt:'2026-07-31T00:00:00Z'};
 const accountPath=`cashAccounts/${account.id}`,cashPath=`cashEntries/${prefix}-cash`,statementPath=`issuedStatements/${prefix}-statement`;
 const foreign:CashAccount={...account,id:prefix+'-foreign',companyId:'punghoe'};
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw new Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw new Error('Auth 주소 불일치');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw new Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  for(const [role,companyId,isAdmin] of [['admin','taebaek',true],['staff','taebaek',false],['foreign','punghoe',true]] as const){
   const uid=prefix+'-'+role,email=uid+'@example.invalid',password=randomUUID()+'A1!';
   uids.add(uid);await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId,isAdmin});credentials.set(role,{email,password});
  }
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);
  auth=getAuth(app);gateway.auth=auth;connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  const {id:_id,...stored}=account;const {id:_foreignId,...storedForeign}=foreign;
  for(const [path,data] of [[accountPath,stored],[`cashAccounts/${foreign.id}`,storedForeign],[cashPath,{companyId:'taebaek',cashAccountId:account.id,dir:'출금',amount:10,date:'2026-08-01',createdAt:''}],[statementPath,{companyId:'taebaek',docNo:prefix+'-기초',tradeDate:'2026-07-31',totalAmount:100}]] as const){paths.add(path);await adminDb.doc(path).create(data);}
 },90_000);
 async function login(role:string){const c=credentials.get(role)!;await signInWithEmailAndPassword(auth,c.email,c.password);const token=await auth.currentUser!.getIdTokenResult(true);expect(token.claims).toMatchObject({companyId:role==='foreign'?'punghoe':'taebaek',isAdmin:role!=='staff'});}
 async function data(path=accountPath){return(await adminDb!.doc(path).get()).data()!;}
 afterAll(async()=>{
  const errors:string[]=[];
  if(adminDb)for(const path of paths){try{if(!path.includes(prefix))throw new Error('범위');await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}
  if(adminAuth)for(const uid of uids){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);
 },90_000);
 it('실제 관리자 동시 두 날짜 저장은 모두 보존하고 0원도 전표·기초 변경 없이 기록한다',async()=>{
  await login('admin');const before=await data(),cash=await data(cashPath),statement=await data(statementPath);
  await Promise.all([saveConfirmedCashBalance('taebaek',account,'2026-08-31',0,'은행 8월 확인'),saveConfirmedCashBalance('taebaek',account,'2026-09-30',-10,'은행 9월 확인')]);
  const after=await data();expect(after.confirmedBalances).toEqual([expect.objectContaining({date:'2026-08-31',balance:0,reason:'은행 8월 확인'}),expect.objectContaining({date:'2026-09-30',balance:-10,reason:'은행 9월 확인'})]);
  const {confirmedBalances:_history,...unchanged}=after;expect(unchanged).toEqual(before);expect(await data(cashPath)).toEqual(cash);expect(await data(statementPath)).toEqual(statement);
  const [cashDocs,statementDocs]=await Promise.all([adminDb!.collection('cashEntries').where('cashAccountId','==',account.id).get(),adminDb!.collection('issuedStatements').where('docNo','==',prefix+'-기초').get()]);
  expect(cashDocs.docs.map(row=>row.id)).toEqual([prefix+'-cash']);expect(statementDocs.docs.map(row=>row.id)).toEqual([prefix+'-statement']);
 },60_000);
 it('같은 날짜 정정은 그 날짜만 교체하고 다른 이력을 보존한다',async()=>{
  await login('admin');const before=await data();await saveConfirmedCashBalance('taebaek',account,'2026-08-31',25,'은행 정정');const after=await data();
  expect(after.confirmedBalances).toHaveLength(2);expect(after.confirmedBalances.find((row:any)=>row.date==='2026-08-31')).toMatchObject({balance:25,reason:'은행 정정'});
  expect(after.confirmedBalances.find((row:any)=>row.date==='2026-09-30')).toEqual(before.confirmedBalances.find((row:any)=>row.date==='2026-09-30'));
 },60_000);
 it('실제 직원 및 타회사 관리자 거절은 서비스와 Rules 경계 모두에서 원문을 보존한다',async()=>{
  const before=await data(),otherBefore=await data(`cashAccounts/${foreign.id}`);
  await login('staff');await expect(saveConfirmedCashBalance('taebaek',account,'2026-08-31',99,'직원 요청')).rejects.toThrow('관리자');
  await expect(updateDoc(doc(gateway.db,'cashAccounts',account.id),{confirmedBalances:[]})).rejects.toMatchObject({code:'permission-denied'});
  await login('foreign');await expect(saveConfirmedCashBalance('taebaek',account,'2026-08-31',99,'타회사 요청')).rejects.toThrow('관리자');
  await expect(saveConfirmedCashBalanceWithDb(gateway.db,'taebaek',account,'2026-08-31',99,'타회사 직접 요청')).rejects.toMatchObject({code:'permission-denied'});
  await login('admin');await expect(saveConfirmedCashBalance('taebaek',foreign,'2026-08-31',99,'타회사 계좌')).rejects.toThrow('회사');
  expect(await data()).toEqual(before);expect(await data(`cashAccounts/${foreign.id}`)).toEqual(otherBefore);
 },60_000);
});
