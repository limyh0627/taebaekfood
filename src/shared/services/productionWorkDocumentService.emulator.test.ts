import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { replaceProductionWorkDocument, type ProductionDocumentWrite } from './productionWorkDocumentService';
import { emptyProductionWorkFields, newProductionWorkDocument, mergeProductionWorkEvidence } from '../../features/production-documents/domain/productionWorkDocument';
const gateway = vi.hoisted(() => ({ db: undefined as any, auth: undefined as any }));
vi.mock('../firebase', () => ({ get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve() }));
describe.skipIf(process.env.PRODUCTION_DOCUMENT_EMULATOR_TEST !== 'true')('생산 문서 실제 Auth·원자 revision', () => {
 const projectId='demo-taebaekfood-local', prefix='production-doc-'+randomUUID();
 const seed=parseInt(randomUUID().slice(0,8),16), date=String(7000+seed%2000)+'-'+String(1+seed%12).padStart(2,'0')+'-'+String(1+seed%28).padStart(2,'0');
 let app:any,adminApp:any,adminDb:any,adminAuth:any,createdUid:string|undefined;
 const paths=new Set<string>();let header:ReturnType<typeof newProductionWorkDocument>, lines:ReturnType<typeof mergeProductionWorkEvidence>;
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Auth 주소 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  const password=randomUUID()+'A1!',email=prefix+'@example.invalid';const user=await adminAuth.createUser({uid:prefix,email,password});createdUid=user.uid;
  await adminAuth.setCustomUserClaims(user.uid,{employeeId:user.uid,companyId:'taebaek',isAdmin:false});
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});await signInWithEmailAndPassword(gateway.auth,email,password);
  expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims.companyId).toBe('taebaek');
  header=newProductionWorkDocument('taebaek',date,prefix,new Date().toISOString());
  // 문서 ID 정책은 회사와 날짜 고정이다. UUID 사용자/행과 무작위 먼 미래 날짜를 쓰고 기존 문서 부재를 먼저 확인한다.
  expect((await adminDb.doc('productionWorkDocuments/'+header.id).get()).exists).toBe(false);paths.add('productionWorkDocuments/'+header.id);
  lines=mergeProductionWorkEvidence(header,[],[{companyId:'taebaek',key:prefix,batchKey:prefix,reversed:false,fields:{...emptyProductionWorkFields(),manufacturedDate:date,itemNameSnapshot:'합성 생산',productionQty:20,productionUnit:'개'},source:{kind:'production',sourceId:prefix,operationId:prefix,ledgerId:'',lotId:'',recordedAt:new Date().toISOString()}}],new Date().toISOString());
  for(const row of lines)paths.add('productionWorkDocumentLines/'+row.id);
 },90000);
 afterAll(async()=>{
  const errors:string[]=[];if(adminDb)for(const path of paths){try{await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path);}}
  if(createdUid&&adminAuth){await adminAuth.deleteUser(createdUid);await expect(adminAuth.getUser(createdUid)).rejects.toMatchObject({code:'auth/user-not-found'});}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);
 },90000);
 it('직원 인증으로 헤더·행 원자 생성하고 같은 expectedRevision 동시 저장은 한 번만 성공한다',async()=>{
  const initial=await replaceProductionWorkDocument({...header},lines.map(row=>({...row})),0);expect(initial.header.revision).toBe(1);
  const results=await Promise.allSettled([replaceProductionWorkDocument({...initial.header,specialNotes:'첫 번째'},initial.lines,1),replaceProductionWorkDocument({...initial.header,specialNotes:'두 번째'},initial.lines,1)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect((await adminDb.doc('productionWorkDocuments/'+header.id).get()).data().revision).toBe(2);
  expect((await adminDb.doc('productionWorkDocumentLines/'+lines[0].id).get()).data().documentRevision).toBe(2);
 },30000);
 it('회사 위조·행 연결 위조·부모 없는 직접 행 쓰기를 거절하고 원문을 보존한다',async()=>{
  const path='productionWorkDocuments/'+header.id,before=(await adminDb.doc(path).get()).data() as ProductionDocumentWrite;
  await expect(replaceProductionWorkDocument({...header,companyId:'punghoe'},[],0)).rejects.toThrow('다른 회사');
  await expect(replaceProductionWorkDocument({...before},[{...lines[0],companyId:'punghoe'}],2)).rejects.toThrow('다른 회사');
  await expect(setDoc(doc(gateway.db,'productionWorkDocumentLines',lines[0].id),{...lines[0],documentRevision:3,productionQty:999})).rejects.toMatchObject({code:'permission-denied'});
  const foreignId='punghoe__production-work__'+date,foreignPath='productionWorkDocuments/'+foreignId;
  expect((await adminDb.doc(foreignPath).get()).exists).toBe(false);paths.add(foreignPath);await adminDb.doc(foreignPath).create({...header,id:foreignId,companyId:'punghoe'});
  await expect(getDoc(doc(gateway.db,'productionWorkDocuments',foreignId))).rejects.toMatchObject({code:'permission-denied'});
  expect((await adminDb.doc(path).get()).data()).toEqual(before);expect((await adminDb.doc('productionWorkDocumentLines/'+lines[0].id).get()).data().productionQty).toBe(20);
 },30000);
 it('다음 revision에서 행 삭제까지 같은 transaction으로 교체한다',async()=>{
  const before=(await adminDb.doc('productionWorkDocuments/'+header.id).get()).data() as ProductionDocumentWrite;
  const saved=await replaceProductionWorkDocument({...before},[],2);expect(saved.header.rowCount).toBe(0);expect(saved.header.revision).toBe(3);expect((await adminDb.doc('productionWorkDocumentLines/'+lines[0].id).get()).exists).toBe(false);
 },30000);
});
