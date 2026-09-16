// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthPage from './AuthPage';
import { loginEmployee } from '../employeeAuth';

vi.mock('../employeeAuth', () => ({ loginEmployee: vi.fn() }));

const 로그인 = vi.mocked(loginEmployee);
const 직원 = {
  id: 'admin-punghoe', companyId: 'punghoe' as const, name: '관리자', username: 'pung',
  position: '', department: '', phone: '', joinDate: '', status: 'working' as const, adminAccess: true,
};

describe('공용 로그인 화면', () => {
  beforeEach(() => 로그인.mockReset());

  it('관리자 앱은 선택한 회사를 로그인 요청에 넣는다', async () => {
    로그인.mockResolvedValue(직원);
    const onLogin = vi.fn();
    render(<AuthPage app="admin" onLogin={onLogin} />);

    expect(screen.getByText('관리자 앱')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '풍회' }));
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'pung' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: '시스템 접속하기' }));

    await waitFor(() => expect(로그인).toHaveBeenCalledWith('pung', '0000', 'admin', 'punghoe'));
    expect(onLogin).toHaveBeenCalledWith(직원);
  });

  it('직원 앱은 회사 선택을 보이지 않고 회사값을 보내지 않는다', async () => {
    로그인.mockResolvedValue({ ...직원, id: 'e1', companyId: 'taebaek', adminAccess: false });
    render(<AuthPage app="staff" onLogin={vi.fn()} />);

    expect(screen.getByText('직원 앱')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: '로그인 회사 선택' })).toBeNull();
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'worker' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '시스템 접속하기' }));

    await waitFor(() => expect(로그인).toHaveBeenCalledWith('worker', 'pw', 'staff', undefined));
  });
});
