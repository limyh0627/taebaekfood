/** @vitest-environment jsdom */
import {webcrypto} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {cashOriginalHash} from '../../../functions/src/cashMutationReceipt';
import type {ReturnRequest} from '../types';
const m=vi.hoisted(()=>({call:vi.fn(),user:{uid:'uid',getIdTokenResult:vi.fn()}}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return m.user;}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));
import {cancelReturnRequest,hasPendingReturnCancellation,resumeReturnCancellation} from './returnRequestCancellation';
const original:ReturnRequest={id:'request',companyId:'taebaek',partnerId:'partner',partnerName:'합성',items:[],totalAmount:100,status:'pending',createdAt:'2026-10-09'};
const key='return-cancellation:taebaek:uid:request';
const success=(command:any)=>({data:{status:'duplicate',requestId:command.requestId,operationId:command.operationId,requestHash:cashOriginalHash(command)}});
const rejected=(command:any,patch:Record<string,unknown>={})=>Object.assign(new Error('확정 거절'),{details:{cancellationRejected:{version:1,terminalConfirmed:true,status:'rejected',companyId:'taebaek',actorId:'uid',requestId:command.requestId,operationId:command.operationId,requestHash:cashOriginalHash(command),command,...patch}}});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);localStorage.clear();m.call.mockReset();m.user.uid='uid';m.user.getIdTokenResult.mockReset().mockResolvedValue({claims:{companyId:'taebaek',isAdmin:true}});});
it('이전 취소 거절 감사는 새 원문에 중첩하지 않고 접수·수량 증명은 보존한다',async()=>{
 const row={...original,cancellationOperations:{old:{command:{expectedRequest:{cancellationOperations:{older:{}}}}}},submissionReceipt:{version:1},quantityOperations:{quantity:{status:'updated'}}};
 m.call.mockImplementationOnce(success);await cancelReturnRequest('taebaek',row);
 const sent=m.call.mock.calls[0][0];
 expect(sent.expectedRequest).not.toHaveProperty('cancellationOperations');
 expect(sent.expectedRequest).toMatchObject({submissionReceipt:{version:1},quantityOperations:{quantity:{status:'updated'}}});
});
it('unknown은 전체 동일 원문으로 재개하고 변경 입력은 새 작업을 만들지 않는다',async()=>{
 m.call.mockRejectedValueOnce(new Error('unknown'));await expect(cancelReturnRequest('taebaek',original)).rejects.toThrow('unknown');
 const saved=localStorage.getItem(key);expect(hasPendingReturnCancellation('taebaek','request')).toBe(true);
 await expect(cancelReturnRequest('taebaek',{...original,totalAmount:200})).rejects.toThrow('이전');expect(localStorage.getItem(key)).toBe(saved);
 m.call.mockImplementationOnce(success);await resumeReturnCancellation('taebaek','request');
 expect(m.call.mock.calls[1][0]).toEqual(m.call.mock.calls[0][0]);expect(localStorage.getItem(key)).toBeNull();
});
it('terminal exact proof는 prior unknown도 해제한다',async()=>{
 m.call.mockRejectedValueOnce(new Error('unknown'));await expect(cancelReturnRequest('taebaek',original)).rejects.toThrow();
 m.call.mockImplementationOnce(async command=>{throw rejected(command);});await expect(resumeReturnCancellation('taebaek','request')).rejects.toThrow('확정');expect(localStorage.getItem(key)).toBeNull();
});
it.each([{terminalConfirmed:false},{actorId:'other'},{requestHash:'wrong'},{command:{changed:true}}])('위조·불완전 proof %j는 원문을 보존한다',async patch=>{
 m.call.mockImplementationOnce(async command=>{throw rejected(command,patch);});await expect(cancelReturnRequest('taebaek',original)).rejects.toThrow('확정');expect(localStorage.getItem(key)).not.toBeNull();
});
it.each(['uid','company'])('응답 중 %s 변경은 원문을 지우지 않는다',async kind=>{
 let resolve!:(value:unknown)=>void;m.call.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const first=cancelReturnRequest('taebaek',original);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledOnce());const command=m.call.mock.calls[0][0];
 if(kind==='uid')m.user.uid='other';else m.user.getIdTokenResult.mockResolvedValue({claims:{companyId:'punghoe',isAdmin:true}});
 resolve(success(command));await expect(first).rejects.toThrow();expect(localStorage.getItem(key)).not.toBeNull();
});
it('빠른 중복은 한 송신만 하고 늦은 완료가 다른 saved 원문을 지우지 않는다',async()=>{
 let resolve!:(value:unknown)=>void;m.call.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const first=cancelReturnRequest('taebaek',original);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledOnce());
 await expect(resumeReturnCancellation('taebaek','request')).rejects.toThrow('확인 중');
 const command=m.call.mock.calls[0][0],other=JSON.stringify({...command,operationId:'rc-other'});localStorage.setItem(key,other);
 resolve(success(command));await first;expect(localStorage.getItem(key)).toBe(other);expect(m.call).toHaveBeenCalledOnce();
});
it('사전 token 대기 중 UID 변경은 송신0이고 다른 원문 collision도 송신0이다',async()=>{
 let resolve!:(value:unknown)=>void;m.user.getIdTokenResult.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const first=cancelReturnRequest('taebaek',original);await vi.waitFor(()=>expect(m.user.getIdTokenResult).toHaveBeenCalledOnce());m.user.uid='other';resolve({claims:{companyId:'taebaek',isAdmin:true}});
 await expect(first).rejects.toThrow('권한');expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBeNull();
 m.user.uid='uid';localStorage.setItem(key,JSON.stringify({companyId:'taebaek',requestId:'request',operationId:'rc-existing',expectedRequest:{...original,totalAmount:200}}));
 await expect(cancelReturnRequest('taebaek',original)).rejects.toThrow('이전');expect(m.call).not.toHaveBeenCalled();
});
it('손상 pending과 잘못된 결과 enum은 해제하지 않는다',async()=>{
 localStorage.setItem(key,'{');expect(hasPendingReturnCancellation('taebaek','request')).toBe(true);await expect(resumeReturnCancellation('taebaek','request')).rejects.toThrow('보존');expect(localStorage.getItem(key)).toBe('{');localStorage.clear();
 m.call.mockImplementationOnce(command=>({data:{...success(command).data,status:'unexpected'}}));await expect(cancelReturnRequest('taebaek',original)).rejects.toThrow('결과');expect(localStorage.getItem(key)).not.toBeNull();
});
