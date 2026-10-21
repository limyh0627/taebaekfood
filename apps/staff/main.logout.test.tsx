/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ tree: null as unknown, auth: { currentUser: null as null | {
            uid: string;
            isAnonymous: boolean;
            getIdTokenResult: () => Promise<{
                claims: Record<string, unknown>;
            }>;
        } }, listeners: new Set<(user: unknown) => void>(), signOut: vi.fn(), unregister: vi.fn(), capture: vi.fn(), subscriptions: 0, subscriptionStarts: 0, employee: { id: 'employee', companyId: 'taebaek', name: '합성 직원', adminAccess: true, position: '직원', department: '생산', joinDate: '', status: 'working', phone: '' } }));
vi.mock('react-dom/client', async () => {
    const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client');
    const createRoot: typeof actual.createRoot = (container, options) => {
        if ((container as HTMLElement).id === 'root')
            return { render: tree => { m.tree = tree; }, unmount: () => { } };
        return actual.createRoot(container, options);
    };
    return { ...actual, default: { ...actual, createRoot }, createRoot };
});
vi.mock('firebase/auth', () => ({ signOut: m.signOut, onIdTokenChanged: (_auth: unknown, listener: (user: unknown) => void) => { m.listeners.add(listener); listener(m.auth.currentUser); return () => m.listeners.delete(listener); } }));
vi.mock('../../src/shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), usingFirebaseEmulators: false }));
vi.mock('../../src/shared/hooks/useAppData', () => ({ useAppData: () => { React.useEffect(() => { m.subscriptions++; m.subscriptionStarts++; return () => { m.subscriptions--; }; }, []); return { employees: [m.employee], companyInfo: {} }; } }));
vi.mock('../../src/hooks/useAdminData', () => ({ useAdminData: () => ({}) }));
vi.mock('../../src/shared/components/AuthPage', () => ({ default: () => <p>검수 로그인 화면</p> }));
vi.mock('../../src/features/admin/AdminApp', () => ({ default: ({ onLogout }: {
        onLogout: () => void;
    }) => <div><p>검수 관리자 업무 화면</p><button onClick={onLogout}>검수 로그아웃</button></div> }));
vi.mock('../../src/features/staff/StaffApp', () => ({ default: ({ onLogout }: {
        onLogout: () => void;
    }) => <div><p>검수 직원 업무 화면</p><button onClick={onLogout}>검수 로그아웃</button></div> }));
vi.mock('../../components/PartnerPortal', () => ({ default: () => null }));
vi.mock('../../src/shared/services/firebaseService', () => ({ addItem: vi.fn() }));
vi.mock('../../src/shared/shareTarget', () => ({ takeShareFromUrl: () => null }));
vi.mock('../../src/shared/swUpdate', () => ({ 새버전확인붙이기: () => () => { } }));
vi.mock('../../src/shared/blockNumberWheel', () => ({ blockNumberWheel: () => () => { } }));
vi.mock('../../src/shared/push', () => ({ unregisterPush: m.unregister, capturePushActor: m.capture }));
vi.mock('../../src/shared/components/LocalTestBanner', () => ({ default: () => null }));
vi.mock('../../src/shared/components/AppAlertHost', () => ({ default: () => null }));
vi.mock('../../src/shared/components/AppDialogHost', () => ({ default: () => null }));
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const user = (uid = 'synthetic-uid') => ({ uid, isAnonymous: false, getIdTokenResult: async () => ({ claims: { employeeId: 'employee', companyId: 'taebaek', isAdmin: true } }) });
const emit = (next: ReturnType<typeof user> | null) => {
    m.auth.currentUser = next;
    for (const listener of m.listeners)
        listener(next);
};
beforeEach(() => { vi.resetModules(); localStorage.clear(); sessionStorage.clear(); m.tree = null; m.subscriptions = 0; m.subscriptionStarts = 0; m.signOut.mockReset(); m.unregister.mockReset().mockResolvedValue(undefined); m.capture.mockReset().mockReturnValue({ready:Promise.resolve(),assertCurrent:vi.fn(),dispose:vi.fn()}); m.auth.currentUser = user(); localStorage.setItem('tb_user', JSON.stringify(m.employee)); const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root); });
afterEach(() => { document.getElementById('root')?.remove(); });
const start = async () => { await import('./main'); const view = render(m.tree as React.ReactNode); await screen.findByRole('button', { name: '검수 로그아웃' }); await waitFor(() => expect(m.subscriptions).toBe(1)); return view; };
it('실 Root는 종료 대기 중 업무 구독과 로그인 화면을 숨기고 Auth null 선행 뒤에도 응답을 기다린다', async () => {
    const request = deferred();
    m.signOut.mockReturnValue(request.promise);
    await start();
    expect(m.subscriptions).toBe(1);
    const button = screen.getByRole('button', { name: '검수 로그아웃' });
    await act(async () => { button.click(); button.click(); });
    expect(m.signOut).toHaveBeenCalledTimes(1);
    expect(m.subscriptions).toBe(0);
    expect(screen.getByText('로그아웃 확인 중')).toBeInTheDocument();
    expect(screen.queryByText('검수 로그인 화면')).not.toBeInTheDocument();
    await act(async () => emit(null));
    expect(screen.getByText('로그아웃 확인 중')).toBeInTheDocument();
    expect(localStorage.getItem('tb_user')).not.toBeNull();
    await act(async () => request.resolve());
    expect(await screen.findByText('검수 로그인 화면')).toBeInTheDocument();
    expect(localStorage.getItem('tb_user')).toBeNull();
    expect(m.unregister).toHaveBeenCalledTimes(1);
});
it('거절은 차단 화면에 원인을 남기고 명시 재시도 성공 뒤에만 로그인으로 돌아간다', async () => {
    const first = deferred(), second = deferred();
    m.signOut.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await start();
    await act(async () => screen.getByRole('button', { name: '검수 로그아웃' }).click());
    await act(async () => first.reject(Error('연결 거절 검수')));
    expect(await screen.findByText('연결 거절 검수')).toBeInTheDocument();
    expect(screen.queryByText('검수 로그인 화면')).not.toBeInTheDocument();
    expect(m.subscriptions).toBe(0);
    expect(localStorage.getItem('tb_user')).not.toBeNull();
    await act(async () => screen.getByRole('button', { name: '다시 로그아웃' }).click());
    expect(screen.getByText('로그아웃 확인 중')).toBeInTheDocument();
    await act(async () => { emit(null); second.resolve(); });
    expect(await screen.findByText('검수 로그인 화면')).toBeInTheDocument();
    expect(m.signOut).toHaveBeenCalledTimes(2);
    expect(m.unregister).toHaveBeenCalledTimes(1);
});
it('SDK가 resolve해도 Auth가 남으면 업무나 로그인으로 복귀하지 않는다', async () => {
    m.signOut.mockResolvedValue(undefined);
    await start();
    await act(async () => screen.getByRole('button', { name: '검수 로그아웃' }).click());
    expect(await screen.findByText('로그아웃 확인 필요')).toBeInTheDocument();
    expect(screen.queryByText('검수 로그인 화면')).not.toBeInTheDocument();
    expect(m.subscriptions).toBe(0);
    expect(localStorage.getItem('tb_user')).not.toBeNull();
});
it.each(['resolve', 'reject'] as const)('새 계정 검증 뒤 옛 로그아웃 %s는 새 세션을 지우지 않는다', async (outcome) => {
    const request = deferred();
    m.signOut.mockReturnValue(request.promise);
    await start();
    await act(async () => screen.getByRole('button', { name: '검수 로그아웃' }).click());
    await act(async () => emit(user('new-uid')));
    await screen.findByRole('button', { name: '검수 로그아웃' });
    const saved = localStorage.getItem('tb_user');
    await act(async () => outcome === 'resolve' ? request.resolve() : request.reject(Error('옛 실패')));
    expect(screen.getByRole('button', { name: '검수 로그아웃' })).toBeInTheDocument();
    expect(localStorage.getItem('tb_user')).toBe(saved);
    expect(screen.queryByText('검수 로그인 화면')).not.toBeInTheDocument();
    expect(screen.queryByText('옛 실패')).not.toBeInTheDocument();
});
it('실 Root 재마운트에서도 실패한 로그아웃의 차단과 명시 재시도를 유지한다', async () => {
    m.signOut.mockRejectedValue(Error('재마운트 전 종료 실패'));
    const first = await start();
    await act(async () => screen.getByRole('button', { name: '검수 로그아웃' }).click());
    await screen.findByText('재마운트 전 종료 실패');
    const starts = m.subscriptionStarts;
    first.unmount();
    render(m.tree as React.ReactNode);
    await waitFor(() => expect(m.listeners.size).toBeGreaterThan(0));
    await act(async () => Promise.resolve());
    expect(screen.queryByRole('button', { name: '검수 로그아웃' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 로그아웃' })).toBeInTheDocument();
    expect(screen.queryByText('검수 로그인 화면')).not.toBeInTheDocument();
    expect(m.signOut).toHaveBeenCalledTimes(1);
    expect(m.subscriptionStarts).toBe(starts);
    const retry = deferred();
    m.signOut.mockReturnValue(retry.promise);
    await act(async () => screen.getByRole('button', { name: '다시 로그아웃' }).click());
    expect(screen.getByText('로그아웃 확인 중')).toBeInTheDocument();
    await act(async () => { emit(null); retry.resolve(); });
    expect(await screen.findByText('검수 로그인 화면')).toBeInTheDocument();
    expect(m.signOut).toHaveBeenCalledTimes(2);
});
