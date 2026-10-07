import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator,getFirestore,collection,query,where,getDocs} from 'firebase/firestore';
import {initializeApp as initializeAdminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {getFirestore as getAdminFirestore} from 'firebase-admin/firestore';
import {fetchWhereIn,fetchByIds} from './firebaseService';
import {OrderStatus,type Order} from '../types';
import {CATALOG_DELETE_BLOCKING_STATUSES,catalogItemDeleteBlockers} from '../../features/admin/catalogItemDelete';
const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve(),functions:undefined}));
describe.skipIf(process.env.CATALOG_QUERY_EMULATOR_TEST!=='true')('품목 삭제 조회 실제 Auth·Rules 회사 경계',()=>{
 const projectId='demo-taebaekfood-local',prefix='catalog-query-'+randomUUID();
 let app:ReturnType<typeof initializeApp>|undefined,adminApp:ReturnType<typeof initializeAdminApp>|undefined,adminDb:ReturnType<typeof getAdminFirestore>|undefined,adminAuth:ReturnType<typeof getAdminAuth>|undefined;
 let uid:string|undefined;const paths=new Set<string>();
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw new Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw new Error('Auth 주소 불일치');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw new Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  uid=prefix;const password=randomUUID()+'A1!',email=prefix+'@example.invalid';await adminAuth.createUser({uid,email,password});await adminAuth.setCustomUserClaims(uid,{employeeId:uid,companyId:'taebaek',isAdmin:true});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});
  await signInWithEmailAndPassword(gateway.auth,email,password);expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({employeeId:uid,companyId:'taebaek',isAdmin:true});
  for(const [suffix,companyId,status] of [['own','taebaek',OrderStatus.PENDING],['foreign','punghoe',OrderStatus.PENDING],['done','taebaek',OrderStatus.DELIVERED]] as const){const path=`orders/${prefix}-${suffix}`;paths.add(path);await adminDb.doc(path).create({companyId,status,partnerName:'합성 거래처',items:[{itemId:prefix+'-item',quantity:1}],createdAt:'2026-10-01T00:00:00Z'});}
 },90_000);
 afterAll(async()=>{const errors:string[]=[];if(adminDb)for(const path of paths){try{if(!path.includes(prefix))throw new Error('범위');await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}
 if(uid&&adminAuth){try{await adminAuth.deleteUser(uid);await expect(adminAuth.getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(uid);}}
 if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);},90_000);
 it('문서 ID 조회도 실제 인증 회사 조건이 필요하며 타회사 요청은 거절한다',async()=>{
  const ids=[prefix+'-own',prefix+'-done'];
  const mixed=[...ids,prefix+'-foreign'];
  await expect(fetchByIds<Order>('orders',mixed)).rejects.toMatchObject({code:'permission-denied'});
  const own=await fetchByIds<Order>('orders',ids,'taebaek');
  expect(own.map(row=>row.id).sort()).toEqual([...ids].sort());
  expect(own.every(row=>row.companyId==='taebaek')).toBe(true);
  await expect(fetchByIds<Order>('orders',[prefix+'-foreign'],'punghoe')).rejects.toMatchObject({code:'permission-denied'});
 },60_000);
 it('상태만 조회하면 Rules가 거절하고 공용 회사 조회는 자기 진행 주문만 반환한다',async()=>{
  await expect(getDocs(query(collection(gateway.db,'orders'),where('status','in',[...CATALOG_DELETE_BLOCKING_STATUSES])))).rejects.toMatchObject({code:'permission-denied'});
  const rows=await fetchWhereIn<Order>('orders','status',CATALOG_DELETE_BLOCKING_STATUSES,'taebaek');
  const scoped=rows.filter(row=>row.id.startsWith(prefix));expect(scoped.map(row=>row.id)).toEqual([prefix+'-own']);
  expect(rows.every(row=>row.companyId==='taebaek')).toBe(true);expect(catalogItemDeleteBlockers(prefix+'-item',rows).map(row=>row.id)).toEqual([prefix+'-own']);
  await expect(fetchWhereIn<Order>('orders','status',CATALOG_DELETE_BLOCKING_STATUSES,'punghoe')).rejects.toMatchObject({code:'permission-denied'});
 },60_000);
});
