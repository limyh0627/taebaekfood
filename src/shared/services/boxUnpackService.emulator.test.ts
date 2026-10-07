import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { unpackBoxStock } from './boxUnpackService';

const gateway = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return gateway.db; } }));

describe.skipIf(process.env.BOX_UNPACK_EMULATOR_TEST !== 'true')('박스 개봉 실제 Auth·Firestore 계약', () => {
 const projectId = 'demo-taebaekfood-local';
 const prefix = 'box-sdk-' + randomUUID();
 let app: ReturnType<typeof initializeApp> | undefined;
 let adminApp: ReturnType<typeof initializeAdminApp> | undefined;
 let adminDb: ReturnType<typeof getAdminFirestore> | undefined;
 let adminAuth: ReturnType<typeof getAdminAuth> | undefined;
 let uid: string | undefined;
 const paths = new Set<string>();
 const boxLot = { id: 'source', supplierName: '합성 공급처', lotNo: 'TEST-LOT', receivedDate: '2026-10-01', qtyIn: 2, qtyRemaining: 2, unitKg: 20, kgIn: 40, kgRemaining: 40, status: 'active' };
 beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082') throw new Error('Firestore 주소 불일치');
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Auth 주소 불일치');
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw new Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8082'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; process.env.GCLOUD_PROJECT = projectId;
  adminApp = initializeAdminApp({projectId}, prefix+'-admin'); adminDb = getAdminFirestore(adminApp); adminAuth = getAdminAuth(adminApp);
  const password = randomUUID()+'A1!'; uid=prefix;
  await adminAuth.createUser({uid, email:prefix+'@example.invalid',password});
  await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk'); gateway.db=getFirestore(app); connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);
  const auth=getAuth(app); connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  await signInWithEmailAndPassword(auth,prefix+'@example.invalid',password);
  expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:false});
 },90_000);
 async function fixture(suffix:string, boxCompany='taebaek', unitCompany=boxCompany, boxStock=2) {
  const boxItemId=`${prefix}-${suffix}-box`,unitItemId=`${prefix}-${suffix}-unit`,operationId=`${prefix}-${suffix}-move`;
  for(const path of [`items/${boxItemId}`,`items/${unitItemId}`,`itemUnpackMovements/${operationId}`]) paths.add(path);
  await adminDb!.doc(`items/${boxItemId}`).create({companyId:boxCompany,name:'합성 박스',type:'product',spec:'20kg',stock:boxStock,lots:[boxLot]});
  await adminDb!.doc(`items/${unitItemId}`).create({companyId:unitCompany,name:'합성 낱개',type:'product',spec:'1kg',stock:0,lots:[]});
  return {boxItemId,unitItemId,operationId,count:20};
 }
 async function state(request:Awaited<ReturnType<typeof fixture>>) {
  const [box,unit,move]=await Promise.all([adminDb!.doc(`items/${request.boxItemId}`).get(),adminDb!.doc(`items/${request.unitItemId}`).get(),adminDb!.doc(`itemUnpackMovements/${request.operationId}`).get()]);
  return {box:box.data(),unit:unit.data(),move:move.data()};
 }
 afterAll(async () => {
  const errors:string[]=[];
  if(adminDb)for(const path of paths){try{if(!path.includes(prefix))throw new Error('경로 범위');await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}
  if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push('합성 사용자');}}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);
  expect(errors).toEqual([]);
 },90_000);
 it('실제 로그인으로 세 문서를 원자 개봉하며 동시 재시도와 payload 충돌을 구분한다',async()=>{
  const request=await fixture('own');
  const results=await Promise.all([unpackBoxStock(request),unpackBoxStock(request)]);
  expect(results.every(result=>result.ok)).toBe(true);
  const saved=await state(request);expect(saved.box?.stock).toBe(1);expect(saved.unit?.stock).toBe(20);
  expect(saved.box?.lots[0].qtyRemaining).toBe(1);
  expect(saved.unit?.lots).toHaveLength(1);expect(saved.unit?.lots[0]).toMatchObject({supplierName:'합성 공급처',lotNo:'TEST-LOT',qtyRemaining:20,unitKg:1,kgRemaining:20});
  expect(saved.move).toMatchObject({companyId:'taebaek',boxItemId:request.boxItemId,unitItemId:request.unitItemId,count:20,boxQty:1});
  expect((await unpackBoxStock(request)).ok).toBe(true);expect(await state(request)).toEqual(saved);
  expect((await unpackBoxStock({...request,count:10})).ok).toBe(false);expect(await state(request)).toEqual(saved);
 },60_000);
 it('타 회사 두 품목과 혼합 회사 요청은 원본 및 이동 문서를 전혀 변경하지 않는다',async()=>{
  for(const [suffix,boxCompany,unitCompany] of [['foreign','punghoe','punghoe'],['mixed','taebaek','punghoe']]){
   const request=await fixture(suffix,boxCompany,unitCompany);const before=await state(request);
   const result=await unpackBoxStock(request);expect(result.ok).toBe(false);expect(result.message).toMatch(/permission|권한/i);
   expect(await state(request)).toEqual(before);expect(before.move).toBeUndefined();
  }
 },60_000);
 it('재고와 로트가 불일치하면 실제 거래에서 양쪽 품목 및 이동 근거가 모두 불변이다',async()=>{
  const request=await fixture('invalid','taebaek','taebaek',3);const before=await state(request);
  const result=await unpackBoxStock(request);expect(result).toMatchObject({ok:false});expect(result.message).toContain('실사');
  expect(await state(request)).toEqual(before);expect(before.move).toBeUndefined();
 },60_000);
});
