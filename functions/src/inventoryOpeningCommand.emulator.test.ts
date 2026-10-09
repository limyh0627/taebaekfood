import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createInventoryOpening,type InventoryOpeningInput} from './inventoryOpeningCommand';

describe.skipIf(process.env.INVENTORY_OPENING_EMULATOR_TEST!=='true')('재고 기초 실제 인증과 서버 원자 거래',()=>{
 const prefix='inventory-opening-'+randomUUID(),projectId='demo-taebaekfood-local';
 let app:any,admin:any,db:any,auth:any,actor:any;
 const paths=new Set<string>(),originals=new Map<string,any>();
 const input=(id:string,quantity=2):InventoryOpeningInput=>({companyId:'taebaek',date:'2026-07-31',itemId:id,quantity,value:100,releaseId:prefix});
 const save=async(path:string,row:any)=>{if(!paths.has(path)){const prior=await db.doc(path).get();if(prior.exists)originals.set(path,prior.data());}paths.add(path);await db.doc(path).set(row);};
 const seed=async(kind='product',extra:any={})=>{const id=prefix+'-'+randomUUID();await save('items/'+id,{companyId:'taebaek',name:'합성 품목',type:kind,unit:'개',spec:'1kg',stock:0,lots:[],...extra});paths.add('issuedStatements/opening-inventory-taebaek-'+id);return id;};
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('전용 에뮬레이터만 허용');
  admin=adminApp({projectId},prefix);db=getFirestore(admin);auth=adminAuth(admin);
  const password=randomUUID()+'A1!';await auth.createUser({uid:prefix,email:prefix+'@example.invalid',password});
  await auth.setCustomUserClaims(prefix,{companyId:'taebaek',isAdmin:true,employeeId:prefix+'-employee'});
  app=initializeApp({projectId,apiKey:'local-only'},prefix);const sdk=getAuth(app);connectAuthEmulator(sdk,'http://127.0.0.1:9099',{disableWarnings:true});
  await signInWithEmailAndPassword(sdk,prefix+'@example.invalid',password);actor={uid:sdk.currentUser!.uid,token:(await sdk.currentUser!.getIdTokenResult(true)).claims};
  expect(actor.uid).not.toBe(actor.token.employeeId);
  await save('appMeta/releaseCutover',{status:'active',releaseId:prefix});
  await save('openingBalances/main',{companyId:'taebaek',date:'2026-07-31',amounts:{'146':0}});
 },90000);
 afterAll(async()=>{
  if(db){for(const col of ['rawMaterialLedger','rawInventories']){const rows=await db.collection(col).get();for(const row of rows.docs)if(String(row.data().operationId??'').includes(prefix)||String(row.data().rawItemId??'').includes(prefix))paths.add(row.ref.path);}
   for(const path of paths){if(originals.has(path)){await db.doc(path).set(originals.get(path));expect((await db.doc(path).get()).data()).toEqual(originals.get(path));}else{await db.doc(path).delete();expect((await db.doc(path).get()).exists).toBe(false);}}}
  if(auth){await auth.deleteUser(prefix);await expect(auth.getUser(prefix)).rejects.toMatchObject({code:'auth/user-not-found'});}
  if(app)await deleteApp(app);if(admin)await deleteAdminApp(admin);
 },90000);
 it('박스는 최신 BOM으로 로트 kg와 146/375를 함께 기록하며 재시도는 불변이다',async()=>{
  const id=await seed('product',{spec:'1kg * 20'}),child=await seed();await save('item_bom/'+prefix+'-bom',{companyId:'taebaek',parent_id:id,child_id:child,quantity:20});
  expect(await createInventoryOpening(db,actor,input(id))).toBe('created');
  const item=(await db.doc('items/'+id).get()).data();expect(item.stock).toBe(2);expect(item.lots[0].kgRemaining).toBe(40);
  const ref=db.doc('issuedStatements/opening-inventory-taebaek-'+id),before=(await ref.get()).data();expect(before.items.map((l:any)=>[l.accountCode,l.side,l.total])).toEqual([['146','차변',100],['375','대변',100]]);
  expect(await createInventoryOpening(db,actor,input(id))).toBe('unchanged');expect((await ref.get()).data()).toEqual(before);
  await expect(createInventoryOpening(db,actor,input(id,3))).rejects.toThrow('다른 내용');expect((await ref.get()).data()).toEqual(before);
 });
 it('원료 기초는 본체 원장 mirror 로트를 함께 기록한다',async()=>{
  const id=await seed('raw',{subtype:'벌크',unit:'kg'});expect(await createInventoryOpening(db,actor,input(id,2.125))).toBe('created');
  const item=(await db.doc('items/'+id).get()).data();expect(item.stock).toBe(2.125);expect(item.lots.reduce((s:number,l:any)=>s+l.kgRemaining,0)).toBe(2.125);
  const states=await db.collection('rawInventories').where('rawItemId','==',id).get();expect(states.size).toBe(1);expect(states.docs[0].data().stockKg).toBe(2.125);
  const movements=await db.collection('rawMaterialLedger').where('operationId','==',`opening-inventory:taebaek:${id}`).get();expect(movements.size).toBe(1);
 });
 it('기존 재고·일자·146·타회사·직원 거절은 금융 원문을 만들지 않는다',async()=>{
  const id=await seed('product',{stock:3}),original=(await db.doc('items/'+id).get()).data();
  await expect(createInventoryOpening(db,actor,input(id))).rejects.toThrow('이미 재고');
  await expect(createInventoryOpening(db,actor,{...input(id),date:'2026-02-30'})).rejects.toThrow('날짜');
  await expect(createInventoryOpening(db,{...actor,token:{...actor.token,companyId:'punghoe'}},input(id))).rejects.toMatchObject({code:'permission-denied'});
  await expect(createInventoryOpening(db,{...actor,token:{...actor.token,isAdmin:false}},input(id))).rejects.toMatchObject({code:'permission-denied'});
  expect((await db.doc('items/'+id).get()).data()).toEqual(original);expect((await db.doc('issuedStatements/opening-inventory-taebaek-'+id).get()).exists).toBe(false);
  const empty=await seed();await db.doc('openingBalances/main').update({'amounts.146':1});await expect(createInventoryOpening(db,actor,input(empty))).rejects.toThrow('이중계상');await db.doc('openingBalances/main').update({'amounts.146':0});
  expect((await db.doc('items/'+empty).get()).data().stock).toBe(0);expect((await db.doc('issuedStatements/opening-inventory-taebaek-'+empty).get()).exists).toBe(false);
 });
});
