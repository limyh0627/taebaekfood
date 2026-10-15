import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,updateDoc,getDocs,collection,query,where} from 'firebase/firestore';
const enabled=await fetch('http://127.0.0.1:8082/',{signal:AbortSignal.timeout(1000)}).then(r=>r.status<500).catch(()=>false),projectId='demo-retire-rules-'+randomUUID().slice(0,8);
let env:RulesTestEnvironment;const paths=['employees/employee','employees/removable','retirementProfiles/taebaek__employee','retirementEvents/event','retirementCommandReceipts/receipt'];
const rows=[{companyId:'taebaek',status:'working'},{companyId:'taebaek',status:'working'},{companyId:'taebaek',employeeId:'employee'},{companyId:'taebaek',employeeId:'employee'},{companyId:'taebaek',employeeId:'employee'}];
const actor=(companyId:string,isAdmin:boolean)=>env.authenticatedContext(companyId+'-'+isAdmin,{companyId,isAdmin,employeeId:'admin'}).firestore();
describe.skipIf(!enabled)('퇴직금 관리자 회사별 읽기·서버 전용 쓰기 Rules',()=>{
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});await env.withSecurityRulesDisabled(async c=>{for(let i=0;i<paths.length;i++)await setDoc(doc(c.firestore(),paths[i]),rows[i]);});});
 afterAll(async()=>{if(!env)return;await env.withSecurityRulesDisabled(async c=>{for(const path of paths)await deleteDoc(doc(c.firestore(),path));});await env.cleanup();});
 it('같은 회사 관리자만 세 컬렉션을 읽고 직원·타회사·미인증은 거절한다',async()=>{for(const name of['retirementProfiles','retirementEvents','retirementCommandReceipts']){const path=paths.find(p=>p.startsWith(name+'/'))!;await assertSucceeds(getDoc(doc(actor('taebaek',true),path)));for(const db of[actor('taebaek',false),actor('punghoe',true),env.unauthenticatedContext().firestore()])await assertFails(getDoc(doc(db,path)));await assertSucceeds(getDocs(query(collection(actor('taebaek',true),name),where('companyId','==','taebaek'))));await assertFails(getDocs(collection(actor('taebaek',true),name)));}});
 it('관리자도 직접 CRUD로 확정·이력을 우회하지 못한다',async()=>{const db=actor('taebaek',true);for(const path of paths.slice(2)){await assertFails(setDoc(doc(db,path),{companyId:'taebaek',employeeId:'employee',revision:99}));await assertFails(deleteDoc(doc(db,path)));await assertFails(setDoc(doc(db,path+'-new'),{companyId:'taebaek',employeeId:'employee'}));}});
 it('장부가 생긴 직원은 삭제하지 못하고 퇴사 상태와 원입사일은 일반관리경로로 보존한다',async()=>{const db=actor('taebaek',true);await assertFails(deleteDoc(doc(db,'employees/employee')));await assertSucceeds(updateDoc(doc(db,'employees/employee'),{status:'retired'}));expect((await getDoc(doc(db,'employees/employee'))).data()?.status).toBe('retired');await assertSucceeds(deleteDoc(doc(db,'employees/removable')));});
});
