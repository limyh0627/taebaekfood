import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,it} from 'vitest';
import {initializeTestEnvironment,assertSucceeds,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,getDocs,collection} from 'firebase/firestore';
let env:RulesTestEnvironment;const id='MSG-share-'+randomUUID();
describe.skipIf(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8182')('공유 UUID의 최초 부재 조회',{timeout:30000},()=>{
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-share-rules-'+randomUUID(),firestore:{host:'127.0.0.1',port:8182,rules:readFileSync('firestore.rules','utf8')}});});
 afterAll(async()=>{await env.clearFirestore();await env.cleanup();});
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
