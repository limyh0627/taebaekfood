import {expect,it,vi} from 'vitest';
import {executeOrderEditCommand,orderEditReceiptId} from './orderEditCommand';
import {orderEditExpected} from './shared/orderEditCommand';
const actor={uid:'uid',token:{companyId:'taebaek',employeeId:'employee'}};
const request={version:1 as const,companyId:'taebaek' as const,planId:'plan',targetId:'order',expected:orderEditExpected({status:'PENDING',items:[]}),edit:{kind:'items' as const,items:[]},confirmedAddedToDispatched:false};
it('인증·회사·원문 형식 오류는 DB 접근 전에 거절한다',async()=>{
 const collection=vi.fn(()=>{throw Error('DB접근');}),db={collection} as any;
 await expect(executeOrderEditCommand(db,undefined,{mode:'apply',request})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeOrderEditCommand(db,{...actor,token:{...actor.token,employeeId:''}},{mode:'apply',request})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeOrderEditCommand(db,actor,{mode:'apply',request:{...request,companyId:'punghoe'}})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeOrderEditCommand(db,actor,{mode:'apply',request:{...request,expected:['map',[['forged',['string','x']]]]}})).rejects.toMatchObject({code:'invalid-argument'});
 expect(collection).not.toHaveBeenCalled();
});
it('같은 계획의 영수증은 회사와 UID로 격리한다',()=>{
 const first=orderEditReceiptId('taebaek','u','p');expect(first).toMatch(/^[a-f0-9]{64}$/);expect(orderEditReceiptId('taebaek','u','p')).toBe(first);
 expect(orderEditReceiptId('punghoe','u','p')).not.toBe(first);expect(orderEditReceiptId('taebaek','v','p')).not.toBe(first);expect(orderEditReceiptId('taebaek','u','q')).not.toBe(first);
});
