import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {stocktakeByQty,adjustStockByQty} from './unpackService';
import type {CompanyId} from '../types';
const gateway=vi.hoisted(()=>({db:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;}}));
describe.skipIf(process.env.ITEM_QTY_EMULATOR_TEST!=='true')('품목 수량 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='item-qty-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();
 async function seed(suffix:string,companyId:CompanyId='taebaek'){
  const itemId=prefix+'-'+suffix,location='items/'+itemId;paths.add(location);
  await adminDb!.doc(location).create({companyId,name:'합성 품목',stock:3,lots:[{id:prefix+'-'+suffix+'-lot',qtyIn:3,qtyRemaining:3,kgIn:3,kgRemaining:3,unitKg:1,status:'active',receivedDate:'2026-09-01',createdAt:'2026-09-01T00:00:00Z'}],stocktakeAnchors:[],note:'보존'});
  return {itemId,location,itemName:'합성 품목'};
 }
 const read=async(location:string)=>(await adminDb!.doc(location).get()).data()!;
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw new Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw new Error('Auth 주소 불일치');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw new Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  uid=prefix;const password=randomUUID()+'A1!',email=prefix+'@example.invalid';await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:true});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  await signInWithEmailAndPassword(auth,email,password);expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:true});
 },90_000);
 afterAll(async()=>{const errors:string[]=[];if(adminDb)for(const location of paths){try{if(!location.includes(prefix) && !(await adminDb.doc(location).get()).data()?.operationId?.includes(prefix))throw new Error('범위');await adminDb.doc(location).delete();expect((await adminDb.doc(location).get()).exists).toBe(false);}catch{errors.push(location);}}
 if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
 if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);},90_000);


 it('실사 target0은 재고·로트·앵커를 동기화하며 명시 요청 재시도와 충돌은 추가 쓰기를 하지 않는다',async()=>{
  const {itemId,location,itemName}=await seed('stocktake');const params={itemId,itemName,targetQty:0,unitKg:1,operationId:prefix+'-stocktake-op'};
  expect((await stocktakeByQty(params)).ok).toBe(true);const before=await read(location),snap=await adminDb!.doc(location).get();expect(before.stock).toBe(0);expect(before.lots.reduce((sum:number,lot:any)=>sum+(lot.qtyRemaining??0),0)).toBe(0);expect(before.stocktakeAnchors).toHaveLength(1);expect(before.stocktakeAnchors[0]).toMatchObject({id:params.operationId,targetQty:0});
  expect((await stocktakeByQty(params)).ok).toBe(true);expect((await stocktakeByQty({...params,targetQty:1})).ok).toBe(false);expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
 },60_000);
 it('동시 +2와 +3 증감은 최신 수량을 재읽어 재고·로트·두 기록을 보존한다',async()=>{
  const {itemId,location,itemName}=await seed('race');const results=await Promise.all([adjustStockByQty({itemId,itemName,deltaQty:2,unitKg:1,note:'합성 +2'}),adjustStockByQty({itemId,itemName,deltaQty:3,unitKg:1,note:'합성 +3'})]);expect(results.every(result=>result.ok)).toBe(true);
  const saved=await read(location);expect(saved.stock).toBe(8);expect(saved.lots.reduce((sum:number,lot:any)=>sum+(lot.qtyRemaining??0),0)).toBe(8);expect(saved.stocktakeAnchors).toHaveLength(2);expect(saved.stocktakeAnchors.map((anchor:any)=>anchor.deltaQty).sort()).toEqual([2,3]);expect(saved.note).toBe('보존');
 },60_000);
 it('음수 결과와 타회사 두 경로 거절은 품목 원문과 저장시각을 보존한다',async()=>{
  for(const scenario of ['negative','foreign']){const {itemId,location,itemName}=await seed(scenario,scenario==='foreign'?'punghoe':'taebaek');const before=await read(location),snap=await adminDb!.doc(location).get();const adjusted=await adjustStockByQty({itemId,itemName,deltaQty:scenario==='negative'?-4:2});expect(adjusted.ok).toBe(false);if(scenario==='foreign'){expect(adjusted.message).toMatch(/permission|권한/i);const counted=await stocktakeByQty({itemId,itemName,targetQty:0,operationId:prefix+'-foreign-op'});expect(counted.ok).toBe(false);expect(counted.message).toMatch(/permission|권한/i);}expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);}
 },60_000);
});
