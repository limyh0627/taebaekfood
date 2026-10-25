import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../test/emulatorTestPolicy';
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let assertFails:typeof import('@firebase/rules-unit-testing').assertFails;
let assertSucceeds:typeof import('@firebase/rules-unit-testing').assertSucceeds;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let updateDoc:typeof import('firebase/firestore').updateDoc;
let deleteDoc:typeof import('firebase/firestore').deleteDoc;
const policy=createEmulatorTestPolicy(process.env,'orderLockRecovery',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeTestEnvironment,assertFails,assertSucceeds}=await import('@firebase/rules-unit-testing'));
  ({doc,getDoc,setDoc,updateDoc,deleteDoc}=await import('firebase/firestore'));
  policy.assertCurrentEnvironment(process.env);
}
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  await env.clearFirestore();
}
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';

const enabled=policy.enabled&&policy.port===8182;
let env:RulesTestEnvironment;
describe.skipIf(!enabled)('잠금 복구 영수증의 서버 전용 저장',{timeout:30000},()=>{
 beforeAll(async()=>{
  await loadRuntime();
  env=await initializeTestEnvironment({projectId:policy.projectId,firestore:{host:policy.host,port:policy.port,rules:readFileSync('firestore.rules','utf8')}});
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
 await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'orderLockRecoveryOperations','own'),{companyId:'taebaek',status:'recovered',inventoryApplied:'none'});});});
 afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup()]);});
 it.each([['taebaek',true],['punghoe',true],['taebaek',false],['punghoe',false]] as const)('%s 관리자=%s 직접 생성·수정·삭제를 거절한다',async(companyId,isAdmin)=>{
 const db=env.authenticatedContext(companyId+isAdmin,{companyId,isAdmin,employeeId:'employee'}).firestore();
 await assertFails(setDoc(doc(db,'orderLockRecoveryOperations','new-'+companyId+isAdmin),{companyId,status:'recovered',inventoryApplied:'none'}));
 await assertFails(setDoc(doc(db,'orderLockRecoveryOperations','own'),{companyId,status:'recovered',inventoryApplied:'none'}));
 await assertFails(updateDoc(doc(db,'orderLockRecoveryOperations','own'),{status:'changed'}));
 await assertFails(deleteDoc(doc(db,'orderLockRecoveryOperations','own')));
 if(companyId==='taebaek'&&isAdmin) await assertSucceeds(getDoc(doc(db,'orderLockRecoveryOperations','own')));
 else await assertFails(getDoc(doc(db,'orderLockRecoveryOperations','own')));
 await env.withSecurityRulesDisabled(async ctx=>expect((await getDoc(doc(ctx.firestore(),'orderLockRecoveryOperations','own'))).data()).toEqual({companyId:'taebaek',status:'recovered',inventoryApplied:'none'}));
 });
});
