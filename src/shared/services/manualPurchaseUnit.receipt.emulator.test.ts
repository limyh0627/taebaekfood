import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {makeManualPurchaseUnitSnapshot} from '../purchaseUnit';
import {operationDocId} from '../rawInventoryCore';
vi.mock('../firebase',()=>({db:null,auth:{currentUser:null},authReady:Promise.resolve()}));
const {confirmUnitPurchaseOrderReceiptWithDb}=await import('./firebaseService');

// 원가 발행 Admin TX 시험과 분리한다. 이 시험은 실제 일반 직원 로그인 뒤 PO 입고를 실행한다.
describe.skipIf(process.env.MANUAL_PURCHASE_RECEIPT_EMULATOR_TEST!=='true')('직접 매입 단위 실제 직원 Auth·입고 SDK',()=>{
 const prefix='manual-receipt-'+randomUUID(),projectId='demo-taebaekfood-local';
 const owned=new Set<string>();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined;
 let adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let db:ReturnType<typeof getFirestore>,uid:string|undefined;
 const own=(path:string)=>{owned.add(path);return adminDb!.doc(path);};
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw new Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw new Error('Auth 주소 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
  process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  const email=prefix+'@example.invalid',password=randomUUID()+'A1!';uid=prefix;
  await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8082);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(auth,email,password);
  expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:false});
 },90_000);
 afterAll(async()=>{
  const errors:string[]=[];
  if(adminDb)for(const path of owned){try{await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}
  if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);
 },90_000);
 const seed=async(kind:'manual'|'grams'|'default'|'registered'|'legacy'|'foreign')=>{
  const id=prefix+'-'+kind,itemId=id+'-raw',companyId=kind==='foreign'?'punghoe':'taebaek';
  const snapshot=kind==='legacy'?undefined:kind==='registered'?{purchaseUnitId:id+'-unit',purchaseUnit:'20kg포',purchaseQty:2,unitKg:20,inventoryQty:40}:makeManualPurchaseUnitSnapshot(kind==='default'?'kg':kind==='grams'?'20g':'20kg',2);
  const quantity=kind==='legacy'?40:2,kg=kind==='default'?2:kind==='grams'?0.04:40;
  const item=own('items/'+itemId),state=own('rawInventories/'+companyId+'__'+itemId),po=own('purchaseOrders/'+id);
  const op=snapshot?`po-receive:${id}:${itemId}:line:0`:`po-receive:${id}:${itemId}`;
  const ledger=own('rawMaterialLedger/'+operationDocId(op));own('itemReceipts/'+`rcv-po-${id}-${itemId}`);
  const line={itemId,name:'합성 원료',quantity,unit:'kg',...(snapshot?{sourceLineIndex:0,...snapshot}:{})};
  await item.create({companyId,name:'합성 원료',type:'raw',subtype:'벌크',unit:'kg',stock:0,lots:[],cost:2200});
  await po.create({companyId,status:'invoiced',partnerName:'합성 공급처',items:[line],createdAt:'2026-10-13'});
  return {id,item,state,po,ledger,line,snapshot,kg};
 };
 it.each(['manual','grams','default','registered','legacy'] as const)('%s PO는 거래수량·단위원문을 보존하고 kg 입고를 한 번만 만든다',async kind=>{
  const f=await seed(kind);expect(await confirmUnitPurchaseOrderReceiptWithDb(db,'taebaek',f.id,'합성 직원')).toBe(true);
  expect((await f.item.get()).get('stock')).toBe(f.kg);expect((await f.item.get()).get('cost')).toBe(2200);
  const state=(await f.state.get()).data()!,ledger=(await f.ledger.get()).data()!;
  expect(state.stockKg).toBe(f.kg);expect(state.activeLots).toHaveLength(1);expect(state.activeLots[0].kgRemaining).toBe(f.kg);
  expect(ledger).toMatchObject({appliedDeltaKg:f.kg,balanceAfterKg:f.kg,source:{type:'purchase',id:f.id}});
  if(f.snapshot)expect(ledger).toMatchObject({...f.snapshot,sourceLineIndex:0});
  if(kind==='grams')expect(ledger).toMatchObject({purchaseUnit:'20g',purchaseQty:2,unitKg:0.02,inventoryQty:0.04});
  expect((await f.po.get()).get('items')).toEqual([f.line]);expect((await f.po.get()).get('status')).toBe('received');
  const refs=[f.item,f.state,f.po,f.ledger],before=await Promise.all(refs.map(ref=>ref.get()));
  expect(await confirmUnitPurchaseOrderReceiptWithDb(db,'taebaek',f.id,'합성 직원')).toBe(false);
  const after=await Promise.all(refs.map(ref=>ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
 },60_000);
 it('타회사 PO는 일반 직원 Rules에서 거절되고 원료·발주·원장을 보존한다',async()=>{
  const f=await seed('foreign'),before=await f.item.get();
  await expect(confirmUnitPurchaseOrderReceiptWithDb(db,'taebaek',f.id)).rejects.toMatchObject({code:'permission-denied'});
  expect((await f.item.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);expect((await f.po.get()).get('status')).toBe('invoiced');
  expect((await f.state.get()).exists).toBe(false);expect((await f.ledger.get()).exists).toBe(false);
 },60_000);
});
