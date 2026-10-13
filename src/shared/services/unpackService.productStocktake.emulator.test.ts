import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {stocktakeByQty,durableProductStocktake} from './unpackService';
import {readProductStocktakeAttempt,beginProductStocktakeAttempt,submitProductStocktakeAttempt,productStocktakeRequest} from '../productStocktakeAttempt';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));
describe.skipIf(process.env.PRODUCT_STOCKTAKE_EMULATOR_TEST!=='true')('제품 실사 최초 요청 실제 Auth·Firestore',()=>{
 const projectId='demo-taebaekfood-local',prefix='product-count-'+randomUUID();
 let app:ReturnType<typeof initializeApp>,adminApp:ReturnType<typeof initializeAdminApp>,adminDb:ReturnType<typeof getAdminFirestore>,adminAuth:ReturnType<typeof getAdminAuth>;
 const accounts=new Map<string,{uid:string;email:string;password:string}>(),paths=new Set<string>(),storage=new Map<string,string>();const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const read=async(itemId:string)=>(await adminDb.doc('items/'+itemId).get()).data()!;
 async function login(companyId:'taebaek'|'punghoe'){const user=accounts.get(companyId)!;await signInWithEmailAndPassword(gateway.auth,user.email,user.password);}
 async function seed(suffix:string,companyId='taebaek'){
  const itemId=prefix+'-'+suffix;paths.add('items/'+itemId);await adminDb.doc('items/'+itemId).create({companyId,name:'SDK제품',stock:3,minStock:0,lots:[{id:itemId+'-lot',qtyIn:3,qtyRemaining:3,unitKg:1,kgIn:3,kgRemaining:3,status:'active'}],stocktakeAnchors:[]});return {companyId:'taebaek' as const,itemId,itemName:'SDK제품',targetQty:5,minStock:0,unitKg:1};
 }
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Auth 주소 불일치');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}});
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  for(const companyId of ['taebaek','punghoe']){const uid=prefix+'-'+companyId,email=uid+'@example.invalid',password=randomUUID()+'A1!';await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{companyId,employeeId:uid,isAdmin:true});accounts.set(companyId,{uid,email,password});}
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-client');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});await login('taebaek');
 },90000);
 afterAll(async()=>{const errors:string[]=[];for(const path of paths){try{await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}for(const account of accounts.values()){try{await adminAuth.deleteUser(account.uid);await expect(adminAuth.getUser(account.uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(account.uid);}}if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete (globalThis as any).localStorage;expect(errors).toEqual([]);},90000);
 it('중간 출고와 최소수량 수정 뒤 같은 최초원문 조회는 재고와 버전을 보존한다',async()=>{
  await login('taebaek');const params=await seed('retry'),uid=accounts.get('taebaek')!.uid;
  const attempt=submitProductStocktakeAttempt(beginProductStocktakeAttempt({...params,uid}));const request=productStocktakeRequest(attempt);
  expect((await stocktakeByQty({...request,request,mode:'apply'})).ok).toBe(true);
  await adminDb.doc('items/'+params.itemId).update({stock:2,minStock:7,lots:[{id:params.itemId+'-lot',qtyIn:3,qtyRemaining:2,unitKg:1,kgIn:3,kgRemaining:2,status:'active'}]});const before=await read(params.itemId),snap=await adminDb.doc('items/'+params.itemId).get();
  expect((await durableProductStocktake({...params,targetQty:99,minStock:9})).ok).toBe(true);expect(await read(params.itemId)).toEqual(before);expect((await adminDb.doc('items/'+params.itemId).get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);expect(readProductStocktakeAttempt('taebaek',uid,params.itemId)).toBeNull();
 },60000);
 it('원문없는 오래된 앵커·삭제된 앵커·변조된 최초입력은 추정 적용하지 않는다',async()=>{
  await login('taebaek');const params=await seed('missing'),uid=accounts.get('taebaek')!.uid;const request=productStocktakeRequest(submitProductStocktakeAttempt(beginProductStocktakeAttempt({...params,uid})));
  const before=await read(params.itemId);expect((await stocktakeByQty({...request,request,mode:'inspect'})).ok).toBe(false);expect(await read(params.itemId)).toEqual(before);
  await adminDb.doc('items/'+params.itemId).update({stocktakeAnchors:[{id:request.operationId,targetQty:request.targetQty}]});const legacy=await read(params.itemId);expect((await stocktakeByQty({...request,request,mode:'inspect'})).ok).toBe(false);expect(await read(params.itemId)).toEqual(legacy);
  await adminDb.doc('items/'+params.itemId).update({stocktakeAnchors:[{id:request.operationId,targetQty:request.targetQty,request:{...request,targetQty:request.targetQty+1}}]});const tampered=await read(params.itemId);expect((await stocktakeByQty({...request,request,mode:'inspect'})).ok).toBe(false);expect(await read(params.itemId)).toEqual(tampered);
 },60000);
 it('다른 회사 계정·다른 UID의 최초 요청·로그아웃은 쓰기 없이 거절한다',async()=>{
  await login('taebaek');const params=await seed('scope'),uid=accounts.get('taebaek')!.uid,request=productStocktakeRequest(submitProductStocktakeAttempt(beginProductStocktakeAttempt({...params,uid})));const before=await read(params.itemId);
  await login('punghoe');expect((await stocktakeByQty({...request,request,mode:'apply'})).ok).toBe(false);await login('taebaek');const changed={...request,uid:'other'};expect((await stocktakeByQty({...changed,request:changed,mode:'apply'})).ok).toBe(false);await signOut(gateway.auth);expect((await durableProductStocktake(params)).ok).toBe(false);expect(await read(params.itemId)).toEqual(before);
 },60000);
 it('같은 최초 요청 동시 TX는 실사 앵커와 재고를 한번만 반영한다',async()=>{
  await login('taebaek');const params=await seed('race'),uid=accounts.get('taebaek')!.uid,request=productStocktakeRequest(submitProductStocktakeAttempt(beginProductStocktakeAttempt({...params,uid})));
  const results=await Promise.all([stocktakeByQty({...request,request,mode:'apply'}),stocktakeByQty({...request,request,mode:'apply'})]);expect(results.every(result=>result.ok)).toBe(true);const after=await read(params.itemId);expect(after.stock).toBe(5);expect(after.stocktakeAnchors).toHaveLength(1);
 },60000);
 it('양사 신규 이월은 실제 품목의 물질만 남기고 기존 로트와 단가를 보존한다',async()=>{
  for(const companyId of ['taebaek','punghoe'] as const){
   await login(companyId);const params=await seed('material-'+companyId,companyId);
   await adminDb.doc('items/'+params.itemId).update({rawMaterialName:'볶음참깨',costPrice:12345});
   const before=await read(params.itemId),uid=accounts.get(companyId)!.uid;
   const request=productStocktakeRequest(submitProductStocktakeAttempt(beginProductStocktakeAttempt({...params,companyId,uid})));
   expect((await stocktakeByQty({...request,request,mode:'apply'})).ok).toBe(true);
   const after=await read(params.itemId);expect(after.lots.find((lot:any)=>lot.supplierName==='이월')).toMatchObject({material:'볶음참깨',qtyRemaining:2,kgRemaining:2});
   expect(after.lots[0]).toEqual(before.lots[0]);expect(after.costPrice).toBe(12345);expect(after.stock).toBe(5);expect(after.stocktakeAnchors[0].request).toEqual(request);
  }
 },60000);
});
