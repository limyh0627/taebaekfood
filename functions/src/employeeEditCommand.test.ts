import {it,expect,vi} from 'vitest';
import {executeEmployeeEditCommand,employeeEditReceiptId} from './employeeEditCommand';
it('권한·회사·형식 오류는 TX에 도달하지 않는다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never,reference={companyId:'taebaek' as const,targetId:'target',planId:'plan'};
 await expect(executeEmployeeEditCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeEmployeeEditCommand(db,{uid:'staff',token:{employeeId:'staff',companyId:'taebaek',isAdmin:false}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeEmployeeEditCommand(db,{uid:'admin',token:{employeeId:'admin',companyId:'punghoe',isAdmin:true}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeEmployeeEditCommand(db,{uid:'admin',token:{employeeId:'admin',companyId:'taebaek',isAdmin:true}},{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});expect(runTransaction).not.toHaveBeenCalled();
});
it('영수증은 회사·실 UID·계획을 모두 구분한다',()=>{const id=employeeEditReceiptId('taebaek','actor','plan');expect(id).toHaveLength(64);expect(id).not.toBe(employeeEditReceiptId('punghoe','actor','plan'));expect(id).not.toBe(employeeEditReceiptId('taebaek','other','plan'));});
