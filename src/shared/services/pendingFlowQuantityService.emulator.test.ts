import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {updatePendingFlowQuantity} from './pendingFlowQuantityService';
const gateway=vi.hoisted(()=>({db:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;}}));
describe.skipIf(process.env.PENDING_QTY_EMULATOR_TEST!=='true')('대기 수량 실제 Auth·Firestore 계약',()=>{
 const projectId='demo-taebaekfood-local',prefix='pending-qty-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();
 const line={itemId:prefix+'-item',name:'합성 품목',quantity:2,price:50,unit:'병'};
 const edits=(previousQuantity=2,quantity=3.125)=>[{itemId:line.itemId,previousQuantity,quantity}];
 const path=(type:'입고'|'반품',suffix:string)=>`${type==='입고'?'purchaseOrders':'returnRequests'}/${prefix}-${suffix}`;
 async function seed(type:'입고'|'반품',suffix:string,companyId='taebaek',status=type==='입고'?'invoiced':'pending'){
  const location=path(type,suffix);paths.add(location);await adminDb!.doc(location).create({companyId,status,items:[line],linkedStatementId:prefix+'-statement',note:'유지',totalAmount:100});return prefix+'-'+suffix;
 }
 const read=async(type:'입고'|'반품',suffix:string)=>(await adminDb!.doc(path(type,suffix)).get()).data()!;
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
 afterAll(async()=>{const errors:string[]=[];if(adminDb)for(const location of paths){try{if(!location.includes(prefix))throw new Error('범위');await adminDb.doc(location).delete();expect((await adminDb.doc(location).get()).exists).toBe(false);}catch{errors.push(location);}}
 if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
 if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);},90_000);
 it('자기 회사 입고는 수량만, 반품은 수량과 합계만 변경한다',async()=>{
  for(const type of ['입고','반품'] as const){const id=await seed(type,'own');const before=await read(type,'own');await updatePendingFlowQuantity('taebaek',type,id,edits());const after=await read(type,'own');
   expect(after).toEqual({...before,items:[{...line,quantity:3.125}],...(type==='반품'?{totalAmount:156.25}:{})});}
 },60_000);
 it('같은 원본 수량의 동시 수정은 하나만 성공하고 나머지는 최신 원본 충돌로 거절한다',async()=>{
  const id=await seed('입고','race');const results=await Promise.allSettled([updatePendingFlowQuantity('taebaek','입고',id,edits(2,3)),updatePendingFlowQuantity('taebaek','입고',id,edits(2,4))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(String(failed.reason)).toContain('품목이나 수량');
  const saved=await read('입고','race');expect([3,4]).toContain(saved.items[0].quantity);expect(saved.linkedStatementId).toBe(prefix+'-statement');
 },60_000);
 it('타 회사·완료 상태·바뀐 원본은 양쪽 경로에서 거절하고 문서를 보존한다',async()=>{
  for(const type of ['입고','반품'] as const)for(const scenario of ['foreign','done','stale'] as const){const suffix=type+'-'+scenario;const id=await seed(type,suffix,scenario==='foreign'?'punghoe':'taebaek',scenario==='done'?(type==='입고'?'received':'processed'):(type==='입고'?'invoiced':'pending'));const before=await read(type,suffix);
   const result=updatePendingFlowQuantity('taebaek',type,id,edits(scenario==='stale'?1:2));
   if(scenario==='foreign')await expect(result).rejects.toMatchObject({code:'permission-denied'});else await expect(result).rejects.toThrow(scenario==='done'?'대기':'품목이나 수량');expect(await read(type,suffix)).toEqual(before);
  }
 },60_000);
});
