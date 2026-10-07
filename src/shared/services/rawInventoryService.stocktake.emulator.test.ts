import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {executeRawInventoryCommand} from './rawInventoryService';
import {inventoryDocId,operationDocId,type RawInventoryCommand} from '../rawInventoryCore';
import type {CompanyId} from '../types';
describe.skipIf(process.env.RAW_STOCKTAKE_EMULATOR_TEST!=='true')('원료 실사 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='raw-stocktake-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();const gateway:{db:any}={db:undefined};
 async function seed(suffix:string,companyId:CompanyId='taebaek'){
  const itemId=prefix+'-'+suffix,operationId=prefix+'-'+suffix+'-op';
  const locations=['items/'+itemId,'rawInventories/'+inventoryDocId(companyId,itemId),'rawMaterialLedger/'+operationDocId(operationId)];
  for(const location of locations)paths.add(location);
  const lot={id:prefix+'-'+suffix+'-lot',material:'합성 원료',supplierName:'합성 공급처',kgIn:100,kgRemaining:100,receivedDate:'2026-09-01',status:'active',createdAt:'2026-09-01T00:00:00Z'};
  await adminDb!.doc(locations[0]).create({companyId,name:'합성 원료',stock:80,lots:[lot]});
  await adminDb!.doc(locations[1]).create({id:inventoryDocId(companyId,itemId),companyId,rawItemId:itemId,materialSnapshot:'합성 원료',stockKg:100,revision:1,lastProcessedAt:'2026-09-01T00:00:00Z',activeLots:[lot],recentDepletedLots:[]});
  const command:RawInventoryCommand={operationId,companyId,rawItemId:itemId,materialSnapshot:'합성 원료',effectiveAt:'2026-10-07T01:00:00Z',source:{type:'manual',id:operationId},kind:'stocktake',targetKg:0};
  return {locations,command};
 }
 const read=async(locations:string[])=>Promise.all(locations.map(async location=>(await adminDb!.doc(location).get()).data()));
 const execute=(command:RawInventoryCommand)=>executeRawInventoryCommand(command,{db:gateway.db,now:'2026-10-07T02:00:00Z'});
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
 afterAll(async()=>{const errors:string[]=[];if(adminDb)for(const location of paths){try{const ownedSnap=await adminDb.doc(location).get();if(ownedSnap.exists && !location.includes(prefix) && !ownedSnap.data()?.operationId?.includes(prefix))throw new Error('범위');await adminDb.doc(location).delete();expect((await adminDb.doc(location).get()).exists).toBe(false);}catch{errors.push(location);}}
 if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
 if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);},90_000);


 it('0kg 실사는 본체·원장·품목 미러를 함께 맞추고 앵커를 기록한다',async()=>{
  const {locations,command}=await seed('own');expect((await execute(command)).status).toBe('applied');
  const [item,state,movement]=await read(locations);expect(item!.stock).toBe(0);expect(state!.stockKg).toBe(0);expect(state!.revision).toBe(2);expect(state!.stocktakeAnchor).toMatchObject({operationId:command.operationId,sequence:2});expect(movement).toMatchObject({companyId:'taebaek',kind:'stocktake',targetKg:0,balanceAfterKg:0,sequence:2});
 },60_000);
 it('같은 요청 재전송과 다른 목표 충돌은 세 문서에 추가 쓰기를 남기지 않는다',async()=>{
  const {locations,command}=await seed('retry');expect((await execute(command)).status).toBe('applied');const before=await read(locations);const snapshots=await Promise.all(locations.map(location=>adminDb!.doc(location).get()));
  expect((await execute(command)).status).toBe('duplicate');expect((await execute({...command,targetKg:5})).status).toBe('conflict');expect(await read(locations)).toEqual(before);
  const after=await Promise.all(locations.map(location=>adminDb!.doc(location).get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(snapshots[index].updateTime!)).toBe(true));
 },60_000);
 it('타회사 Rules 거절은 두 기존 문서를 보존하고 새 원장을 생성하지 않는다',async()=>{
  const {locations,command}=await seed('foreign','punghoe');const before=await read(locations);await expect(execute(command)).rejects.toMatchObject({code:'permission-denied'});expect(await read(locations)).toEqual(before);expect((await adminDb!.doc(locations[2]).get()).exists).toBe(false);
 },60_000);
});
