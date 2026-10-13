import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it} from 'vitest';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc} from 'firebase/firestore';
const enabled=process.env.ORDER_COPY_RULES_TEST==='true';let env:RulesTestEnvironment;
const names=['orderCopyOperations','orderInterpretationRules'];
describe.skipIf(!enabled)('복사주문 원문·승인 규칙 서버전용 Rules',()=>{
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId:`demo-copy-rules-${randomUUID()}`,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});await env.withSecurityRulesDisabled(async ctx=>{for(const name of names)await setDoc(doc(ctx.firestore(),name,'proof'),{companyId:'taebaek',actorUid:'uid',status:'approved'});});},30000);
 afterAll(async()=>{if(!env)return;await env.withSecurityRulesDisabled(async ctx=>{for(const name of names)await deleteDoc(doc(ctx.firestore(),name,'proof'));});await env.cleanup();});
 for(const companyId of ['taebaek','punghoe'])for(const isAdmin of [false,true])it(`${companyId} ${isAdmin?'관리자':'직원'} 직접조회·위조·수정·삭제 차단`,async()=>{const db=env.authenticatedContext('uid',{companyId,employeeId:'employee',isAdmin}).firestore();for(const name of names){const ref=doc(db,name,'proof');await assertFails(getDoc(ref));await assertFails(getDocs(collection(db,name)));await assertFails(setDoc(doc(db,name,'new'),{companyId,status:'approved'}));await assertFails(updateDoc(ref,{status:'approved'}));await assertFails(deleteDoc(ref));await assertFails(setDoc(doc(db,name,'proof','private','child'),{companyId}));}});
});
