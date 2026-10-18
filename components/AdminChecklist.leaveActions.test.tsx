import type {SaveOutcome} from '../src/shared/saveOutcome';
/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import AdminChecklist from './AdminChecklist';
import type {LeaveRequest} from '../src/shared/types';
const row:LeaveRequest={id:'leave',employeeId:'employee',employeeName:'합성 직원',type:'연차',startDate:'2025-02-03',endDate:'2025-02-04',reason:'원래 휴가',status:'approved',requestedAt:'2025-02-01',daysUsed:2,modifyRequest:{status:'pending',startDate:'2025-02-05',endDate:'2025-02-05',reason:'변경 사유',daysUsed:1}};
const props=()=>({leaveRequests:[row],employees:[],adjustmentRequests:[],onUpdateAdjustmentStatus:vi.fn(),onProcessAdjustment:vi.fn(),onLeaveAction:vi.fn().mockResolvedValue({status:'saved'})});
it('변경 신청 승인은 일반 status 승인이 아닌 표시한 원문과 변경 승인 action을 보낸다',async()=>{
 const p=props();render(<AdminChecklist {...p}/>);fireEvent.click(screen.getByRole('button',{name:/연차/}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'변경 승인'})));expect(p.onLeaveAction).toHaveBeenCalledExactlyOnceWith(row,{action:'approve-modify'});expect(row.startDate).toBe('2025-02-03');
});
it('변경 반려는 기본 휴가를 덮어쓰지 않고 취소 뒤 남은 변경 버튼도 표시하지 않는다',async()=>{
 const p=props(),view=render(<AdminChecklist {...p}/>);fireEvent.click(screen.getByRole('button',{name:/연차/}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'변경 반려'})));expect(p.onLeaveAction).toHaveBeenCalledExactlyOnceWith(row,{action:'reject-modify'});view.rerender(<AdminChecklist {...p} leaveRequests={[{...row,status:'cancelled'}]}/>);expect(screen.queryByRole('button',{name:'변경 승인'})).toBeNull();
});
it('결재 ACK 전 중복 클릭을 막고 미확정은 새 요청 대신 복구 행동을 보여 준다',async()=>{
 let finish!:(value:SaveOutcome)=>void;const p=props();p.onLeaveAction.mockImplementation(()=>new Promise<SaveOutcome>(resolve=>{finish=resolve;}));render(<AdminChecklist {...p}/>);fireEvent.click(screen.getByRole('button',{name:/연차/}));const button=screen.getByRole('button',{name:'변경 승인'});fireEvent.click(button);fireEvent.click(button);expect(p.onLeaveAction).toHaveBeenCalledOnce();expect(button).toBeDisabled();await act(async()=>finish({status:'unknown',message:'변경 승인 결과 미확인',nextAction:'결과 확인 또는 요청 중단을 선택하세요.'}));expect(button).toBeDisabled();expect(screen.getByRole('button',{name:'휴가 작업 요청 중단'})).toBeInTheDocument();
});
