import type {LeaveMutationAction} from '../src/shared/leaveRequestCommand';
import type {LeaveRequest} from '../src/shared/types';
/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HRManager from './HRManager';
import { savePayrollDraft, issuePayrollVoucher } from '../src/shared/services/payrollCommands';
import { setDocument } from '../src/shared/services/firebaseService';
import * as dialogs from '../src/shared/components/appDialog';
import type {PendingLeaveAction} from '../src/features/hr/hooks/useLeaveActions';
const setup=vi.hoisted(()=>({ row:{}, emit:undefined as undefined|((rows:any[])=>void) }));
vi.mock('../src/shared/services/payrollCommands',()=>({savePayrollDraft:vi.fn(),issuePayrollVoucher:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>({setDocument:vi.fn(),subscribeToCollection:vi.fn((_c,cb)=>{setup.emit=cb;cb([setup.row]);return ()=>undefined;})}));
const employee={id:'e1',companyId:'taebaek' as const,name:'사원',position:'사원',department:'생산',joinDate:'2026-01-01',status:'working' as const,phone:''};
const accounts=[{id:'other-bank',companyId:'taebaek' as const,type:'통장' as const,name:'기타',active:true,openingBalance:0,openingDate:'2026-07-31',createdAt:'2026-07-31'},{id:'cashacct-temp-main',companyId:'taebaek' as const,type:'통장' as const,name:'농협',active:true,openingBalance:0,openingDate:'2026-07-31',createdAt:'2026-07-31'}];
const props={requestScopeKey:'qa',employees:[employee],leaveRequests:[],cashAccounts:accounts,onSaveEmployeeEdit:vi.fn().mockResolvedValue({status:'saved'}),onLeaveAction:vi.fn().mockResolvedValue({status:"saved"})};
beforeEach(()=>{vi.clearAllMocks();setup.row={id:'pay-2026-10',companyId:'taebaek',yearMonth:'2026-10',payDate:'2026-10-25',revision:3,lines:[{employeeId:'e1',employeeName:'사원',base:100}]};vi.mocked(savePayrollDraft).mockResolvedValue({revision:4});vi.mocked(issuePayrollVoucher).mockResolvedValue({id:'payroll-taebaek-2026-10-base',docNo:'급여261025-001',kind:'cashEntries'});});
describe('격리 급여 명령 화면 후보',()=>{
 it('지급은 원본 버전과 메인 계좌로 단일 원자 명령을 실행한다',async()=>{const u=userEvent.setup();render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));expect(screen.getByLabelText('급여 지급 계좌')).toHaveValue('cashacct-temp-main');await u.click(screen.getByRole('button',{name:'지급 전표'}));expect(issuePayrollVoucher).toHaveBeenCalledWith('taebaek',expect.objectContaining({yearMonth:'2026-10',expectedRevision:3,lines:[expect.objectContaining({base:100})]}),'cash','cashacct-temp-main','qa');expect(savePayrollDraft).not.toHaveBeenCalled();expect(setDocument).not.toHaveBeenCalled();});
 it('서버 버전 충돌 실패는 입력을 보존하고 성공 메시지를 표시하지 않는다',async()=>{vi.mocked(savePayrollDraft).mockRejectedValue(new Error('급여대장이 다른 화면에서 변경되었습니다.'));const u=userEvent.setup();render(<HRManager {...props} companyId="taebaek"/>);await u.click(screen.getByRole('button',{name:'급여대장'}));await u.click(screen.getByRole('button',{name:'저장'}));expect(savePayrollDraft).toHaveBeenCalledWith('taebaek',expect.objectContaining({expectedRevision:3}),'qa');expect(screen.getByText(/급여대장이 다른 화면에서 변경되었습니다/)).toBeInTheDocument();expect(screen.getByDisplayValue('100')).toBeInTheDocument();expect(setDocument).not.toHaveBeenCalled();});
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
   await u.click(screen.getByRole('button',{name:'지급 전표'}));expect(issuePayrollVoucher).toHaveBeenCalledWith('taebaek',expect.any(Object),'cash','cashacct-temp-main','qa');
 });});

it('연차 관리에는 장문 설명 박스 대신 기존 표와 편집 기능만 남긴다',async()=>{render(<HRManager {...props} companyId="taebaek"/>);await userEvent.click(screen.getByRole('button',{name:'연차 관리'}));expect(screen.getByRole('button',{name:'연차 편집'})).toBeInTheDocument();expect(screen.getByText('월차')).toBeInTheDocument();expect(screen.queryByText(/연차 정보는 인사팀/)).toBeNull();expect(screen.queryByText(/사용 개수에 바로 차감/)).toBeNull();});

describe('단체 휴가 저장 결과 계약',()=>{
 it('전체 요청 ACK 전에는 창을 유지하고 중복 제출을 막는다',async()=>{let finish!:(v:any)=>void;const save=vi.fn((_requests:LeaveRequest[])=>new Promise<any>(resolve=>finish=resolve));render(<HRManager {...props} companyId="taebaek" onAddLeaveRequests={save}/>);fireEvent.click(screen.getByRole('button',{name:'연차 관리'}));fireEvent.click(screen.getByRole('button',{name:'휴가'}));const dialog=screen.getByRole('dialog',{name:'회사 단체 휴가'}),dates=dialog.querySelectorAll('input[type="date"]');fireEvent.change(dates[0],{target:{value:'2026-10-19'}});fireEvent.change(dates[1],{target:{value:'2026-10-20'}});const submit=within(dialog).getByRole('button',{name:'휴가 등록'});fireEvent.click(submit);fireEvent.click(submit);expect(save).toHaveBeenCalledOnce();expect(dialog).toBeInTheDocument();expect(save.mock.calls[0][0]).toEqual([expect.objectContaining({employeeId:'e1',status:'approved',deductsLeave:true,daysUsed:2})]);await act(async()=>finish({status:'saved'}));expect(screen.queryByRole('dialog',{name:'회사 단체 휴가'})).toBeNull();});
 it('미확정 단체 요청은 원문으로 재열고 결과 확인 또는 중단만 제공한다',async()=>{const save=vi.fn().mockResolvedValue({status:'unknown',message:'서버 확인 필요',nextAction:'보관 요청 확인'}),cancel=vi.fn().mockResolvedValue({status:'cancelled',message:'중단 완료',nextAction:'새 작성 가능'});render(<HRManager {...props} companyId="taebaek" onAddLeaveRequests={save} onCancelLeaveRequest={cancel}/>);fireEvent.click(screen.getByRole('button',{name:'연차 관리'}));fireEvent.click(screen.getByRole('button',{name:'휴가'}));let dialog=screen.getByRole('dialog',{name:'회사 단체 휴가'});const dates=dialog.querySelectorAll('input[type="date"]');fireEvent.change(dates[0],{target:{value:'2026-10-19'}});fireEvent.change(dates[1],{target:{value:'2026-10-20'}});fireEvent.click(within(dialog).getByRole('button',{name:'휴가 등록'}));await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('서버 확인 필요'));fireEvent.click(within(dialog).getByRole('button',{name:'취소'}));fireEvent.click(screen.getByRole('button',{name:/보관된 단체 휴가 확인/}));dialog=screen.getByRole('dialog',{name:'회사 단체 휴가'});expect(within(dialog).getByRole('button',{name:'휴가 등록'})).toBeDisabled();expect(within(dialog).getByDisplayValue('2026-10-19')).toBeInTheDocument();fireEvent.click(within(dialog).getByRole('button',{name:'요청 중단'}));await waitFor(()=>expect(within(dialog).getByRole('button',{name:'휴가 등록'})).toBeEnabled());expect(cancel).toHaveBeenCalledWith(save.mock.calls[0][0][0].id);expect(save).toHaveBeenCalledOnce();});
});
it('관리자 취소 미확정은 승인 탭과 같은 controller로 복구해 돌아온 화면에 오래된 잠금을 남기지 않는다',async()=>{
 const month=new Date().toISOString().slice(0,7),row:LeaveRequest={id:'shared-action',employeeId:employee.id,employeeName:employee.name,type:'연차',startDate:month+'-19',endDate:month+'-19',reason:'공유 상태 검수',status:'approved',requestedAt:month+'-01',daysUsed:1};let pending:PendingLeaveAction[]=[];
 vi.spyOn(dialogs,'appPrompt').mockResolvedValueOnce('관리자 취소 사유');
 const action=vi.fn(async(actual:LeaveRequest,change:LeaveMutationAction)=>{pending=[{id:actual.id,planId:'shared-plan',row:actual,action:change,description:'취소 미확인'}];return{status:'unknown' as const,message:'취소 결과 미확인',nextAction:'결과 확인 또는 요청 중단'};});
 const inspect=vi.fn(async()=>{pending=[];return{status:'saved' as const};});
 render(<HRManager {...props} leaveRequests={[row]} onLeaveAction={action} onReadPendingLeaveActions={()=>pending} onInspectLeaveAction={inspect}/>);
 fireEvent.click(screen.getByRole('button',{name:'연차 관리'}));fireEvent.click(screen.getByTitle('올해 연차 신청·사용 내역 보기'));
 let detail=screen.getByRole('dialog');fireEvent.click(within(detail).getByRole('button',{name:new RegExp(Number(month.slice(5))+'월')}));
 await act(async()=>fireEvent.click(within(detail).getByRole('button',{name:'취소'})));expect(action).toHaveBeenCalledExactlyOnceWith(row,{action:'cancel',reason:'관리자 취소 사유'});
 fireEvent.click(within(detail).getByRole('button',{name:/닫기/}));fireEvent.click(screen.getByRole('button',{name:'승인 대기'}));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'휴가 작업 결과 확인'})));expect(inspect).toHaveBeenCalledExactlyOnceWith('shared-plan');
 fireEvent.click(screen.getByRole('button',{name:'연차 관리'}));expect(screen.queryByRole('button',{name:/보관된 휴가 작업 확인/})).toBeNull();fireEvent.click(screen.getByTitle('올해 연차 신청·사용 내역 보기'));detail=screen.getByRole('dialog');fireEvent.click(within(detail).getByRole('button',{name:new RegExp(Number(month.slice(5))+'월')}));expect(within(detail).getByRole('button',{name:'취소'})).toBeEnabled();
});
import type { EmployeeEditInput, EmployeeEditSaveOutcome, PendingEmployeeEdit } from '../src/features/hr/infrastructure/employeeEditWrites';
it('직원 수정은 ACK 전 창·초안을 유지하고 완료된 동일 초안만 닫는다', async () => {
    let finish!: (outcome: EmployeeEditSaveOutcome) => void;
    const save = vi.fn((_input: EmployeeEditInput) => new Promise<EmployeeEditSaveOutcome>(resolve => {
        finish = resolve;
    }));
    render(<HRManager {...props} onSaveEmployeeEdit={save}/>);
    fireEvent.click(screen.getByRole('button', { name: '사원 정보 수정' }));
    const dialog = screen.getByRole('dialog', { name: '정보 수정' });
    fireEvent.change(dialog.querySelector('input[type="text"]')!, { target: { value: '고친 이름' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장 완료' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '저장 완료' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '정보 수정 닫기' }));
    expect(dialog).toBeInTheDocument();
    expect(save.mock.calls[0][0]).toMatchObject({ kind: 'profile', targetId: employee.id, opening: employee, profile: { name: '고친 이름' } });
    await act(async () => finish({ status: 'saved' }));
    expect(screen.queryByRole('dialog', { name: '정보 수정' })).toBeNull();
});
it('직원 신규 사전 거절은 초안과 최초 번호를 유지하고 수정 후 같은 번호로 저장한다', async () => {
    const save = vi.fn<(input: EmployeeEditInput) => Promise<EmployeeEditSaveOutcome>>().mockResolvedValueOnce({ status: 'rejected', message: '입력 확인 필요', nextAction: '이름을 확인해 주세요.' }).mockResolvedValue({ status: 'saved' });
    render(<HRManager {...props} onSaveEmployeeEdit={save}/>);
    fireEvent.click(screen.getByRole('button', { name: '직원 등록' }));
    const dialog = screen.getByRole('dialog', { name: '신규 직원 등록' }), name = dialog.querySelector('input[type="text"]')!;
    fireEvent.change(name, { target: { value: '새 사원' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장 완료' }));
    await within(dialog).findByText(/입력 확인 필요/);
    expect(name).toHaveValue('새 사원');
    fireEvent.change(name, { target: { value: '새 이름' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장 완료' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].targetId).toBe(save.mock.calls[0][0].targetId);
    expect(screen.queryByRole('dialog', { name: '신규 직원 등록' })).toBeNull();
});
it('직원 unknown은 실 reference 복구만 제공하고 삭제된 대상도 결과 확인할 수 있다', async () => {
    let retained: PendingEmployeeEdit[] = [];
    const save = vi.fn(async (input: EmployeeEditInput): Promise<EmployeeEditSaveOutcome> => {
        retained = [{ id: input.targetId, planId: 'retained', reference: { companyId: 'taebaek', targetId: input.targetId, planId: 'retained' }, kind: input.kind, description: '직원 저장 · 새 사원' }];
        return { status: 'unknown', message: '응답 미확인', nextAction: '결과 확인' };
    });
    const inspect = vi.fn(async () => {
        retained = [];
        return { status: 'saved' } as const;
    });
    const p = { ...props, onSaveEmployeeEdit: save, onReadPendingEmployeeEdits: () => retained, onReadEmployeeEditReferences: () => retained.map(row => ({ key: row.planId, readable: true, reference: row.reference })), onInspectEmployeeEdit: inspect };
    const view = render(<HRManager {...p}/>);
    fireEvent.click(screen.getByRole('button', { name: '직원 등록' }));
    let dialog = screen.getByRole('dialog', { name: '신규 직원 등록' });
    fireEvent.change(dialog.querySelector('input[type="text"]')!, { target: { value: '새 사원' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장 완료' }));
    await within(dialog).findByText(/응답 미확인/);
    expect(within(dialog).getByRole('button', { name: '저장 완료' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '신규 직원 등록 닫기' }));
    view.rerender(<HRManager {...p} employees={[]}/>);
    const region = screen.getByRole('region', { name: '처리 결과 확인이 필요한 직원 저장' });
    fireEvent.click(within(region).getByRole('button', { name: '결과 확인' }));
    await waitFor(() => expect(inspect).toHaveBeenCalledWith(save.mock.calls[0][0].targetId ? expect.objectContaining({ targetId: save.mock.calls[0][0].targetId, planId: 'retained' }) : undefined));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
});
it('연차 두 필드는 로컬에서 함께 수정하고 명시 저장할 때 원본과 두 값을 한 번만 보낸다', async () => {
    const save = vi.fn(async (_input: EmployeeEditInput): Promise<EmployeeEditSaveOutcome> => ({ status: 'saved' }));
    render(<HRManager {...props} onSaveEmployeeEdit={save}/>);
    fireEvent.click(screen.getByRole('button', { name: '연차 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '연차 편집' }));
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '1' } });
    fireEvent.change(inputs[1], { target: { value: '2' } });
    expect(save).not.toHaveBeenCalled();
    expect(inputs[0]).toHaveValue(1);
    expect(inputs[1]).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: '연차 저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ targetId: employee.id, kind: 'balance', opening: employee, balance: { bonusLeave: 1, carryOverLeave: 2 } }));
});
it('급여 dirty 초안은 직원·외부 revision 갱신 뒤에도 유지하고 명시 최신 불러오기만 바꾼다', async () => {
    vi.mocked(savePayrollDraft).mockRejectedValueOnce(Error('원본 버전 충돌'));
    const view = render(<HRManager {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '급여대장' }));
    const first = screen.getAllByRole('textbox').find(input => input.getAttribute('inputmode') === 'numeric')!;
    fireEvent.change(first, { target: { value: '777' } });
    await act(async () => setup.emit?.([{ id: 'pay-2026-10', companyId: 'taebaek', yearMonth: '2026-10', payDate: '2026-10-26', revision: 4, lines: [{ employeeId: 'e1', employeeName: '사원', base: 200 }] }]));
    view.rerender(<HRManager {...props} employees={[{ ...employee, name: '새 이름' }]}/>);
    expect(first).toHaveValue('777');
    expect(screen.getByText(/같은 월의 저장본이 바뀌었습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(savePayrollDraft).toHaveBeenCalledWith('taebaek', expect.objectContaining({ expectedRevision: 3, lines: [expect.objectContaining({ base: 777 })] }), 'qa'));
    await screen.findByText(/원본 버전 충돌/);
    fireEvent.click(screen.getByRole('button', { name: '최신 급여 불러오기' }));
    expect(first).toHaveValue('200');
});
it('급여 저장 중 모든 변경을 잠그고 UID 변경 뒤 이전 ACK 안내를 새 계정에 표시하지 않는다', async () => {
    let finish!: (value: {
        revision: number;
    }) => void;
    vi.mocked(savePayrollDraft).mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const view = render(<HRManager {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '급여대장' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(savePayrollDraft).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '지난달 복사' })).toBeDisabled();
    expect(screen.getByLabelText('급여 월')).toBeDisabled();
    expect(screen.getByLabelText('급여 지급 계좌')).toBeDisabled();
    for (const input of view.container.querySelectorAll('input[inputmode="numeric"],input[type="date"]'))
        expect(input).toBeDisabled();
    view.rerender(<HRManager {...props} requestScopeKey="other-user"/>);
    await act(async () => finish({ revision: 4 }));
    expect(screen.queryByText('저장했습니다')).toBeNull();
});
