import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {stocktakeByQty,adjustStockByQty,durableProductStocktake} from './unpackService';
import {productStocktakeRequest,beginProductStocktakeAttempt,submitProductStocktakeAttempt,readProductStocktakeAttempt} from '../productStocktakeAttempt';
import type {CompanyId} from '../types';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));
describe.skipIf(process.env.ITEM_QTY_EMULATOR_TEST!=='true')('품목 수량 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='item-qty-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();const storage=new Map<string,string>(),previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const requestFor=(params:{itemId:string;itemName:string;targetQty:number;unitKg?:number;operationId?:string})=>productStocktakeRequest({version:1,companyId:'taebaek',uid:uid!,unitKg:params.unitKg??1,capturedAt:'2026-10-12T15:30:00.000Z',...params,operationId:params.operationId??prefix+'-count-'+params.itemId,state:'prepared'});
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
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}});
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  uid=prefix;const password=randomUUID()+'A1!',email=prefix+'@example.invalid';await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);const auth=getAuth(app);gateway.auth=auth;connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  await signInWithEmailAndPassword(auth,email,password);expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:false});
 },90_000);
 afterAll(async()=>{const errors:string[]=[];if(adminDb)for(const location of paths){try{if(!location.includes(prefix) && !(await adminDb.doc(location).get()).data()?.operationId?.includes(prefix))throw new Error('범위');await adminDb.doc(location).delete();expect((await adminDb.doc(location).get()).exists).toBe(false);}catch{errors.push(location);}}
 if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
 if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete (globalThis as any).localStorage;expect(errors).toEqual([]);},90_000);


 it('실사 target0은 재고·로트·앵커를 동기화하며 명시 요청 재시도와 충돌은 추가 쓰기를 하지 않는다',async()=>{
  const {itemId,location,itemName}=await seed('stocktake');const request=requestFor({itemId,itemName,targetQty:0,unitKg:1,operationId:prefix+'-stocktake-op'}),params={...request,request,mode:'apply' as const};
  expect((await stocktakeByQty(params)).ok).toBe(true);const before=await read(location),snap=await adminDb!.doc(location).get();expect(before.stock).toBe(0);expect(before.lots.reduce((sum:number,lot:any)=>sum+(lot.qtyRemaining??0),0)).toBe(0);expect(before.stocktakeAnchors).toHaveLength(1);expect(before.stocktakeAnchors[0]).toMatchObject({id:params.operationId,targetQty:0,date:'2026-10-13',createdAt:request.capturedAt,request});
  expect((await stocktakeByQty(params)).ok).toBe(true);expect((await stocktakeByQty({...params,targetQty:1})).ok).toBe(false);expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
 },60_000);
 it('동시 +2와 +3 증감은 최신 수량을 재읽어 재고·로트·두 기록을 보존한다',async()=>{
  const {itemId,location,itemName}=await seed('race');const results=await Promise.all([adjustStockByQty({itemId,itemName,deltaQty:2,unitKg:1,note:'합성 +2'}),adjustStockByQty({itemId,itemName,deltaQty:3,unitKg:1,note:'합성 +3'})]);expect(results.every(result=>result.ok)).toBe(true);
  const saved=await read(location);expect(saved.stock).toBe(8);expect(saved.lots.reduce((sum:number,lot:any)=>sum+(lot.qtyRemaining??0),0)).toBe(8);expect(saved.stocktakeAnchors).toHaveLength(2);expect(saved.stocktakeAnchors.map((anchor:any)=>anchor.deltaQty).sort()).toEqual([2,3]);expect(saved.note).toBe('보존');
 },60_000);
 it('음수 결과와 타회사 두 경로 거절은 품목 원문과 저장시각을 보존한다',async()=>{
  for(const scenario of ['negative','foreign']){const {itemId,location,itemName}=await seed(scenario,scenario==='foreign'?'punghoe':'taebaek');const before=await read(location),snap=await adminDb!.doc(location).get();const adjusted=await adjustStockByQty({itemId,itemName,deltaQty:scenario==='negative'?-4:2});expect(adjusted.ok).toBe(false);if(scenario==='foreign'){expect(adjusted.message).toMatch(/permission|권한/i);const counted=await stocktakeByQty((()=>{const request=requestFor({itemId,itemName,targetQty:0,operationId:prefix+'-foreign-op'});return {...request,request,mode:'apply' as const};})());expect(counted.ok).toBe(false);expect(counted.message).toMatch(/permission|권한/i);}expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);}
 },60_000);
 it('요청·실행방식 없는 런타임 호출은 실제 품목과 저장시각을 바꾸지 않는다',async()=>{
  const {itemId,itemName,location}=await seed('no-request'),before=await read(location),snap=await adminDb!.doc(location).get();
  // 아직 남은 옛 자바스크립트 호출을 타입 단정으로 재현한다.
  expect((await stocktakeByQty({itemId,itemName,targetQty:0,operationId:prefix+'-old'} as unknown as Parameters<typeof stocktakeByQty>[0])).ok).toBe(false);
  const request=requestFor({itemId,itemName,targetQty:0});expect((await stocktakeByQty({...request,request} as unknown as Parameters<typeof stocktakeByQty>[0])).ok).toBe(false);
  expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
 },60000);
 it('다른 UID의 원문과 원료 홀더는 제품 실사로 쓰지 않는다',async()=>{
  for(const scenario of ['uid','raw-holder']){
   const {itemId,itemName,location}=await seed(scenario);if(scenario==='raw-holder')await adminDb!.doc(location).update({type:'raw',subtype:'벌크',unit:'kg'});
   const request=requestFor({itemId,itemName,targetQty:0});if(scenario==='uid')request.uid=prefix+'-different-user';
   const before=await read(location),snap=await adminDb!.doc(location).get();const result=await stocktakeByQty({...request,request,mode:'apply'});expect(result.ok).toBe(false);expect(result.message).toMatch(scenario==='uid'?/로그인/:/원료/);
   expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
  }
 },60000);
 it('submitted 영수증 부재는 inspect만 수행하고 실제 최초 원문을 그대로 보존한다',async()=>{
  const {itemId,itemName,location}=await seed('unknown-inspect');const attempt=submitProductStocktakeAttempt(beginProductStocktakeAttempt({companyId:'taebaek',uid:uid!,itemId,itemName,targetQty:0,unitKg:1,operationId:prefix+'-unknown-op'}));
  const before=await read(location),snap=await adminDb!.doc(location).get();expect((await durableProductStocktake({companyId:'taebaek',itemId,itemName,targetQty:99,unitKg:5})).ok).toBe(false);
  expect(readProductStocktakeAttempt('taebaek',uid!,itemId)).toEqual(attempt);expect(await read(location)).toEqual(before);expect((await adminDb!.doc(location).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
 },60000);

});
