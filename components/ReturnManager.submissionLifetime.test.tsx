/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReturnManager from './ReturnManager';
import type { Item, Partner, IssuedStatement } from '../src/shared/types';
const m=vi.hoisted(()=>({actor:'u',submit:vi.fn(),resume:vi.fn()}));
vi.mock('../src/shared/services/returnRequestSubmission',()=>({returnSubmissionActorUid:()=>m.actor,getPendingReturnSubmission:()=>({request:{partnerName:'이전',returnType:'매출',totalAmount:110}}),submitReturnRequest:m.submit,resumeReturnSubmission:m.resume}));
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToCollection:()=>()=>{}}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(true)}));
vi.mock('firebase/firestore',()=>({where:()=>({})}));
const item:Item={id:'i',companyId:'taebaek',name:'품목',type:'product',spec:'',unit:'개',stock:10,minStock:0,image:''};
const partner:Partner={id:'p',companyId:'taebaek',name:'거래처',type:'일반',partnerType:'매출처'};
const source:IssuedStatement={id:'s',companyId:'taebaek',orderId:'',partnerId:'p',partnerName:'거래처',type:'매출',tradeDate:'2026-10-22',docNo:'S',issuedAt:'2026-10-22',totalSupply:100,totalTax:10,totalAmount:110,items:[{itemId:'i',name:'품목',spec:'',qty:2,price:50,supply:100,tax:10,total:110,isTaxExempt:false,accountCode:'404'}]};
const props={companyId:'taebaek' as const,items:[item],partners:[partner],orders:[],issuedStatements:[source],currentUser:{id:'u',name:'담당자'},isAdmin:true,onProcessReturn:vi.fn()};
const deferred=()=>{let resolve!:()=>void;let reject!:(e:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
beforeEach(()=>{m.actor='u';m.submit.mockReset();m.resume.mockReset();vi.spyOn(window,'alert').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function draft(){render(<ReturnManager {...props}/>);fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'p'}});fireEvent.change(screen.getAllByRole('combobox')[2],{target:{value:'s'}});fireEvent.click(screen.getByRole('button',{name:/품목 추가/}));fireEvent.change(screen.getAllByRole('combobox')[3],{target:{value:'i'}});fireEvent.change(screen.getAllByPlaceholderText('0')[0],{target:{value:'1'}});fireEvent.change(screen.getByPlaceholderText('반품 관련 메모 (선택)'),{target:{value:'현재 초안'}});}
it('신규 송신 대기 입력과 탭·이전접수는 잠기고 실패 초안은 유지된다',async()=>{const d=deferred();m.submit.mockReturnValue(d.promise);draft();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'반품 접수'})));const note=screen.getByPlaceholderText('반품 관련 메모 (선택)');expect(note).toBeDisabled();expect(screen.getByRole('button',{name:'이전 접수 확인'})).toBeDisabled();expect(screen.getByRole('button',{name:/^이력/})).toBeDisabled();fireEvent.change(note,{target:{value:'침범'}});await act(async()=>d.reject(Error('응답 미확인')));expect(note).toHaveValue('현재 초안');expect(note).not.toBeDisabled();});
it('이전 접수 ACK는 무관 현재 초안과 선택·탭을 지우지 않는다',async()=>{const d=deferred();m.resume.mockReturnValue(d.promise);draft();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'})));await act(async()=>d.resolve());expect(screen.getByPlaceholderText('반품 관련 메모 (선택)')).toHaveValue('현재 초안');expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(1);expect(screen.getAllByRole('combobox')[0]).toHaveValue('p');expect(screen.getByRole('button',{name:'반품 접수'})).toBeTruthy();});
it('같은 tick의 두 저장과 입력 침범은 원요청 한 번만 송신하고 자기 ACK만 초안을 끝낸다',async()=>{const d=deferred();m.submit.mockReturnValue(d.promise);draft();const save=screen.getByRole('button',{name:'반품 접수'});const note=screen.getByPlaceholderText('반품 관련 메모 (선택)');act(()=>{fireEvent.click(save);fireEvent.change(note,{target:{value:'침범'}});fireEvent.click(save);});expect(m.submit).toHaveBeenCalledOnce();expect(m.submit.mock.calls[0][1]).toMatchObject({partnerId:'p',note:'현재 초안',returnType:'매출'});await act(async()=>d.resolve());expect(screen.queryByPlaceholderText('반품 관련 메모 (선택)')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'접수'}));expect(screen.getByPlaceholderText('반품 관련 메모 (선택)')).toHaveValue('');});
it('rerender 전 실제 UID가 바뀌면 옛 이전접수 버튼은 다른계정 요청을 재개하지 않는다',()=>{draft();m.actor='other';fireEvent.click(screen.getByRole('button',{name:'이전 접수 확인'}));expect(m.resume).not.toHaveBeenCalled();});
