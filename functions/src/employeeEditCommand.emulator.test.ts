import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID,createHash} from 'node:crypto';
import {executeEmployeeEditCommand,employeeEditReceiptId} from './employeeEditCommand';
import {EMPLOYEE_EDIT_OPERATIONS,employeeEditExpected,serializeEmployeeEditRequest,type EmployeeEditRequest,type EmployeeEditReference,type EmployeeProfileDraft,type CatalogValueAdapter} from './shared/employeeEditCommand';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8182';
const actor={uid:'employee-edit-admin',token:{employeeId:'employee-edit-admin',companyId:'taebaek',isAdmin:true}};
const codec:Pick<CatalogValueAdapter,'special'>={special:value=>value instanceof admin.firestore.Timestamp?['timestamp',value.seconds,value.nanoseconds]:undefined};
const profile:EmployeeProfileDraft={name:'수정 직원',position:'직원',department:'생산',joinDate:'과거 형식',birthDate:'',phone:'010',status:'재직',healthCertDate:'',annualLeave:{carryOverLeave:2,bonusLeave:3}};
let app:admin.app.App,db:admin.firestore.Firestore;
const owned=new Set<string>();
const ref=(path:string)=>{owned.add(path);return db.doc(path);};
const reference=(request:EmployeeEditReference):EmployeeEditReference=>({companyId:request.companyId,planId:request.planId,targetId:request.targetId});
const receipt=(request:EmployeeEditReference)=>ref(EMPLOYEE_EDIT_OPERATIONS+'/'+employeeEditReceiptId(request.companyId,actor.uid,request.planId));
const apply=(request:EmployeeEditRequest)=>executeEmployeeEditCommand(db,actor,{mode:'apply',request});
async function fixture(create=false){
 const id='employee-'+randomUUID(),target=ref('employees/'+id),original={companyId:'taebaek',name:'기존 직원',position:'옛 직책',department:'생산',joinDate:'old',birthDate:'',phone:'old',status:'재직',healthCertDate:admin.firestore.Timestamp.fromMillis(10),annualLeave:{carryOverLeave:1,bonusLeave:0,usedLeave:7,custom:{keep:true}},authUid:'login-uid',isAdmin:true,fcmTokens:['device'],salary:777};
 if(!create)await target.set(original);
 const base={version:1 as const,companyId:'taebaek' as const,targetId:id,planId:'plan-'+randomUUID()};
 const request:EmployeeEditRequest=create?{...base,kind:'create',expected:null,profile}:{...base,kind:'profile',expected:employeeEditExpected(original,'profile',codec),profile};receipt(request);return {target,original,request};
}
describe.skipIf(!enabled)('직원 편집 단일 업무 실제 SDK',()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-employee-edit-'+randomUUID().slice(0,8)},'employee-edit-'+randomUUID());db=admin.firestore(app);await ref('employees/'+actor.token.employeeId).set({name:'관리자'});});
 afterAll(async()=>{if(!db)return;for(const path of owned)await db.doc(path).delete();await app.delete();},60000);
 it('신규 응답 유실은 같은 요청 조회·duplicate로 복구하며 삭제 뒤 재호출도 부활시키지 않는다',async()=>{
  const f=await fixture(true),result=await apply(f.request);expect(result.status).toBe('applied');expect((await f.target.get()).data()).toMatchObject({name:profile.name,companyId:'taebaek'});
  expect(await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).toEqual(result);const before=await receipt(f.request).get();
  await f.target.delete();expect((await apply(f.request)).status).toBe('duplicate');expect((await f.target.get()).exists).toBe(false);expect((await receipt(f.request).get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 });
 it('명시 회사 profile은 FCM·로그인·급여와 다른 연차 값을 보존하고 actor legacy 인증은 유지한다',async()=>{
  const f=await fixture();expect((await apply(f.request)).status).toBe('applied');expect((await f.target.get()).data()).toMatchObject({companyId:'taebaek',name:profile.name,authUid:'login-uid',isAdmin:true,fcmTokens:['device'],salary:777,annualLeave:{carryOverLeave:2,bonusLeave:3,usedLeave:7,custom:{keep:true}}});
 });
 it('회사 누락·null·타회사 profile과 balance는 현재 직원 원문을 보존하고 거절 영수증으로 종결한다',async()=>{
  for(const company of [undefined,null,'punghoe'])for(const kind of ['profile','balance'] as const){
   const f=await fixture();
   await f.target.update({companyId:company===undefined?admin.firestore.FieldValue.delete():company});
   const before=await f.target.get();
   const base={version:1 as const,...reference(f.request),expected:employeeEditExpected(before.data()!,kind,codec)};
   const request:EmployeeEditRequest=kind==='profile'?{...base,kind,profile}:{...base,kind,balance:{carryOverLeave:9,bonusLeave:8}};
   const result=await apply(request);expect(result.status).toBe('rejected');expect(result.message).toContain(company==null?'소속 회사가 지정되지 않아':'다른 회사 직원');
   expect((await f.target.get()).data()).toEqual(before.data());
   expect((await f.target.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
   expect((await receipt(request).get()).get('status')).toBe('rejected');
   expect(await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(request)})).toEqual(result);
   expect((await apply(request)).status).toBe('rejected');
  }
 });
 it('회사 누락 대상의 종전 완료 영수증은 strict 검사보다 먼저 반환하고 삭제된 직원을 재생성하지 않는다',async()=>{
  const f=await fixture();await f.target.update({companyId:admin.firestore.FieldValue.delete()});
  const request={...f.request,expected:employeeEditExpected((await f.target.get()).data()!,'profile',codec)} as EmployeeEditRequest;
  const requestText=serializeEmployeeEditRequest(request),requestHash=createHash('sha256').update(requestText).digest('hex');
  await receipt(request).set({version:1,...reference(request),actorUid:actor.uid,status:'applied',requestHash,requestText,message:'종전 완료'});
  const before=await f.target.get();expect((await apply(request)).status).toBe('duplicate');
  expect((await f.target.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  expect((await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(request)})).status).toBe('applied');
  await f.target.delete();expect((await apply(request)).status).toBe('duplicate');expect((await f.target.get()).exists).toBe(false);
 });
 it('연차 두 값은 하나의 CAS로 저장하고 다른 직원·연차 필드의 최신값을 보존한다',async()=>{
  const f=await fixture(),request:EmployeeEditRequest={version:1,...reference(f.request),kind:'balance',expected:employeeEditExpected(f.original,'balance',codec),balance:{carryOverLeave:-2,bonusLeave:4}};
  await f.target.update({phone:'새 연락처','annualLeave.usedLeave':9,fcmTokens:['latest']});expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).data()).toMatchObject({phone:'새 연락처',fcmTokens:['latest'],annualLeave:{carryOverLeave:-2,bonusLeave:4,usedLeave:9,custom:{keep:true}}});
 });
 it('같은 원문을 고친 profile·balance 경합은 한 요청만 반영하고 다른 요청은 원인 있는 rejected로 종결한다',async()=>{
  const f=await fixture(),other:EmployeeEditRequest={version:1,companyId:'taebaek',targetId:f.request.targetId,planId:'balance-'+randomUUID(),kind:'balance',expected:employeeEditExpected(f.original,'balance',codec),balance:{carryOverLeave:9,bonusLeave:10}};receipt(other);
  const results=await Promise.all([apply(f.request),apply(other)]);expect(results.map(result=>result.status).sort()).toEqual(['applied','rejected']);const rejected=results.find(result=>result.status==='rejected')!;expect(rejected.message).toContain('바뀌');expect((await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(rejected)})).status).toBe('rejected');
 },60000);
 it('없는 직원 수정과 같은 번호 타회사 직원·기존 신규 대상은 거절 영수증만 쓰고 원문을 덮지 않는다',async()=>{
  const missing=await fixture();await missing.target.delete();expect((await apply(missing.request)).status).toBe('rejected');expect((await missing.target.get()).exists).toBe(false);
  const foreign=await fixture();await foreign.target.update({companyId:'punghoe'});expect((await apply(foreign.request)).status).toBe('rejected');expect((await foreign.target.get()).get('name')).toBe('기존 직원');
  const exists=await fixture(true);await exists.target.set({companyId:'taebaek',name:'먼저 등록'});expect((await apply(exists.request)).status).toBe('rejected');expect((await exists.target.get()).get('name')).toBe('먼저 등록');
 });
 it('부재 inspect는 쓰지 않고 opaque cancel과 apply 경합은 늦은 생성을 봉쇄한다',async()=>{
  const f=await fixture(true);expect((await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).status).toBe('unknown');expect((await receipt(f.request).get()).exists).toBe(false);
  await executeEmployeeEditCommand(db,actor,{mode:'cancel',reference:reference(f.request)});expect((await apply(f.request)).status).toBe('cancelled');expect((await f.target.get()).exists).toBe(false);
  const race=await fixture(true),results=await Promise.all([apply(race.request),executeEmployeeEditCommand(db,actor,{mode:'cancel',reference:reference(race.request)})]);const final=await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(race.request)});expect(['applied','cancelled']).toContain(final.status);expect((await race.target.get()).exists).toBe(final.status==='applied');expect(results.every(result=>['applied','cancelled'].includes(result.status))).toBe(true);
 },60000);
 it('다른 hash와 손상 영수증은 원문 재작성이나 확정 성공으로 바꾸지 않는다',async()=>{
  const f=await fixture();await apply(f.request);await expect(apply({...f.request,profile:{...profile,name:'다른 원문'}} as EmployeeEditRequest)).rejects.toMatchObject({code:'already-exists'});
  await receipt(f.request).update({requestText:'손상'});await expect(executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).rejects.toMatchObject({code:'failed-precondition'});expect((await f.target.get()).get('name')).toBe(profile.name);
 });
 it('실제 업무 문서 크기 오류는 직원과 receipt 모두 미반영하며 통신·SDK 오류를 거절로 포장하지 않는다',async()=>{
  const f=await fixture();await f.target.update({legacyPayload:'x'.repeat(900000)});
  const request={...f.request,profile:{...profile,name:'n'.repeat(190000)}} as EmployeeEditRequest;
  await expect(apply(request)).rejects.toThrow();expect((await receipt(request).get()).exists).toBe(false);expect((await f.target.get()).get('name')).toBe('기존 직원');expect((await f.target.get()).get('legacyPayload')).toHaveLength(900000);
 });
 it('현재 관리자 claim의 자기 과거 ACK는 직원 문서 삭제 후에도 조회하되 새 업무 쓰기는 실직원을 요구한다',async()=>{
  const f=await fixture(true),done=await apply(f.request);await ref('employees/'+actor.token.employeeId).delete();
  try{
   expect(await executeEmployeeEditCommand(db,actor,{mode:'inspect',reference:reference(f.request)})).toEqual(done);expect((await apply(f.request)).status).toBe('duplicate');expect((await executeEmployeeEditCommand(db,actor,{mode:'cancel',reference:reference(f.request)})).status).toBe('applied');
   const fresh=await fixture(true);await expect(apply(fresh.request)).rejects.toMatchObject({code:'permission-denied'});expect((await fresh.target.get()).exists).toBe(false);expect((await receipt(fresh.request).get()).exists).toBe(false);
  }finally{await ref('employees/'+actor.token.employeeId).set({name:'관리자'});}
 });
});
