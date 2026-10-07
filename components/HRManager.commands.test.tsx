/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HRManager from './HRManager';
import { savePayrollDraft, issuePayrollVoucher } from '../src/shared/services/payrollCommands';
import { setDocument } from '../src/shared/services/firebaseService';
const setup=vi.hoisted(()=>({ row:{}, emit:undefined as undefined|((rows:any[])=>void) }));
vi.mock('../src/shared/services/payrollCommands',()=>({savePayrollDraft:vi.fn(),issuePayrollVoucher:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>({setDocument:vi.fn(),subscribeToCollection:vi.fn((_c,cb)=>{setup.emit=cb;cb([setup.row]);return ()=>undefined;})}));
const employee={id:'e1',companyId:'taebaek' as const,name:'사원',position:'사원',department:'생산',joinDate:'2026-01-01',status:'working' as const,phone:''};
const accounts=[{id:'other-bank',companyId:'taebaek' as const,type:'통장' as const,name:'기타',active:true,openingBalance:0,openingDate:'2026-07-31',createdAt:'2026-07-31'},{id:'cashacct-temp-main',companyId:'taebaek' as const,type:'통장' as const,name:'농협',active:true,openingBalance:0,openingDate:'2026-07-31',createdAt:'2026-07-31'}];
const props={employees:[employee],leaveRequests:[],cashAccounts:accounts,onUpdateEmployee:vi.fn(),onAddEmployee:vi.fn(),onDeleteEmployee:vi.fn(),onUpdateLeaveStatus:vi.fn(),onUpdateLeave:vi.fn(),onDeleteLeaveRequest:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();setup.row={id:'pay-2026-10',companyId:'taebaek',yearMonth:'2026-10',payDate:'2026-10-25',revision:3,lines:[{employeeId:'e1',employeeName:'사원',base:100}]};vi.mocked(savePayrollDraft).mockResolvedValue({revision:4});vi.mocked(issuePayrollVoucher).mockResolvedValue({id:'payroll-taebaek-2026-10-base',docNo:'급여261025-001',kind:'cashEntries'});});
describe('격리 급여 명령 화면 후보',()=>{
 it('지급은 원본 버전과 메인 계좌로 단일 원자 명령을 실행한다',async()=>{const u=userEvent.setup();render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));expect(screen.getByLabelText('급여 지급 계좌')).toHaveValue('cashacct-temp-main');await u.click(screen.getByRole('button',{name:'지급 전표'}));expect(issuePayrollVoucher).toHaveBeenCalledWith('taebaek',expect.objectContaining({yearMonth:'2026-10',expectedRevision:3,lines:[expect.objectContaining({base:100})]}),'cash','cashacct-temp-main');expect(savePayrollDraft).not.toHaveBeenCalled();expect(setDocument).not.toHaveBeenCalled();});
 it('서버 버전 충돌 실패는 입력을 보존하고 성공 메시지를 표시하지 않는다',async()=>{vi.mocked(savePayrollDraft).mockRejectedValue(new Error('급여대장이 다른 화면에서 변경되었습니다.'));const u=userEvent.setup();render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));await u.click(screen.getByRole('button',{name:'저장'}));expect(savePayrollDraft).toHaveBeenCalledWith('taebaek',expect.objectContaining({expectedRevision:3}));expect(screen.getByText('급여대장이 다른 화면에서 변경되었습니다.')).toBeInTheDocument();expect(screen.getByDisplayValue('100')).toBeInTheDocument();expect(setDocument).not.toHaveBeenCalled();});
 it('이전 회사의 늦은 발행 결과는 새 회사 메시지에 표시하지 않는다',async()=>{let finish!:(v:any)=>void;vi.mocked(issuePayrollVoucher).mockReturnValue(new Promise(r=>{finish=r;}));const u=userEvent.setup();const v=render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));await u.click(screen.getByRole('button',{name:'지급 전표'}));v.rerender(<HRManager {...props} companyId="punghoe"/>);await act(async()=>finish({id:'old',docNo:'이전 회사 번호',kind:'cashEntries'}));expect(screen.queryByText(/이전 회사 번호/)).not.toBeInTheDocument();});
 it('다른 회사의 새 작업 잠금은 이전 작업 완료가 풀지 않는다',async()=>{
   let finishA!:(v:any)=>void,finishB!:(v:any)=>void;
   vi.mocked(issuePayrollVoucher).mockImplementationOnce(()=>new Promise(r=>{finishA=r;})).mockImplementationOnce(()=>new Promise(r=>{finishB=r;}));
   const u=userEvent.setup();const v=render(<HRManager {...props} companyId="taebaek"/>);
   await u.click(screen.getByRole('button',{name:'급여대장'}));await u.click(screen.getByRole('button',{name:'발생 전표'}));
   setup.row={id:'pay-punghoe-2026-10',companyId:'punghoe',yearMonth:'2026-10',payDate:'2026-10-25',revision:0,lines:[{employeeId:'e2',employeeName:'풍회사원',base:100}]};
   v.rerender(<HRManager {...props} companyId="punghoe"/>);await u.click(screen.getByRole('button',{name:'발생 전표'}));
   expect(issuePayrollVoucher).toHaveBeenCalledTimes(2);
   await act(async()=>finishA({id:'a',docNo:'A번호',kind:'issuedStatements'}));
   expect(screen.getByRole('button',{name:'발생 전표'})).toBeDisabled();expect(screen.queryByText(/A번호/)).not.toBeInTheDocument();
   await act(async()=>finishB({id:'b',docNo:'B번호',kind:'issuedStatements'}));
   expect(screen.getByRole('button',{name:'발생 전표'})).not.toBeDisabled();expect(screen.getByText('B번호 전표를 확인했습니다')).toBeInTheDocument();
 }); it('발행 대기 중 다른 월로 이동하면 새 월 저장 잠금을 보존한다',async()=>{
   let finish!:(v:any)=>void;vi.mocked(issuePayrollVoucher).mockReturnValue(new Promise(r=>{finish=r;}));
   const u=userEvent.setup();const v=render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));await u.click(screen.getByRole('button',{name:'발생 전표'}));
   fireEvent.change(v.container.querySelector('input[type="month"]')!,{target:{value:'2026-11'}});
   expect(screen.getByRole('button',{name:'저장'})).not.toBeDisabled();
   await act(async()=>finish({id:'old',docNo:'10월번호',kind:'issuedStatements'}));
   expect(screen.queryByText(/10월번호/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'저장'})).not.toBeDisabled();
 }); it('계좌만 늦게 도착해도 급여 초안을 보존하고 메인 지급을 선택한다',async()=>{
   const u=userEvent.setup();const v=render(<HRManager {...props} cashAccounts={[]} companyId="taebaek"/>);
   await u.click(screen.getByRole('button',{name:'급여대장'}));await u.clear(screen.getByDisplayValue('100'));await u.type(screen.getAllByPlaceholderText('0')[0],'123');
   expect(screen.getByRole('button',{name:'지급 전표'})).toBeDisabled();
   v.rerender(<HRManager {...props} companyId="taebaek"/>);
   expect(screen.getByLabelText('급여 지급 계좌')).toHaveValue('cashacct-temp-main');expect(screen.getByDisplayValue('123')).toBeInTheDocument();
   expect(screen.getByRole('button',{name:'지급 전표'})).not.toBeDisabled();
 });
 it('계좌 목록 갱신은 유효한 사용자 선택을 유지하고 비활성 계좌만 바꾼다',async()=>{
   const u=userEvent.setup();const v=render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));
   await u.selectOptions(screen.getByLabelText('급여 지급 계좌'),'other-bank');
   v.rerender(<HRManager {...props} cashAccounts={accounts.map(a=>({...a}))} companyId="taebaek"/>);expect(screen.getByLabelText('급여 지급 계좌')).toHaveValue('other-bank');
   v.rerender(<HRManager {...props} cashAccounts={accounts.map(a=>({...a,active:a.id!=='other-bank'}))} companyId="taebaek"/>);expect(screen.getByLabelText('급여 지급 계좌')).toHaveValue('cashacct-temp-main');
   await u.click(screen.getByRole('button',{name:'지급 전표'}));expect(issuePayrollVoucher).toHaveBeenCalledWith('taebaek',expect.any(Object),'cash','cashacct-temp-main');
 });});
