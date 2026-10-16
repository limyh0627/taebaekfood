import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,deleteDoc,doc,getDoc,getDocs,query,setDoc,updateDoc,where} from 'firebase/firestore';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {helpUsageId,reserveHelpUsage} from '../../functions/src/helpChat';
const active=process.env.HELP_CHAT_RULES_TEST==='true';
const project='demo-help-'+randomUUID().slice(0,8),id='a'.repeat(64);let env:RulesTestEnvironment;
let server:App;let reservations:Promise<PromiseSettledResult<void>[]>|undefined;
describe.skipIf(!active)('도움말 사용량 클라이언트 접근 전면 차단',()=>{
 beforeAll(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('격리 Firestore 주소를 확인하세요.');env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});server=initializeApp({projectId:project},project);await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'helpChatUsage',id),{companyId:'taebaek',minute:1,day:'2026-10-17',minuteCount:1,dayCount:1});await setDoc(doc(ctx.firestore(),'helpChatUsage',id,'child','one'),{companyId:'taebaek'});});});
 afterAll(async()=>{if(env){if(reservations)await reservations;await env.withSecurityRulesDisabled(async ctx=>{await deleteDoc(doc(ctx.firestore(),'helpChatUsage',id,'child','one'));await deleteDoc(doc(ctx.firestore(),'helpChatUsage',id));await deleteDoc(doc(ctx.firestore(),'helpChatUsage',helpUsageId(project)));expect((await getDocs(collection(ctx.firestore(),'helpChatUsage'))).empty).toBe(true);});await env.cleanup();}if(server)await deleteApp(server);});
 it('실제 TX의 동시11예약은 정확10개만 반영하고 UID원문을 저장하지 않는다',async()=>{const db=getFirestore(server);reservations=Promise.allSettled(Array.from({length:11},()=>reserveHelpUsage(db,project,0)));const result=await reservations;expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(10);expect(result.filter(r=>r.status==='rejected')).toHaveLength(1);const row=(await db.collection('helpChatUsage').doc(helpUsageId(project)).get()).data();expect(row).toEqual({minute:0,day:'1970-01-01',minuteCount:10,dayCount:10});},60000);
 it.each(['anonymous','taebaek-admin','taebaek-staff','punghoe-admin','punghoe-staff'])('%s: get/list/create/update/delete와 하위문서 모두 거절',async role=>{const companyId=role.startsWith('punghoe')?'punghoe':'taebaek';const db=role==='anonymous'?env.unauthenticatedContext().firestore():env.authenticatedContext(role,{companyId,employeeId:role,isAdmin:role.endsWith('admin')}).firestore();for(const ref of [doc(db,'helpChatUsage',id),doc(db,'helpChatUsage',id,'child','one')]){await assertFails(getDoc(ref));await assertFails(updateDoc(ref,{minuteCount:2}));await assertFails(deleteDoc(ref));}await assertFails(getDocs(query(collection(db,'helpChatUsage'),where('companyId','==',companyId))));await assertFails(getDocs(collection(db,'helpChatUsage',id,'child')));await assertFails(setDoc(doc(db,'helpChatUsage','new-'+role),{companyId}));await assertFails(setDoc(doc(db,'helpChatUsage',id,'child','new-'+role),{companyId}));});
});
