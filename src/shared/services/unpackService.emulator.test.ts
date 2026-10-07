import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {unpack} from './unpackService';
import {inventoryDocId} from '../rawInventoryCore';
import type {CompanyId} from '../types';
const gateway=vi.hoisted(()=>({db:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;}}));
describe.skipIf(process.env.CAN_UNPACK_EMULATOR_TEST!=='true')('캔 개봉 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='can-unpack-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();
 async function seed(suffix:string,canCompany:CompanyId='taebaek',bulkCompany:CompanyId=canCompany,mirror=100){
  const can=prefix+'-'+suffix+'-can',bulk=prefix+'-'+suffix+'-bulk';
  const locations=['items/'+can,'items/'+bulk,'rawInventories/'+inventoryDocId(bulkCompany,bulk)];
  const docs=[{companyId:canCompany,stock:3,lots:[]},{companyId:bulkCompany,name:'합성 원료',stock:mirror,lots:[]},
   {companyId:bulkCompany,rawItemId:bulk,materialSnapshot:'합성 원료',stockKg:100,revision:1,lastProcessedAt:'2026-09-01T00:00:00Z',activeLots:[{id:prefix+'-'+suffix+'-lot',material:'합성 원료',supplierName:'합성 공급처',kgIn:100,kgRemaining:100,receivedDate:'2026-09-01',status:'active',createdAt:'2026-09-01T00:00:00Z'}],recentDepletedLots:[]}];
  for(let i=0;i<locations.length;i++){paths.add(locations[i]);await adminDb!.doc(locations[i]).create(docs[i]);}
  return {locations,plan:{canItemId:can,canName:'합성 캔',cans:1,bulkItemId:bulk,bulkName:'합성 원료',bulkUnit:'kg',perCan:16.5,bulkQty:16.5,discarded:[]}};
 }
 const read=async(locations:string[])=>Promise.all(locations.map(async location=>(await adminDb!.doc(location).get()).data()));
 async function movements(canId:string){const all=await adminDb!.collection('rawMaterialLedger').get();return all.docs.filter(doc=>doc.data().operationId?.startsWith('unpack:'+canId+':'));}
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

 it('자기 회사 캔·벌크 사본·원료 본체·이동 원장을 함께 갱신한다',async()=>{
  const {locations,plan}=await seed('own');expect((await unpack(plan)).ok).toBe(true);
  const [can,bulk,state]=await read(locations);expect(can!.stock).toBe(2);expect(bulk!.stock).toBe(116.5);expect(state!.stockKg).toBe(116.5);expect(state!.revision).toBe(2);
  const rows=await movements(plan.canItemId);for(const row of rows)paths.add(row.ref.path);expect(rows).toHaveLength(1);expect(rows[0].data()).toMatchObject({companyId:'taebaek',balanceAfterKg:116.5});
 },60_000);
 it('타회사와 회사 혼합은 거절하며 모든 원문과 새 이동 기록 부재를 유지한다',async()=>{
  for(const scenario of ['foreign','mixed']){const {locations,plan}=await seed(scenario,scenario==='foreign'?'punghoe':'taebaek','punghoe');const before=await read(locations);expect((await unpack(plan)).ok).toBe(false);expect(await read(locations)).toEqual(before);expect(await movements(plan.canItemId)).toHaveLength(0);}
 },60_000);
 it('원료 미러 불일치 실패는 캔·벌크·본체를 보존하고 이동 기록을 생성하지 않는다',async()=>{
  const {locations,plan}=await seed('mirror','taebaek','taebaek',99);const before=await read(locations);const result=await unpack(plan);expect(result.ok).toBe(false);expect(result.message).toContain('어긋나');expect(await read(locations)).toEqual(before);expect(await movements(plan.canItemId)).toHaveLength(0);
 },60_000);
});
