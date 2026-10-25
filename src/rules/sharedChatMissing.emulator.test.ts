import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../test/emulatorTestPolicy';
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let assertSucceeds:typeof import('@firebase/rules-unit-testing').assertSucceeds;
let assertFails:typeof import('@firebase/rules-unit-testing').assertFails;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let getDocs:typeof import('firebase/firestore').getDocs;
let collection:typeof import('firebase/firestore').collection;
const policy=createEmulatorTestPolicy(process.env,'sharedChatMissing',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeTestEnvironment,assertSucceeds,assertFails}=await import('@firebase/rules-unit-testing'));
  ({doc,getDoc,setDoc,getDocs,collection}=await import('firebase/firestore'));
  policy.assertCurrentEnvironment(process.env);
}
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  await env.clearFirestore();
}
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,it} from 'vitest';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';

let env:RulesTestEnvironment;let id:string;
describe.skipIf(!policy.enabled||policy.port!==8182)('공유 UUID의 최초 부재 조회',{timeout:30000},()=>{
 beforeAll(async()=>{
  await loadRuntime();
  id='MSG-share-'+randomUUID();
  env=await initializeTestEnvironment({projectId:policy.projectId,firestore:{host:policy.host,port:policy.port,rules:readFileSync('firestore.rules','utf8')}});
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
 });
 afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup()]);});
 it('양사 직원·관리자는 정확 공유 UUID의 없는 문서만 단건 확인한다',async()=>{
 for(const companyId of ['taebaek','punghoe']) for(const isAdmin of [true,false]){
 const db=env.authenticatedContext(companyId+isAdmin,{companyId,isAdmin,employeeId:'employee'}).firestore();
 await assertSucceeds(getDoc(doc(db,'chatMessages',id)));
 await assertFails(getDoc(doc(db,'chatMessages','MSG-share-invalid')));
 await assertFails(getDoc(doc(db,'chatMessages','ordinary-missing')));
 await assertFails(getDocs(collection(db,'chatMessages')));
 }
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'chatMessages',id)));
 });
 it('같은 UUID라도 존재하는 타회사 문서에는 부재 권한이 적용되지 않는다',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'chatMessages',id),{companyId:'punghoe',roomId:'synthetic-room',text:'원문'}));
 const own=env.authenticatedContext('own',{companyId:'punghoe',isAdmin:true,employeeId:'own'}).firestore();
 const other=env.authenticatedContext('other',{companyId:'taebaek',isAdmin:true,employeeId:'other'}).firestore();
 await assertSucceeds(getDoc(doc(own,'chatMessages',id)));await assertFails(getDoc(doc(other,'chatMessages',id)));
 });
});
