/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ReceivingReturnsManager from './ReceivingReturnsManager';
import type {Item,Partner,PartnerItem} from '../src/shared/types';
const m=vi.hoisted(()=>({actor:'u',submit:vi.fn(),resume:vi.fn()}));
vi.mock('../src/shared/services/returnRequestSubmission',()=>({returnSubmissionActorUid:()=>m.actor,getPendingReturnSubmission:()=>({request:{partnerName:'이전',returnType:'매출',totalAmount:110}}),submitReturnRequest:m.submit,resumeReturnSubmission:m.resume}));
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToCollection:()=>()=>{}}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(true)}));
vi.mock('firebase/firestore',()=>({where:()=>({})}));
const item:Item={id:'i',companyId:'taebaek',name:'품목',type:'product',spec:'',unit:'개',stock:10,minStock:0,image:''};
const partner:Partner={id:'p',companyId:'taebaek',name:'거래처',type:'일반',partnerType:'매출+매입처'};
const links:PartnerItem[]=[{id:'out',partnerId:'p',itemId:'i',Direction:'out'},{id:'in',partnerId:'p',itemId:'i',Direction:'in'}];
const props={companyId:'taebaek' as const,items:[item],partners:[partner],partnerItems:links,orders:[],issuedStatements:[],currentUser:{id:'u',name:'담당자'},isAdmin:true,onProcessReturn:vi.fn()};
const deferred=()=>{let resolve!:()=>void;let reject!:(e:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
beforeEach(()=>{m.actor='u';m.submit.mockReset();m.resume.mockReset();vi.spyOn(window,'alert').mockImplementation(()=>{});});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function draft(direction:'받기'|'보내기'){const view=render(<ReceivingReturnsManager {...props}/>);if(direction==='보내기')fireEvent.click(screen.getByRole('button',{name:/반품하기/}));fireEvent.focus(screen.getByPlaceholderText(direction==='받기'?'거래처 검색...':'공급처 검색...'));fireEvent.mouseDown(screen.getByRole('button',{name:'거래처'}));if(direction==='보내기'){fireEvent.change(screen.getByPlaceholderText('+ 품목 검색하여 추가...'),{target:{value:'품목'}});fireEvent.mouseDown(screen.getByRole('button',{name:'품목'}));}fireEvent.change(screen.getByPlaceholderText('0'),{target:{value:'2'}});const note=screen.getByPlaceholderText(direction==='받기'?'반품 관련 메모 (선택)':'반품 사유, 메모 (선택)');fireEvent.change(note,{target:{value:'현재 초안'}});return{view,note};}
it.each(['받기','보내기'] as const)('이전 요청 ACK는 현재 %s 초안을 지우지 않는다',async direction=>{const d=deferred();m.resume.mockReturnValue(d.promise);const {note}=draft(direction);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'})));await act(async()=>d.resolve());expect(note).toHaveValue('현재 초안');expect(screen.getByPlaceholderText('0')).toHaveValue(2);});
it('이전 요청 대기에도 양방향 초안 입력과 탭 전환을 막고 거절 뒤 보존한다',async()=>{const d=deferred();m.resume.mockReturnValue(d.promise);const {note}=draft('받기');await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'})));expect(note).toBeDisabled();expect(screen.getByRole('button',{name:/반품하기/})).toBeDisabled();fireEvent.change(note,{target:{value:'침범'}});await act(async()=>d.reject(Error('확인 실패')));expect(note).toHaveValue('현재 초안');expect(note).not.toBeDisabled();});
it.each(['받기','보내기'] as const)('신규 %s 송신 대기 동안 같은 tick 입력·재전송은 막고 거절 후 원초안을 보존한다',async direction=>{
 const d=deferred();m.submit.mockReturnValue(d.promise);const {note}=draft(direction);
 fireEvent.change(screen.getByLabelText('품목 공급가'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('품목 세액'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('품목 발생 계정'),{target:{value:direction==='받기'?'404':'104'}});
 const save=screen.getByRole('button',{name:direction==='받기'?'반품 접수 (관리자 확인 후 전표 발행)':'반품 발송 접수 (관리자 확인 후 처리)'});
 await act(async()=>{fireEvent.click(save);fireEvent.change(note,{target:{value:'침범'}});fireEvent.click(save);});
 expect(m.submit).toHaveBeenCalledOnce();expect(note).toHaveValue('현재 초안');expect(note).toBeDisabled();expect(screen.getByRole('button',{name:'이전 접수 확인'})).toBeDisabled();expect(m.submit.mock.calls[0][1]).toMatchObject({partnerId:'p',note:'현재 초안',returnType:direction==='받기'?'매출':'매입',totalAmount:110});
 await act(async()=>d.reject(Error('응답 미확인')));expect(note).toHaveValue('현재 초안');expect(screen.getByPlaceholderText('0')).toHaveValue(2);expect(note).not.toBeDisabled();
});
it('이전 요청 확인 중 자료갱신과 busy종료만으로 현재 자동제안 원행을 바꾸지 않는다',async()=>{
 const d=deferred();m.resume.mockReturnValue(d.promise);const view=render(<ReceivingReturnsManager {...props}/>);fireEvent.focus(screen.getByPlaceholderText('거래처 검색...'));fireEvent.mouseDown(screen.getByRole('button',{name:'거래처'}));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'})));
 view.rerender(<ReceivingReturnsManager {...props} items={[{...item,name:'새 자료'}]}/>);
 expect(screen.getAllByText('품목').length).toBeGreaterThan(0);expect(screen.queryByText('새 자료')).toBeNull();await act(async()=>d.resolve());expect(screen.getAllByText('품목').length).toBeGreaterThan(0);expect(screen.queryByText('새 자료')).toBeNull();
});
it('rerender 전 실제 UID가 바뀌면 옛 이전접수 버튼은 다른계정 요청을 재개하지 않는다',()=>{draft('받기');m.actor='other';fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));expect(m.resume).not.toHaveBeenCalled();});
