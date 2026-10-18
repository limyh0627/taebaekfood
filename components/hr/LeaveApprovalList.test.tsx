/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,act} from '@testing-library/react';
import {LeaveApprovalList} from './LeaveApprovalList';
import type {LeaveRequest,LeaveModifyRequest} from '../../src/shared/types';
const request=(id:string,over:Partial<LeaveRequest>={}):LeaveRequest=>({id,employeeId:'employee-'+id,employeeName:'직원 '+id,type:'연차',startDate:'2026-10-01',endDate:'2026-10-02',reason:'원래 사유',status:'pending',requestedAt:'2026-09-30T00:00:00Z',daysUsed:2,...over});
const modification:LeaveModifyRequest={startDate:'2026-10-05',endDate:'2026-10-05',reason:'변경 사유',daysUsed:0.5,status:'pending'};
const callbacks=()=>({onUpdateLeaveStatus:vi.fn().mockResolvedValue({status:'saved'}),onUpdateLeave:vi.fn().mockResolvedValue({status:'saved'})});
afterEach(cleanup);
it('일반 결재는 해당 행 ID와 승인·반려 상태만 전달하고 목록 순서를 보존한다',()=>{
 const c=callbacks(),rows=[request('b'),request('a')];render(<LeaveApprovalList pendingRequests={rows} {...c}/>);
 const bodyRows=screen.getAllByRole('row').slice(1);expect(bodyRows.map(r=>r.textContent)).toEqual([expect.stringContaining('직원 b'),expect.stringContaining('직원 a')]);
 fireEvent.click(within(bodyRows[1]).getByRole('button',{name:'승인'}));fireEvent.click(within(bodyRows[0]).getByRole('button',{name:'반려'}));
 expect(c.onUpdateLeaveStatus.mock.calls).toEqual([['a','approved'],['b','rejected']]);expect(c.onUpdateLeave).not.toHaveBeenCalled();
});
it('취소 요청은 취소 승인만 제공하고 approved가 아닌 cancelled를 전달한다',()=>{
 const c=callbacks();render(<LeaveApprovalList pendingRequests={[request('cancel',{status:'cancel_pending'})]} {...c}/>);
 expect(screen.getByText('취소 신청')).toBeTruthy();expect(screen.queryByRole('button',{name:'반려'})).toBeNull();expect(screen.queryByRole('button',{name:'승인'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'취소 승인'}));expect(c.onUpdateLeaveStatus).toHaveBeenCalledExactlyOnceWith('cancel','cancelled');expect(c.onUpdateLeave).not.toHaveBeenCalled();
});
it('변경 승인은 변경 날짜·사유·일수와 approved 사본을 정확히 전달한다',()=>{
 const c=callbacks(),r=request('modify',{status:'approved',modifyRequest:modification}),before=JSON.stringify(r);
 render(<LeaveApprovalList pendingRequests={[r]} {...c}/>);expect(screen.getByText('변경 전: 2026-10-01 ~ 2026-10-02')).toBeTruthy();expect(screen.getByText('변경 후: 2026-10-05 ~ 2026-10-05')).toBeTruthy();expect(screen.getByText('0.5일 (변경)')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'변경 승인'}));expect(c.onUpdateLeave).toHaveBeenCalledExactlyOnceWith('modify',{startDate:'2026-10-05',endDate:'2026-10-05',reason:'변경 사유',daysUsed:0.5,modifyRequest:{...modification,status:'approved'}});
 expect(c.onUpdateLeaveStatus).not.toHaveBeenCalled();expect(JSON.stringify(r)).toBe(before);
});
it('변경 반려는 원래 승인 날짜·사유·일수를 덮어쓰지 않고 변경 사본만 갱신한다',()=>{
 const c=callbacks(),r=request('reject',{status:'approved',modifyRequest:modification}),before=JSON.stringify(r);render(<LeaveApprovalList pendingRequests={[r]} {...c}/>);
 fireEvent.click(screen.getByRole('button',{name:'반려'}));expect(c.onUpdateLeave).toHaveBeenCalledExactlyOnceWith('reject',{modifyRequest:{...modification,status:'rejected'}});expect(c.onUpdateLeaveStatus).not.toHaveBeenCalled();expect(JSON.stringify(r)).toBe(before);
});
it('취소와 변경이 동시에 있으면 두 독립 동작을 모두 제공하는 원문 조건을 유지한다',async()=>{
 const c=callbacks();render(<LeaveApprovalList pendingRequests={[request('both',{status:'cancel_pending',modifyRequest:modification})]} {...c}/>);
 expect(screen.getByText('취소 신청')).toBeTruthy();expect(screen.getByText('변경 신청')).toBeTruthy();
 expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['취소 승인','변경 승인','반려']);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'취소 승인'})));fireEvent.click(screen.getByRole('button',{name:'변경 승인'}));expect(c.onUpdateLeaveStatus).toHaveBeenCalledExactlyOnceWith('both','cancelled');expect(c.onUpdateLeave).toHaveBeenCalledTimes(1);
});
it('빈 목록은 기존 안내와 표 머리만 표시하고 결재를 생성하지 않는다',()=>{
 const c=callbacks();render(<LeaveApprovalList pendingRequests={[]} {...c}/>);expect(screen.getByText('새로 들어온 승인 대기 내역이 없습니다.')).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(c.onUpdateLeave).not.toHaveBeenCalled();expect(c.onUpdateLeaveStatus).not.toHaveBeenCalled();
});

it('결재 응답 대기 중 중복을 막고 실패 원인을 보여 주며 권위 없는 영구 잠금은 만들지 않는다',async()=>{const c=callbacks();let reject!:(e:Error)=>void;c.onUpdateLeaveStatus.mockImplementation(()=>new Promise((_r,j)=>reject=j));const row=request('failure');const view=render(<LeaveApprovalList pendingRequests={[row]} {...c}/>);const approve=screen.getByRole('button',{name:'승인'});fireEvent.click(approve);fireEvent.click(approve);expect(c.onUpdateLeaveStatus).toHaveBeenCalledOnce();expect(approve).toBeDisabled();await act(async()=>reject(Error('오류')));expect(screen.getByRole('alert')).toHaveTextContent('저장 결과');expect(approve).toBeEnabled();view.rerender(<LeaveApprovalList pendingRequests={[{...row,status:'approved',modifyRequest:modification}]} {...c}/>);expect(screen.getByRole('button',{name:'변경 승인'})).toBeEnabled();});
