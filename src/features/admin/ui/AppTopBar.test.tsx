/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Employee } from '../../../shared/types';
import { accountProfileImageUrl } from '../../../../components/AccountMenu';
import { AppTopBar } from './AppTopBar';
const currentUser: Employee = { id: '직원 /1', name: '합성 직원', position: '사원', department: '생산', joinDate: '2020-01-01', phone: '', status: 'working' };
const props = () => ({ currentView: 'mypage' as const, currentUser, hasUnreadNotifications: false, helpAvailable: true, onOpenMenu: vi.fn(), onOpenHelp: vi.fn(), onOpenNotifications: vi.fn() });
it('실제 제목·프로필·메뉴와 챗봇 바로 다음 알림 순서를 유지하고 원이벤트를 전달한다', () => {
 const p = props(); render(<AppTopBar {...p} />);
 expect(screen.getByText('마이페이지')).toHaveClass('truncate'); expect(screen.getByRole('img', { name: '합성 직원 프로필' })).toHaveAttribute('src', accountProfileImageUrl(currentUser.id));
 const menu = screen.getByRole('button', { name: '메뉴 열기' }), help = screen.getByRole('button', { name: '챗봇 열기' }), bell = screen.getByRole('button', { name: '알림' });
 expect(menu).toHaveClass('xl:hidden'); expect(help.closest('header')).not.toHaveClass('xl:hidden'); expect(help.nextElementSibling).toBe(bell); expect(help).toHaveAttribute('aria-keyshortcuts', 'Alt+/'); expect(help).toHaveClass('min-h-11');
 let target: EventTarget | null = null; p.onOpenNotifications.mockImplementation((event: React.MouseEvent<HTMLButtonElement>) => { target = event.currentTarget; });
 fireEvent.click(menu); fireEvent.click(help); fireEvent.click(bell); expect(p.onOpenMenu).toHaveBeenCalledOnce(); expect(p.onOpenHelp).toHaveBeenCalledOnce(); expect(target).toBe(bell);
});
it('로그인 신원 확인 전 챗봇을 비활성화하고 도움말 콜백을 실행하지 않는다', () => {
 const p = props(); render(<AppTopBar {...p} helpAvailable={false} />); const help = screen.getByRole('button', { name: '챗봇 열기' }); expect(help).toBeDisabled(); expect(help).toHaveAttribute('title', '로그인 계정을 확인한 뒤 챗봇을 열 수 있습니다.'); fireEvent.click(help); expect(p.onOpenHelp).not.toHaveBeenCalled();
});
it('제목 별칭과 알림 표식은 전달받은 값만 반영한다', () => {
 const p = props(), view = render(<AppTopBar {...p} currentView="shipping" hasUnreadNotifications />); expect(screen.getByText('주문·배송')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '알림' }).querySelector('span')).not.toBeNull();
 view.rerender(<AppTopBar {...p} currentView="orders" />); expect(screen.getByText('주문·배송')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '알림' }).querySelector('span')).toBeNull();
});
