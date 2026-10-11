import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8182';
let env:RulesTestEnvironment;
describe.skipIf(!enabled)('잠금 복구 영수증의 서버 전용 저장',{timeout:30000},()=>{
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-recovery-rules-'+randomUUID(),firestore:{host:'127.0.0.1',port:8182,rules:readFileSync('firestore.rules','utf8')}});
 await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'orderLockRecoveryOperations','own'),{companyId:'taebaek',status:'recovered',inventoryApplied:'none'});});});
 afterAll(async()=>{await env.clearFirestore();await env.cleanup();});
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
