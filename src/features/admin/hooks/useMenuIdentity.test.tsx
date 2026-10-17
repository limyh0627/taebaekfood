/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
interface Token { claims: Record<string, unknown> }
interface TestUser { uid: string; getIdTokenResult: () => Promise<Token> }
const mocks = vi.hoisted(() => ({ auth: { currentUser: null as { uid: string } | null }, listen: vi.fn(), stop: vi.fn() }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: mocks.listen }));
vi.mock('../../../shared/firebase', () => ({ auth: mocks.auth }));
import { useMenuIdentity } from './useMenuIdentity';
let callback: (user: TestUser | null) => void;
function pending(uid = 'u') { let resolve!: (token: Token) => void, reject!: (error: Error) => void; const promise = new Promise<Token>((yes, no) => { resolve = yes; reject = no; }); return { user: { uid, getIdTokenResult: () => promise }, resolve, reject }; }
const claims = (employeeId = 'e', admin: unknown = false): Token => ({ claims: { employeeId, companyId: 'taebaek', isAdmin: admin } });
function emit(user: TestUser | null) { mocks.auth.currentUser = user && { uid: user.uid }; act(() => callback(user)); }
beforeEach(() => { mocks.auth.currentUser = null; mocks.stop.mockReset(); mocks.listen.mockReset(); mocks.listen.mockImplementation((_auth: unknown, cb: typeof callback) => { callback = cb; return mocks.stop; }); });
it('계정 교체 중 이전 토큰은 적용하지 않고 현재 claims 신원만 적용한다', async () => {
 const { result } = renderHook(() => useMenuIdentity()), a = pending('a'), b = pending('b'); emit(a.user); emit(b.user);
 await act(async () => a.resolve(claims('old', true))); expect(result.current).toBeNull();
 await act(async () => b.resolve(claims('new', true))); expect(result.current).toEqual({ uid: 'b', employeeId: 'new', companyId: 'taebaek', admin: true });
});
it('같은 UID의 역순 토큰 완료도 최신 발화 세대만 적용한다', async () => {
 const { result } = renderHook(() => useMenuIdentity()), old = pending(), current = pending(); emit(old.user); emit(current.user);
 await act(async () => current.resolve(claims('current'))); await act(async () => old.resolve(claims('old', true)));
 expect(result.current).toEqual({ uid: 'u', employeeId: 'current', companyId: 'taebaek', admin: false });
});
it('이전 실패는 새 신원을 지우지 않고 현재 토큰 실패는 신원을 비운다', async () => {
 const { result } = renderHook(() => useMenuIdentity()), old = pending(), current = pending(); emit(old.user); emit(current.user);
 await act(async () => current.resolve(claims('current'))); await act(async () => old.reject(Error('old failed'))); expect(result.current?.employeeId).toBe('current');
 const failed = pending(); emit(failed.user); expect(result.current).toBeNull(); await act(async () => failed.reject(Error('failed'))); expect(result.current).toBeNull();
});
it('로그아웃은 즉시 비우고 미완료 토큰의 늦은 성공을 무시한다', async () => {
 const { result } = renderHook(() => useMenuIdentity()), first = pending(); emit(first.user); await act(async () => first.resolve(claims())); expect(result.current?.uid).toBe('u');
 const next = pending(); emit(next.user); emit(null); await act(async () => next.resolve(claims())); expect(result.current).toBeNull();
});
it('claims 문자열과 실제 현재 UID를 확인하며 admin은 true만 인정한다', async () => {
 const { result } = renderHook(() => useMenuIdentity()), invalid = pending(); emit(invalid.user); await act(async () => invalid.resolve({ claims: { employeeId: 1, companyId: 'taebaek' } })); expect(result.current).toBeNull();
 const valid = pending(); emit(valid.user); await act(async () => valid.resolve(claims('e', 'true'))); expect(result.current?.admin).toBe(false);
 const stale = pending(); emit(stale.user); mocks.auth.currentUser = { uid: 'other' }; await act(async () => stale.resolve(claims())); expect(result.current).toBeNull();
});
it('재렌더는 인증 구독을 만들지 않으며 해제 후 완료는 재구독에 섞이지 않는다', async () => {
 const first = renderHook(() => useMenuIdentity()), old = pending(); emit(old.user); first.rerender(); expect(mocks.listen).toHaveBeenCalledOnce(); first.unmount(); expect(mocks.stop).toHaveBeenCalledOnce();
 const second = renderHook(() => useMenuIdentity()), current = pending(); emit(current.user); await act(async () => current.resolve(claims('second'))); await act(async () => old.resolve(claims('old'))); expect(second.result.current?.employeeId).toBe('second'); second.unmount(); expect(mocks.stop).toHaveBeenCalledTimes(2);
});
