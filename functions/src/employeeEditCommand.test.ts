import {it,expect,vi} from 'vitest';
import {executeEmployeeEditCommand,employeeEditReceiptId} from './employeeEditCommand';
import {employeeEditExpected,type EmployeeEditRequest} from './shared/employeeEditCommand';
it('권한·회사·형식 오류는 TX에 도달하지 않는다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never,reference={companyId:'taebaek' as const,targetId:'target',planId:'plan'};
 await expect(executeEmployeeEditCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeEmployeeEditCommand(db,{uid:'staff',token:{employeeId:'staff',companyId:'taebaek',isAdmin:false}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeEmployeeEditCommand(db,{uid:'admin',token:{employeeId:'admin',companyId:'punghoe',isAdmin:true}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeEmployeeEditCommand(db,{uid:'admin',token:{employeeId:'admin',companyId:'taebaek',isAdmin:true}},{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});expect(runTransaction).not.toHaveBeenCalled();
});
it('영수증은 회사·실 UID·계획을 모두 구분한다',()=>{const id=employeeEditReceiptId('taebaek','actor','plan');expect(id).toHaveLength(64);expect(id).not.toBe(employeeEditReceiptId('punghoe','actor','plan'));expect(id).not.toBe(employeeEditReceiptId('taebaek','other','plan'));});
it('프로필·연차 대상은 회사 누락·null·타회사일 때 업무를 쓰지 않고 거절 영수증만 남긴다',async()=>{
 const profile={name:'수정',position:'',department:'',joinDate:'',birthDate:'',phone:'',status:'',healthCertDate:'',annualLeave:{carryOverLeave:0,bonusLeave:0}};
 for(const company of [undefined,null,'punghoe'])for(const kind of ['profile','balance'] as const){
  const current={name:'원문',annualLeave:{carryOverLeave:1,bonusLeave:2},...(company!==undefined?{companyId:company}:{})};
  const create=vi.fn(),update=vi.fn(),tx={create,update,get:vi.fn(async(ref:{path:string})=>{
   if(ref.path.startsWith('employeeEditOperations/'))return {exists:false};
   if(ref.path==='employees/actor')return {exists:true,get:()=>undefined};
   return {exists:true,data:()=>current};
  })};
  const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})}),runTransaction:async(fn:(value:typeof tx)=>unknown)=>fn(tx)} as never;
  const base={version:1 as const,companyId:'taebaek' as const,targetId:'target',planId:'plan',expected:employeeEditExpected(current,kind)};
  const request:EmployeeEditRequest=kind==='profile'?{...base,kind,profile}:{...base,kind,balance:{carryOverLeave:0,bonusLeave:0}};
  const result=await executeEmployeeEditCommand(db,{uid:'actor',token:{employeeId:'actor',companyId:'taebaek',isAdmin:true}},{mode:'apply',request});
  expect(result.status).toBe('rejected');expect(result.message).toContain(company==null?'소속 회사가 지정되지 않아':'다른 회사 직원');expect(update).not.toHaveBeenCalled();expect(create).toHaveBeenCalledTimes(1);
 }
});
