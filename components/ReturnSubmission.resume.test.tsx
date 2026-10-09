import {webcrypto} from 'node:crypto';
/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({call:vi.fn(),user:{uid:'u',getIdTokenResult:vi.fn().mockResolvedValue({claims:{companyId:'taebaek',employeeId:'e'}})}}));
vi.mock('../src/shared/firebase',()=>({auth:{get currentUser(){return m.user;}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToCollection:()=>()=>{}}));
vi.mock('firebase/firestore',()=>({where:()=>({})}));
import {returnSubmissionRequestHash} from '../src/shared/services/returnRequestSubmission';
import ReceivingReturnsManager from './ReceivingReturnsManager';
import ReturnManager from './ReturnManager';
const request={companyId:'taebaek',status:'pending',partnerId:'p',partnerName:'이전 합성 거래처',returnType:'매출',items:[{itemId:'i',quantity:1}],totalAmount:110};
const pending={version:1,companyId:'taebaek',userId:'u',requestId:'fixed-request',request};
const props={companyId:'taebaek' as const,items:[],partners:[],orders:[],issuedStatements:[],currentUser:{id:'e',name:'합성'},isAdmin:true,onProcessReturn:vi.fn()};
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);localStorage.clear();m.call.mockReset();m.user.uid='u';localStorage.setItem('return-submission:taebaek:u',JSON.stringify(pending));});
afterEach(cleanup);
it('닫았다 다시 연 실제 반품 모달에서 unknown 원문을 재개한다',async()=>{
 m.call.mockRejectedValueOnce(new Error('응답 유실'));
 const first=render(<ReceivingReturnsManager {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('응답 유실'));
 expect(localStorage.getItem('return-submission:taebaek:u')).toBe(JSON.stringify(pending));first.unmount();
 m.call.mockImplementationOnce(async input=>({data:{status:'duplicate',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}}));
 render(<ReceivingReturnsManager {...props}/>);fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'이전 접수 확인'})).toBeNull());
 expect(m.call.mock.calls[0][0]).toEqual({companyId:'taebaek',requestId:'fixed-request',request});
 expect(m.call.mock.calls[1][0]).toEqual(m.call.mock.calls[0][0]);
});
it('기존 ReturnManager도 실제 재개 서비스로 접수 확인 후 해제한다',async()=>{
 m.call.mockImplementationOnce(async input=>({data:{status:'duplicate',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}}));
 render(<ReturnManager {...props}/>);fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));
 await waitFor(()=>expect(localStorage.getItem('return-submission:taebaek:u')).toBeNull());
 expect(m.call).toHaveBeenCalledOnce();
});
it('회사를 바꾼 뒤 늦은 이전 접수 실패를 현재 모달에 표시하지 않는다',async()=>{
 let reject!:(reason:unknown)=>void;m.call.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
 const view=render(<ReceivingReturnsManager {...props}/>);fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));
 await waitFor(()=>expect(m.call).toHaveBeenCalledOnce());view.rerender(<ReceivingReturnsManager {...props} companyId="punghoe"/>);
 reject(new Error('이전 회사 실패'));await new Promise(resolve=>setTimeout(resolve,0));
 expect(screen.queryByText('이전 회사 실패')).toBeNull();expect(localStorage.getItem('return-submission:taebaek:u')).toBe(JSON.stringify(pending));
});
