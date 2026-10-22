/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LeaveManager from './LeaveManager';
import type { Employee, CompanyId } from '../types';
const ports = vi.hoisted(() => ({ subscribe: vi.fn(), save: vi.fn(), auth: { currentUser: { uid: 'uid-a' }, onAuthStateChanged: vi.fn(() => () => { }) } }));
vi.mock('../src/shared/services/orgChartService', () => ({ subscribeOrgChart: ports.subscribe, saveOrgChart: ports.save }));
vi.mock('../src/shared/firebase', () => ({ auth: ports.auth }));
const employee: Employee = { id: 'emp', companyId: 'taebaek', name: '직원', position: '사원', department: '생산팀', joinDate: '2020-01-01', phone: '', status: 'working' };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function props(companyId: CompanyId) { return { companyId, currentUser: { ...employee, companyId }, employees: [{ ...employee, companyId }], leaveRequests: [], onAddLeaveRequest: vi.fn(), onLeaveAction: vi.fn(), isAdmin: true }; }
function open() { fireEvent.click(screen.getByRole('button', { name: '조직도·연락망' })); fireEvent.click(screen.getByRole('button', { name: '편집' })); }
it('회사 변경 뒤 이전 회사 조직도 초안을 새 회사에 보내지 않는다', async () => {
    ports.subscribe.mockImplementation((_scope, callback) => { callback(null); return () => { }; });
    ports.save.mockResolvedValue(undefined);
    const view = render(<LeaveManager {...props('taebaek')}/>);
    open();
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: 'A회사 초안' } });
    view.rerender(<LeaveManager {...props('punghoe')}/>);
    const save = screen.queryByRole('button', { name: '저장' });
    if (save)
        fireEvent.click(save);
    await act(async () => { await Promise.resolve(); });
    expect(ports.save).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('A회사 초안')).toBeNull();
});
it('이전 회사 저장 응답은 새 회사 편집 초안을 닫지 않는다', async () => {
    ports.subscribe.mockImplementation((_scope, callback) => { callback(null); return () => { }; });
    let finish!: () => void;
    ports.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<LeaveManager {...props('taebaek')}/>);
    open();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(ports.save).toHaveBeenCalledOnce());
    view.rerender(<LeaveManager {...props('punghoe')}/>);
    const edit = screen.queryByRole('button', { name: '편집' });
    if (edit)
        fireEvent.click(edit);
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: 'B회사 새 초안' } });
    await act(async () => { finish(); await Promise.resolve(); });
    expect(screen.queryByDisplayValue('B회사 새 초안')).toBeInTheDocument();
});
it('저장대기에는입력과취소를잠그고실패뒤같은초안을유지한다', async () => { ports.subscribe.mockImplementation((_scope, callback) => { callback(null); return () => { }; }); let reject!: (e: Error) => void; ports.save.mockImplementation(() => new Promise<void>((_r, j) => { reject = j; })); render(<LeaveManager {...props('taebaek')}/>); open(); fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '보존초안' } }); fireEvent.click(screen.getByRole('button', { name: '저장' })); expect(screen.getByPlaceholderText('이름')).toBeDisabled(); expect(screen.getByRole('button', { name: '취소' })).toBeDisabled(); await act(async () => { reject(Error('응답유실')); }); expect(screen.getByPlaceholderText('이름')).toHaveValue('보존초안'); expect(screen.getByPlaceholderText('이름')).toBeEnabled(); expect(screen.getByRole('alert')).toHaveTextContent('확인하지 못했습니다'); });
