/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Employee } from '../../types';
import { EmployeeDirectory } from './EmployeeDirectory';
vi.mock('../../src/shared/services/retirementBenefitCommands', () => ({ readRetirement: vi.fn(async () => ({ profile: null })), retirementActor: vi.fn(async () => 'uid') }));
vi.mock('./RetirementBenefitPanel', () => ({ default: ({ employee }: { employee: Employee }) => <div>퇴직금패널 {employee.name}</div> }));
vi.mock('../../src/shared/services/firebaseService', () => ({ subscribeToCollection: vi.fn(() => () => {}), setDocument: vi.fn() }));
import HRManager from '../HRManager';
const employee = (id: string, healthCertDate?: string): Employee => ({ id, companyId: 'taebaek', name: id, position: '사원', department: '생산팀', joinDate: '2020-01-01', phone: '010-0000-0000', status: 'working', healthCertDate });
afterEach(() => { vi.useRealTimers(); });
it('검색 입력은 controlled 값을 보존하고 각 행의 원직원 객체를 전달한다', () => {
 const employees = [employee('가직원'), employee('나직원')]; const onSearchChange = vi.fn(), onRetirement = vi.fn(), onEdit = vi.fn(), onDelete = vi.fn();
 render(<EmployeeDirectory filteredEmployees={employees} searchTerm="원검색" onSearchChange={onSearchChange} calculateWorkDays={() => 100} getHealthCertStatus={() => ({ expiry: '', daysLeft: 1 })} onRetirement={onRetirement} onEdit={onEdit} onDelete={onDelete} />);
 const input = screen.getByPlaceholderText('이름 또는 부서 검색...'); fireEvent.change(input, { target: { value: '새검색' } }); expect(onSearchChange).toHaveBeenCalledExactlyOnceWith('새검색'); expect(input).toHaveValue('원검색');
 const row = screen.getByText('나직원').closest('tr')!;
 fireEvent.click(within(row).getByRole('button', { name: '퇴직금' })); fireEvent.click(within(row).getByRole('button', { name: '나직원 정보 수정' })); fireEvent.click(within(row).getByRole('button', { name: '나직원 삭제' }));
 for (const callback of [onRetirement, onEdit, onDelete]) expect(callback).toHaveBeenCalledExactlyOnceWith(employees[1]);
});
it('실제 부모의 보건증 만료·30일 경계와 미등록, 회사·검색 필터를 유지한다', () => {
 vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
 const employees = [employee('미등록'), employee('만료', '2025-10-18'), employee('경고', '2025-11-17'), employee('정상', '2025-11-18'), { ...employee('다른회사'), companyId: 'punghoe' as const }];
 render(<HRManager employees={employees} leaveRequests={[]} onUpdateEmployee={vi.fn()} onAddEmployee={vi.fn()} onDeleteEmployee={vi.fn()} onUpdateLeaveStatus={vi.fn()} onUpdateLeave={vi.fn()} onDeleteLeaveRequest={vi.fn()} />);
 expect(screen.queryByText('다른회사')).not.toBeInTheDocument(); expect(screen.getByText('미등록', { selector: 'span' })).toBeInTheDocument(); expect(screen.getByText('만료됨')).toBeInTheDocument(); expect(screen.getByText('D-30')).toHaveClass('text-amber-600'); expect(screen.getByText('D-31')).toHaveClass('text-emerald-600');
 fireEvent.change(screen.getByPlaceholderText('이름 또는 부서 검색...'), { target: { value: '정상' } }); expect(screen.queryByText('경고')).not.toBeInTheDocument(); expect(screen.getByText('정상')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: '정상 정보 수정' })); expect(within(screen.getByRole('dialog')).getByDisplayValue('정상')).toBeInTheDocument(); expect(within(screen.getByRole('dialog')).getByDisplayValue('2025-11-18')).toBeInTheDocument();
});
it('명부 검색칸은 주문형40px로 유지하면서 원래 검색 콜백을 바꾸지 않는다',()=>{const search=vi.fn();render(<EmployeeDirectory filteredEmployees={[]} searchTerm="" onSearchChange={search} calculateWorkDays={()=>0} getHealthCertStatus={()=>({expiry:'',daysLeft:0})} onRetirement={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}/>);const input=screen.getByPlaceholderText('이름 또는 부서 검색...');expect(input).toHaveClass('h-10','bg-slate-50','border-slate-200');fireEvent.change(input,{target:{value:'생산팀'}});expect(search).toHaveBeenCalledExactlyOnceWith('생산팀');expect(screen.getByRole('region',{name:'검색조건'})).toContainElement(input);expect(screen.getByLabelText('이름 또는 부서')).toBe(input);fireEvent.click(screen.getByRole('button',{name:'초기화'}));expect(search).toHaveBeenLastCalledWith('');});
