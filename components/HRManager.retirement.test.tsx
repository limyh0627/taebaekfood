/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), actor: vi.fn(async () => 'uid') }));
vi.mock('../src/shared/services/retirementBenefitCommands', () => ({ readRetirement: mocks.read, retirementActor: mocks.actor }));
vi.mock('./hr/RetirementBenefitPanel', () => ({ default: ({ employee, onClose }: any) => <div>퇴직금패널 {employee.name}<button onClick={onClose}>패널 닫기</button></div> }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: vi.fn(() => () => {}), setDocument: vi.fn() }));
import HRManager from './HRManager';
const employee = { id: 'e1', companyId: 'taebaek' as const, name: '합성직원', position: '', department: '', joinDate: '2020-01-01', phone: '', status: 'working' as const };
const props = () => ({ employees: [employee], leaveRequests: [], onUpdateEmployee: vi.fn(), onAddEmployee: vi.fn(), onDeleteEmployee: vi.fn(async () => {}), onUpdateLeaveStatus: vi.fn(), onUpdateLeave: vi.fn(), onDeleteLeaveRequest: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ profile: null }); });
function requestDelete(container: HTMLElement) { fireEvent.click(container.querySelector('button:has(svg.lucide-trash2)')!); fireEvent.click(screen.getByRole('button', { name: '삭제' })); }
it('직원 행의 퇴직금 진입은 회사·직원을 유지한다', async () => { render(<HRManager {...props()} companyId="taebaek" />); fireEvent.click(screen.getByText('퇴직금')); expect(screen.getByText('퇴직금패널 합성직원')).toBeInTheDocument(); });
it('퇴직금 프로필이 있으면 실삭제하지 않고 퇴사 처리로 안내한다', async () => { mocks.read.mockResolvedValue({ profile: { id: 'p' } }); const p = props(); const view = render(<HRManager {...p} companyId="taebaek" />); requestDelete(view.container); await screen.findByText(/정보 수정에서 상태를 퇴사/); expect(p.onDeleteEmployee).not.toHaveBeenCalled(); });
it('조회 실패는 미등록으로 보지 않고 삭제하지 않는다', async () => { mocks.read.mockRejectedValue(Error('조회 유실')); const p = props(); const view = render(<HRManager {...p} companyId="taebaek" />); requestDelete(view.container); await screen.findByText(/등록 여부를 확인하지 못해 삭제하지/); expect(p.onDeleteEmployee).not.toHaveBeenCalled(); });
it('명시 미등록이면 실제 Promise 삭제 완료를 기다린다', async () => { let finish!: () => void; const p = props(); p.onDeleteEmployee.mockImplementation(() => new Promise<void>(r => { finish = r; })); const view = render(<HRManager {...p} companyId="taebaek" />); requestDelete(view.container); await waitFor(() => expect(p.onDeleteEmployee).toHaveBeenCalledWith('e1')); expect(screen.queryByText('직원 삭제를 완료했습니다.')).not.toBeInTheDocument(); await act(async () => finish()); expect(screen.getByText('직원 삭제를 완료했습니다.')).toBeInTheDocument(); });
it('회사 전환 후 늦은 미등록 조회는 실삭제하지 않는다', async () => { let finish!: (v: any) => void; mocks.read.mockImplementation(() => new Promise(r => { finish = r; })); const p = props(); const view = render(<HRManager {...p} companyId="taebaek" />); requestDelete(view.container); await waitFor(() => expect(mocks.read).toHaveBeenCalled()); view.rerender(<HRManager {...p} companyId="punghoe" />); await act(async () => finish({ profile: null })); expect(p.onDeleteEmployee).not.toHaveBeenCalled(); });

it('상단 메뉴와 직원 관리 버튼은 공통 크기·줄바꿈 방지를 유지한다',()=>{
 render(<HRManager {...props()} companyId="taebaek"/>);
 const menus=screen.getByRole('group',{name:'인사 메뉴'});expect(menus).toHaveClass('overflow-x-auto','whitespace-nowrap');
 for(const button of within(menus).getAllByRole('button'))expect(button).toHaveClass('h-9','text-xs','font-semibold','whitespace-nowrap','shrink-0');
 expect(within(menus).getByRole('button',{name:'임직원'})).toHaveAttribute('aria-pressed','true');
 const retirement=screen.getByRole('button',{name:'퇴직금'});expect(retirement).toHaveClass('h-9','text-xs','font-semibold','whitespace-nowrap','shrink-0');
 expect(retirement.closest('td')).toHaveClass('min-w-[192px]','whitespace-nowrap');expect(retirement.parentElement).toHaveClass('flex-nowrap','shrink-0');
 expect(retirement.closest('table')?.parentElement).toHaveClass('overflow-auto');
 expect(screen.getByRole('button',{name:'합성직원 정보 수정'})).toHaveClass('h-9','w-9');expect(screen.getByRole('button',{name:'합성직원 삭제'})).toHaveClass('h-9','w-9');
});
it('상단 탭 선택과 직원 등록·휴가 액션은 기존 화면을 연다',()=>{
 render(<HRManager {...props()} companyId="taebaek"/>);
 const register=screen.getByRole('button',{name:'직원 등록'});expect(register).toHaveClass('bg-indigo-600');fireEvent.click(register);expect(screen.getByRole('dialog',{name:'신규 직원 등록'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'신규 직원 등록 닫기'}));fireEvent.click(screen.getByRole('button',{name:'연차 관리'}));expect(screen.getByRole('button',{name:'연차 관리'})).toHaveAttribute('aria-pressed','true');
 const vacation=screen.getByRole('button',{name:'휴가'});expect(vacation).toHaveClass('h-9','text-xs','font-semibold','bg-indigo-600');fireEvent.click(vacation);expect(screen.getByRole('dialog')).toBeInTheDocument();
});
