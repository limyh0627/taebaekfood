import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore,getDoc,doc} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {applyRawCommand,commandHash,operationDocId,type RawApplyResult} from '../rawInventoryCore';
import type {CompanyId,PurchaseOrder} from '../types';
import {readOemExternalStockEvidence} from './oemExternalStockEvidence';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));
describe.skipIf(process.env.OEM_EXTERNAL_EVIDENCE_EMULATOR_TEST!=='true')('외주송출 근거 실제 Auth·SDK 읽기',()=>{
 const projectId='demo-taebaekfood-local',prefix='oem-proof-'+randomUUID();let app:any,adminApp:any,adminDb:any,adminAuth:any;
 const users=new Map<CompanyId,{uid:string,email:string,password:string}>(),paths=new Set<string>(),orders=new Map<CompanyId,PurchaseOrder>();
 async function login(company:CompanyId){const user=users.get(company)!;await signOut(gateway.auth);await signInWithEmailAndPassword(gateway.auth,user.email,user.password);expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({companyId:company,employeeId:user.uid});}
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw new Error('emulator mismatch');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw new Error('auth mismatch');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw new Error('project mismatch');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  app=initializeApp({projectId,apiKey:'local-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});
  for(const companyId of ['taebaek','punghoe'] as const){const uid=prefix+'-'+companyId,email=uid+'@example.invalid',password=randomUUID()+'A1!';await adminAuth.createUser({uid,email,password});users.set(companyId,{uid,email,password});await adminAuth.setCustomUserClaims(uid,{companyId,employeeId:uid,isAdmin:false});
   const po={id:prefix+'-'+companyId,companyId,poType:'oem',partnerName:'합성외주',status:'pending',oemIssueStatus:'failed',oemIssueDate:'2026-10-12',itemId:'',itemName:'',quantity:0,createdAt:'',oemSent:[{rawItemId:prefix+'-raw-a',material:'참깨',kg:100},{rawItemId:prefix+'-raw-b',material:'들깨',kg:50}]} as PurchaseOrder;orders.set(companyId,po);
   const jobId=`oem-issue:${po.id}`;const raw=po.oemSent![0],operationId=`${jobId}:${raw.rawItemId}`;
   const command={operationId,companyId,rawItemId:raw.rawItemId!,materialSnapshot:raw.material,effectiveAt:'2026-10-12T12:00:00+09:00',source:{type:'oem' as const,id:po.id},kind:'consume' as const,kg:raw.kg};
   for(const [path,data] of [[`purchaseOrders/${po.id}`,po],[`rawInventoryJobs/${jobId}`,{id:jobId,companyId,source:{type:'oem',id:po.id},expectedOperationIds:po.oemSent!.map(row=>`${jobId}:${row.rawItemId}`),status:'failed'}],[`rawMaterialLedger/${operationDocId(operationId)}`,{...command,commandHash:commandHash(command),reportedDeltaKg:-100,appliedDeltaKg:0}]] as const){await adminDb.doc(path).create(data);paths.add(path);}
  }
 },30000);
 afterAll(async()=>{
  // 원장 ID는 공용 operationDocId로 인코딩된다. 이 실행에서 create 성공한 정확 경로 집합만 정리한다.
  if(adminDb)for(const path of paths){await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}
  if(adminAuth)for(const {uid} of users.values()){await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);
 },30000);
 it.each(['taebaek','punghoe'] as const)('%s 실제 로그인은 자기 원문·부분송출·재고미반영을 읽고 쓰지 않는다',async company=>{
  await login(company);const po=orders.get(company)!;const path=`purchaseOrders/${po.id}`,before=await adminDb.doc(path).get();
  const result=await readOemExternalStockEvidence(company,[po]);expect(result[0].state).toBe('partial');expect(result[0].rows[0]).toMatchObject({reportedKg:100,appliedKg:0});expect(result[0].rows[1].reportedKg).toBeUndefined();expect((await adminDb.doc(path).get()).updateTime.isEqual(before.updateTime)).toBe(true);
  const other=orders.get(company==='taebaek'?'punghoe':'taebaek')!;await expect(getDoc(doc(gateway.db,'purchaseOrders',other.id))).rejects.toMatchObject({code:'permission-denied'});
  expect(await readOemExternalStockEvidence(company,[other])).toEqual([]);
 },30000);
 it('없는 결정적 문서는 미확인이고 충돌하는 동일ID 원문은 임의선택하지 않는다',async()=>{
  await login('taebaek');const po=orders.get('taebaek')!;expect((await readOemExternalStockEvidence('taebaek',[{...po,id:prefix+'-missing'}]))[0].state).toBe('unknown');
  expect((await readOemExternalStockEvidence('taebaek',[po,{...po,oemSent:[{...po.oemSent![0],kg:1}]}]))[0]).toMatchObject({state:'unknown',reason:expect.stringContaining('중복')});
  expect(await readOemExternalStockEvidence('taebaek',[po,po])).toHaveLength(1);
 },30000);
 it('로그아웃 조회는 거절하며 기존 원문을 유지한다',async()=>{
  await signOut(gateway.auth);await expect(readOemExternalStockEvidence('taebaek',[orders.get('taebaek')!])).rejects.toThrow('로그인');
 },30000);
 it.each([false,true])('공용 코어의 실사 경계 소급=%s 취소 반영량을 actual SDK로 대조한다',async backdated=>{
  await login('taebaek');const id=prefix+'-anchor-'+backdated,rawItemId=prefix+'-anchor-raw-'+backdated,operationId=`oem-issue:${id}:${rawItemId}`,reverseId=`oem-cancel:${id}:${rawItemId}`;
  const base={companyId:'taebaek' as const,rawItemId,materialSnapshot:'참깨',source:{type:'oem' as const,id}},det={now:'2026-10-12T15:00:00Z',newLotId:'synthetic-lot',carryOverLotId:'synthetic-carry'};
  const applied=(result:RawApplyResult)=>{if(result.status!=='applied')throw new Error('core fixture '+result.status);return result;};
  const received=applied(applyRawCommand({state:null,command:{...base,operationId:id+'-in',effectiveAt:'2026-10-10T00:00:00Z',kind:'receive',kg:200,lot:{supplierName:'합성'}},det}));
  const anchor=(state:typeof received.state)=>applied(applyRawCommand({state,command:{...base,operationId:id+'-anchor',effectiveAt:'2026-10-13T00:00:00Z',kind:'stocktake',targetKg:50},det}));
  const original=applied(applyRawCommand({state:backdated?anchor(received.state).state:received.state,command:{...base,operationId,effectiveAt:'2026-10-12T12:00:00+09:00',kind:'consume',kg:100},det}));
  const state=backdated?original.state:anchor(original.state).state;
  const reversal=applied(applyRawCommand({state,original:original.movement,command:{...base,operationId:reverseId,effectiveAt:'2026-10-14T00:00:00Z',kind:'reverse',originalOperationId:operationId},det}));
  expect(original.movement.appliedDeltaKg).toBe(backdated?0:-100);expect(reversal.movement.appliedDeltaKg).toBe(backdated?0:100);
  const po={...orders.get('taebaek')!,id,status:'invoiced' as const,oemIssueStatus:'complete' as const,oemSent:[{rawItemId,material:'참깨',kg:100}],oemCancelledAt:'2026-10-14T00:00:00Z',oemCancelOperationId:`oem-cancel:${id}`};
  for(const [path,data] of [[`purchaseOrders/${id}`,po],[`rawInventoryJobs/oem-issue:${id}`,{id:`oem-issue:${id}`,companyId:'taebaek',source:{type:'oem',id},status:'complete',expectedOperationIds:[operationId]}],[`rawMaterialLedger/${operationDocId(operationId)}`,original.movement],[`rawMaterialLedger/${operationDocId(reverseId)}`,reversal.movement],[`rawInventoryReversalGuards/${operationDocId(operationId)}`,reversal.guard!]] as const){await adminDb.doc(path).create(JSON.parse(JSON.stringify(data)));paths.add(path);}
  const result=await readOemExternalStockEvidence('taebaek',[po]);expect(result[0].state).toBe('cancelled');expect(result[0].rows[0].appliedKg).toBe(backdated?0:100);
 },30000);
 it('권한 조회 await 중 실제 UID 전환은 이전 결과를 확정하지 않는다',async()=>{
  await login('taebaek');const user=gateway.auth.currentUser;const original=user.getIdTokenResult.bind(user);let resume!:()=>void;const paused=new Promise<void>(resolve=>resume=resolve);const spy=vi.spyOn(user,'getIdTokenResult').mockImplementationOnce(async()=>{await paused;return original();});
  const request=readOemExternalStockEvidence('taebaek',[orders.get('taebaek')!]);const rejection=expect(request).rejects.toThrow('바뀌었습니다');await new Promise(resolve=>setTimeout(resolve,0));await login('punghoe');resume();await rejection;spy.mockRestore();
 },30000);
 it('같은 UID의 회사 claim 변경도 이전 결과를 확정하지 않는다',async()=>{
  await login('taebaek');const user=gateway.auth.currentUser,original=user.getIdTokenResult.bind(user);let resume!:()=>void;const paused=new Promise<void>(resolve=>resume=resolve);const spy=vi.spyOn(user,'getIdTokenResult').mockImplementationOnce(async()=>{await paused;return original();});
  const request=readOemExternalStockEvidence('taebaek',[orders.get('taebaek')!]),rejection=expect(request).rejects.toThrow('바뀌었습니다');
  await new Promise(resolve=>setTimeout(resolve,0));await adminAuth.setCustomUserClaims(user.uid,{companyId:'punghoe',employeeId:user.uid,isAdmin:false});await original(true);resume();await rejection;spy.mockRestore();
  await adminAuth.setCustomUserClaims(user.uid,{companyId:'taebaek',employeeId:user.uid,isAdmin:false});await original(true);
 },30000);
});
