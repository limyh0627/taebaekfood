import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';
import {initializeApp as clientApp,deleteApp,type FirebaseApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {authorizeOrderCopy,listOrderInterpretationRulesCommand,reviewOrderInterpretationRuleCommand,submitOrderCopyCommand} from './orderCopyCommands';
const actor=(companyId='taebaek',isAdmin=false)=>({uid:'uid',token:{companyId,employeeId:'employee',isAdmin}});
it('직원 submit과 관리자 승인 권한을 구분한다',()=>{expect(authorizeOrderCopy(actor()).companyId).toBe('taebaek');expect(()=>authorizeOrderCopy(actor(),true)).toThrow();expect(authorizeOrderCopy(actor('punghoe',true),true).companyId).toBe('punghoe');});
it.each([null,{uid:'uid',token:{}},actor('foreign'),{uid:'uid',token:{companyId:'taebaek',employeeId:''}}, {uid:'bad/uid',token:{companyId:'taebaek',employeeId:'employee'}}])('인증 없는 또는 잘못된 회사 범위를 거절한다',auth=>expect(()=>authorizeOrderCopy(auth)).toThrow());
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082'&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099';
describe.skipIf(!enabled)('Auth SDK 토큰을 실제 callable handler 권한에 전달',()=>{
 let app:admin.app.App,accounts:admin.app.App,client:FirebaseApp;const uid=`copy-auth-${randomUUID()}`;let auth:any;
 beforeAll(async()=>{const projectId=`demo-copy-auth-${randomUUID()}`;app=admin.initializeApp({projectId});accounts=admin.initializeApp({projectId:'demo-recovery28-order-copy'},uid);const email=`${uid}@example.test`;await accounts.auth().createUser({uid,email,password:'synthetic-test-only-password'});await accounts.auth().setCustomUserClaims(uid,{companyId:'taebaek',employeeId:'employee',isAdmin:false});client=clientApp({projectId:'demo-recovery28-order-copy',apiKey:'demo-key'},uid);const session=getAuth(client);connectAuthEmulator(session,'http://127.0.0.1:9099',{disableWarnings:true});const signed=await signInWithEmailAndPassword(session,email,'synthetic-test-only-password');const token=await accounts.auth().verifyIdToken(await signed.user.getIdToken(true));auth={uid,token};},30000);
 afterAll(async()=>{if(client)await deleteApp(client);if(accounts){await accounts.auth().deleteUser(uid);await expect(accounts.auth().getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});await accounts.delete();}if(app)await app.delete();});
 it('검증된 직원token은 승인조회만 허용하고 타회사조회·approve·미인증submit을거절한다',async()=>{
  expect(await listOrderInterpretationRulesCommand.run({data:{companyId:'taebaek'},auth} as any)).toEqual([]);
  expect(await submitOrderCopyCommand.run({data:{action:'inspect',reference:{companyId:'taebaek',requestId:'auth-inspect'}},auth} as any)).toMatchObject({status:'unknown',requestHash:null});
  await expect(submitOrderCopyCommand.run({data:{action:'inspect',reference:{companyId:'punghoe',requestId:'auth-inspect'}},auth} as any)).rejects.toThrow('회사');
  await expect(listOrderInterpretationRulesCommand.run({data:{companyId:'punghoe'},auth} as any)).rejects.toThrow('다른 회사');
  await expect(listOrderInterpretationRulesCommand.run({data:{companyId:'taebaek',includeAll:true},auth} as any)).rejects.toThrow('권한');
  await expect(reviewOrderInterpretationRuleCommand.run({data:{companyId:'taebaek'},auth} as any)).rejects.toThrow('권한');
  await expect(submitOrderCopyCommand.run({data:{}} as any)).rejects.toThrow('로그인');
 });
});

it.each(['inspect','stop','listHistory'])('복구 %s도 인증 없는 호출은 조회·중단 전에 거절한다',async action=>{await expect(submitOrderCopyCommand.run({data:{action,reference:{companyId:'taebaek',requestId:'auth-request'},companyId:'taebaek'}} as any)).rejects.toThrow('로그인');});
