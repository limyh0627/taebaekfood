import {it,expect,vi} from 'vitest';
import {executePartnerItemTermsCommand,partnerItemTermsReceiptId} from './partnerItemTermsCommand';
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'item_partner_out',itemId:'item',partnerId:'partner',direction:'out' as const};
it('로그인·claim 회사·형식 오류는 TX 전 거절한다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never;
 await expect(executePartnerItemTermsCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'taebaek'}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'punghoe',employeeId:'e'}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'taebaek',employeeId:'e'}},{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});expect(runTransaction).not.toHaveBeenCalled();
});
it('저장 receipt 번호는 회사·UID·계획에 묶인다',()=>{const id=partnerItemTermsReceiptId('taebaek','actor','plan');expect(id).toHaveLength(64);expect(id).not.toBe(partnerItemTermsReceiptId('punghoe','actor','plan'));expect(id).not.toBe(partnerItemTermsReceiptId('taebaek','other','plan'));});
