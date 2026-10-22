/** @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ReturnManager from './ReturnManager';
import {today} from '../src/shared/day';
import type {ReturnRequest} from '../src/shared/types';
const m=vi.hoisted(()=>({uid:'u',confirm:vi.fn(),rows:[] as ReturnRequest[],listener:undefined as undefined|((rows:ReturnRequest[])=>void),auth:{onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/shared/services/returnRequestSubmission',()=>({returnSubmissionActorUid:()=>m.uid,getPendingReturnSubmission:()=>null,resumeReturnSubmission:vi.fn(),submitReturnRequest:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToCollection:(_name:string,callback:(rows:ReturnRequest[])=>void)=>{m.listener=callback;callback(m.rows);return()=>{};}}));
vi.mock('../src/shared/firebase',()=>({auth:m.auth}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('firebase/firestore',()=>({where:()=>({})}));
const row:ReturnRequest={id:'return-a',companyId:'taebaek',partnerId:'p',partnerName:'거래처',items:[{itemId:'i',name:'품목',quantity:1,price:100,reason:'기타',isResellable:true}],totalAmount:100,status:'pending',createdAt:today()+'T09:00:00+09:00'};
beforeEach(()=>{m.uid='u';m.rows=[structuredClone(row)];m.confirm.mockReset();});afterEach(()=>{cleanup();vi.clearAllMocks();});
const props={companyId:'taebaek' as const,items:[],partners:[],orders:[],issuedStatements:[],currentUser:{id:'u',name:'관리자'},isAdmin:true};
it('처리 확인 대기중 같은 처리 클릭은 확인창과 실행을 한 번만 예약한다',async()=>{let approve!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise(r=>{approve=r;}));const process=vi.fn().mockResolvedValue(undefined);render(<ReturnManager {...props} onProcessReturn={process}/>);fireEvent.click(screen.getByRole('button',{name:/^이력/}));const button=screen.getByRole('button',{name:'처리'});fireEvent.click(button);fireEvent.click(button);expect(m.confirm).toHaveBeenCalledOnce();await act(async()=>approve(true));expect(process).toHaveBeenCalledExactlyOnceWith(row);});
it('확인대기 중 관리권한이 사라지면 승인해도 처리를 송신하지 않는다',async()=>{let approve!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise(r=>{approve=r;}));const process=vi.fn();const view=render(<ReturnManager {...props} onProcessReturn={process}/>);fireEvent.click(screen.getByRole('button',{name:/^이력/}));fireEvent.click(screen.getByRole('button',{name:'처리'}));view.rerender(<ReturnManager {...props} isAdmin={false} onProcessReturn={process}/>);await act(async()=>approve(true));expect(process).not.toHaveBeenCalled();});