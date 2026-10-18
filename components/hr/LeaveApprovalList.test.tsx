import type {SaveOutcome} from '../../src/shared/saveOutcome';
/** @vitest-environment jsdom */
import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within,act} from '@testing-library/react';
import {LeaveApprovalList} from './LeaveApprovalList';
import type {LeaveRequest,LeaveModifyRequest} from '../../src/shared/types';
import type {PendingLeaveAction} from '../../src/features/hr/hooks/useLeaveActions';
const request=(id:string,over:Partial<LeaveRequest>={}):LeaveRequest=>({id,employeeId:'employee-'+id,employeeName:'직원 '+id,type:'연차',startDate:'2026-10-01',endDate:'2026-10-02',reason:'원래 사유',status:'pending',requestedAt:'2026-09-30T00:00:00Z',daysUsed:2,...over});
const modification:LeaveModifyRequest={startDate:'2026-10-05',endDate:'2026-10-05',reason:'변경 사유',daysUsed:0.5,status:'pending'};
it('일반 결재는 실제 표시한 행 전체와 명시 action을 전달하고 중복 클릭을 막는다',async()=>{
 let finish!:(value:SaveOutcome)=>void;const action=vi.fn(()=>new Promise<SaveOutcome>(resolve=>{finish=resolve;})),rows=[request('b'),request('a')];
 render(<LeaveApprovalList pendingRequests={rows} onLeaveAction={action}/>);const bodyRows=screen.getAllByRole('row').slice(1);
 expect(bodyRows.map(row=>row.textContent)).toEqual([expect.stringContaining('직원 b'),expect.stringContaining('직원 a')]);
 const approve=within(bodyRows[1]).getByRole('button',{name:'승인'});fireEvent.click(approve);fireEvent.click(approve);expect(action).toHaveBeenCalledExactlyOnceWith(rows[1],{action:'approve'});expect(approve).toBeDisabled();await act(async()=>finish({status:'saved'}));
});
it('취소 요청은 취소 승인 action만 제공하고 approved로 바꾸지 않는다',async()=>{
 const row=request('cancel',{status:'cancel_pending'}),action=vi.fn().mockResolvedValue({status:'saved'});
 render(<LeaveApprovalList pendingRequests={[row]} onLeaveAction={action}/>);expect(screen.queryByRole('button',{name:'반려'})).toBeNull();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'취소 승인'})));expect(action).toHaveBeenCalledExactlyOnceWith(row,{action:'cancel'});
});
it.each(['approved','cancel_pending'] as const)('%s 변경 승인은 현재 원문·변경안을 그대로 넘기고 취소 뒤 남은 변경 동작을 숨긴다',async status=>{
 const row=request('modify',{status,modifyRequest:modification}),before=JSON.stringify(row),action=vi.fn().mockResolvedValue({status:'saved'});
 const view=render(<LeaveApprovalList pendingRequests={[row]} onLeaveAction={action}/>);expect(screen.getByText('변경 전: 2026-10-01 ~ 2026-10-02')).toBeTruthy();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'변경 승인'})));expect(action).toHaveBeenLastCalledWith(row,{action:'approve-modify'});expect(JSON.stringify(row)).toBe(before);
 view.rerender(<LeaveApprovalList pendingRequests={[{...row,status:'cancelled'}]} onLeaveAction={action}/>);expect(screen.queryByRole('button',{name:'변경 승인'})).toBeNull();expect(screen.queryByRole('button',{name:'반려'})).toBeNull();
});
it('변경 반려는 reject-modify 원문만 보내 기존 승인 날짜·일수를 보존한다',async()=>{
 const row=request('reject',{status:'approved',modifyRequest:modification}),action=vi.fn().mockResolvedValue({status:'saved'});render(<LeaveApprovalList pendingRequests={[row]} onLeaveAction={action}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'반려'})));expect(action).toHaveBeenCalledExactlyOnceWith(row,{action:'reject-modify'});expect(row.startDate).toBe('2026-10-01');expect(row.daysUsed).toBe(2);
});
it('행이 사라져도 미확정 원문은 바깥 목록에 남고 정확한 plan만 확인한다',async()=>{
 const row=request('unknown');let pending:PendingLeaveAction[]=[];
 const action=vi.fn(async()=>{pending=[{id:row.id,planId:'mutation-plan',row,action:{action:'approve'},description:'승인 미확인'}];return {status:'unknown' as const,message:'승인 응답 미확인',nextAction:'같은 결재를 다시 보내지 마세요.'};});
 const inspect=vi.fn(async()=>{pending=[];return {status:'saved' as const};}),bindings={onLeaveAction:action,onReadPendingLeaveActions:()=>pending,onInspectLeaveAction:inspect};
 const view=render(<LeaveApprovalList pendingRequests={[row]} {...bindings}/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'승인'})));expect(screen.getByRole('button',{name:'승인'})).toBeDisabled();
 view.rerender(<LeaveApprovalList pendingRequests={[]} {...bindings}/>);expect(screen.getByRole('button',{name:/보관된 휴가 작업 확인/})).toBeInTheDocument();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'휴가 작업 결과 확인'})));expect(inspect).toHaveBeenCalledExactlyOnceWith('mutation-plan');expect(action).toHaveBeenCalledOnce();
});
it('다른 UID로 바뀐 늦은 응답은 안내를 남기지 않는다',async()=>{
 const row=request('scope');let finish!:(value:SaveOutcome)=>void;const action=vi.fn(()=>new Promise<SaveOutcome>(resolve=>{finish=resolve;}));const view=render(<LeaveApprovalList requestScopeKey="uid-a" pendingRequests={[row]} onLeaveAction={action}/>);
 fireEvent.click(screen.getByRole('button',{name:'승인'}));view.rerender(<LeaveApprovalList requestScopeKey="uid-b" pendingRequests={[row]} onLeaveAction={action}/>);await act(async()=>finish({status:'unknown',message:'이전 UID 응답',nextAction:'이전 작업'}));expect(screen.queryByText(/이전 UID 응답/)).toBeNull();expect(screen.getByRole('button',{name:'승인'})).toBeEnabled();
});
