import {it,expect,vi} from 'vitest';
import {executeItemEditorCommand,itemEditorReceiptId} from './itemEditorCommand';
it('미로그인·다른 회사·잘못된 계약은 TX 시작 전에 거절한다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never,ref={companyId:'punghoe' as const,targetId:'item',planId:'plan'};
 await expect(executeItemEditorCommand(db,undefined,{mode:'inspect',reference:ref})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeItemEditorCommand(db,{uid:'actor',token:{employeeId:'e',companyId:'taebaek'}},{mode:'inspect',reference:ref})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeItemEditorCommand(db,{uid:'actor',token:{employeeId:'e',companyId:'taebaek'}},{mode:'other'} as never)).rejects.toMatchObject({code:'invalid-argument'});expect(runTransaction).not.toHaveBeenCalled();
});
it('receipt 번호는 회사·실 UID·계획에 묶여 다른 세션·회사와 충돌하지 않는다',()=>{const id=itemEditorReceiptId('taebaek','actor','plan');expect(id).toHaveLength(64);expect(id).not.toBe(itemEditorReceiptId('punghoe','actor','plan'));expect(id).not.toBe(itemEditorReceiptId('taebaek','other','plan'));});
