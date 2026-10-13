import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as adminInit,deleteApp as adminDelete} from 'firebase-admin/app';
import {getAuth as adminGetAuth} from 'firebase-admin/auth';
import {getFirestore as adminGetDb} from 'firebase-admin/firestore';
import {applyItemStockAddWithDb,durableItemStockAdd} from './itemStockAddService';
import {productStocktakeActor} from './unpackService';
import {beginItemInventoryAttempt,readItemInventoryAttempt,type ItemStockAddRequest} from '../itemInventoryAttempt';
import {operationDocId} from '../rawInventoryCore';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));
describe.skipIf(process.env.ITEM_STOCK_ADD_EMULATOR_TEST!=='true')('재고 추가 전체 batch 실제 직원 Auth/Firestore',()=>{
 const projectId='demo-taebaekfood-local',prefix='stock-add-'+randomUUID(),paths=new Set<string>(),storage=new Map<string,string>();
 let app:ReturnType<typeof initializeApp>,adminApp:ReturnType<typeof adminInit>,adminDb:ReturnType<typeof adminGetDb>,adminAuth:ReturnType<typeof adminGetAuth>,uid:string;
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('승인된 demo 에뮬레이터 주소를 확인해 주세요.');
  adminApp=adminInit({projectId},prefix+'-admin');adminDb=adminGetDb(adminApp);adminAuth=adminGetAuth(adminApp);uid=prefix;
  const email=prefix+'@example.invalid',password=randomUUID()+'A1!';await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(gateway.auth,email,password);expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:false});
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 },90_000);
 async function seed(suffix:string):Promise<ItemStockAddRequest>{const rows=['a','b'].map(key=>({itemId:prefix+'-'+suffix+'-'+key,itemName:'합성 제품 '+key,deltaQty:2,unitKg:1,note:'재고 추가'}));for(const row of rows){const path='items/'+row.itemId;paths.add(path);await adminDb.doc(path).create({companyId:'taebaek',type:'product',stock:3,lots:[]});}const request:ItemStockAddRequest={version:1,kind:'stock-add',operationId:prefix+'-'+suffix+'-operation',companyId:'taebaek',uid,capturedAt:'2026-10-12T01:00:00.000Z',date:'2026-10-12',rows};paths.add('itemStockAddOperations/'+operationDocId(request.operationId));return request;}
 const check=async()=>{await productStocktakeActor('taebaek',uid,true);};
 it('전체 성공과 현재품목삭제 후 inspect는 영수증만 확인하여 updateTime이 같다',async()=>{const r=await seed('own');expect((await applyItemStockAddWithDb(gateway.db,r,'apply',check)).status).toBe('applied');for(const row of r.rows)expect((await adminDb.doc('items/'+row.itemId).get()).data()!.stock).toBe(5);const ref=adminDb.doc('itemStockAddOperations/'+operationDocId(r.operationId)),before=await ref.get();await adminDb.doc('items/'+r.rows[0].itemId).delete();await adminDb.doc('items/'+r.rows[1].itemId).set({companyId:'punghoe'});expect((await applyItemStockAddWithDb(gateway.db,r,'inspect',check)).status).toBe('duplicate');expect((await ref.get()).updateTime?.isEqual(before.updateTime!)).toBe(true);},60_000);
 it('둘째 품목 분류 오류는 첫째도 그대로이고 영수증 쓰기0이다',async()=>{const r=await seed('blocked');await adminDb.doc('items/'+r.rows[1].itemId).update({type:'raw',subtype:'벌크',unit:'kg'});const before=await adminDb.doc('items/'+r.rows[0].itemId).get();expect((await applyItemStockAddWithDb(gateway.db,r,'apply',check)).status).toBe('rejected');expect((await adminDb.doc('items/'+r.rows[0].itemId).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);expect((await adminDb.doc('itemStockAddOperations/'+operationDocId(r.operationId)).get()).exists).toBe(false);},60_000);
 it('신규 이월만 품목 물질을 저장하고 기존 이월 물질·가격·영수증 원문은 보존한다',async()=>{
  const r=await seed('material'),first=adminDb.doc('items/'+r.rows[0].itemId),second=adminDb.doc('items/'+r.rows[1].itemId);
  await first.update({rawMaterialName:'볶음참깨',costPrice:12345});
  const old={id:'old',supplierName:'이월',material:'옛물질',qtyIn:3,qtyRemaining:3,unitKg:1,kgIn:3,kgRemaining:3,status:'active'};
  await second.update({material:'새물질',lots:[old],costPrice:23456});
  expect((await applyItemStockAddWithDb(gateway.db,r,'apply',check)).status).toBe('applied');
  expect((await first.get()).data()!.lots[0]).toMatchObject({material:'볶음참깨',qtyRemaining:5,kgRemaining:5});
  expect((await second.get()).data()!.lots[0].material).toBe('옛물질');expect((await first.get()).data()!.costPrice).toBe(12345);expect((await second.get()).data()!.costPrice).toBe(23456);
  expect((await adminDb.doc('itemStockAddOperations/'+operationDocId(r.operationId)).get()).data()!.request).toEqual(r);
 },60_000);
 it('완료 뒤 local cleanup 응답 유실 재개는 같은 요청 inspect로 재고 추가0이다',async()=>{const r=await seed('retry');const retained=beginItemInventoryAttempt({kind:'stock-add',companyId:'taebaek',uid,operationId:r.operationId,rows:r.rows});const realRemove=localStorage.removeItem;localStorage.removeItem=()=>{throw Error('cleanup lost');};expect((await durableItemStockAdd(retained.request as ItemStockAddRequest)).status).toBe('unknown');localStorage.removeItem=realRemove;const before=await adminDb.doc('items/'+r.rows[0].itemId).get();expect(readItemInventoryAttempt('taebaek',uid,'stock-add')!.state).toBe('submitted');expect((await durableItemStockAdd(retained.request as ItemStockAddRequest)).status).toBe('duplicate');expect((await adminDb.doc('items/'+r.rows[0].itemId).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);},60_000);
 afterAll(async()=>{const failures:string[]=[];for(const path of paths){try{const original=await adminDb.doc(path).get();if(!path.includes(prefix)&&original.exists&&(!String(original.data()?.request?.operationId??'').startsWith(prefix+'-')||original.data()?.uid!==uid))throw Error('범위');await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{failures.push(path);}}if(uid){await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}storage.clear();vi.unstubAllGlobals();if(app)await deleteApp(app);if(adminApp)await adminDelete(adminApp);expect(failures).toEqual([]);},90_000);
});
