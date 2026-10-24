/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: { uid: 'a' } as { uid: string } | null, listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('../../../shared/firebase', () => ({ auth: { get currentUser() { return m.user; }, onAuthStateChanged: (callback: (user: { uid: string } | null) => void) => { m.listeners.add(callback); return () => m.listeners.delete(callback); } } }));
import { useHaccpRecordActor } from './useHaccpRecordActor';
const options = { companyId: 'taebaek' as const, currentUserId: 'employee', isAdmin: true, canConfirm: true };
beforeEach(() => { m.user = { uid: 'a' }; m.listeners.clear(); });
it('현재 실제 UID를 동기로 검사하고 권한은 최신 props에서 확인한다', () => {
  const h = renderHook(props => useHaccpRecordActor(props), { initialProps: options });
  const first = h.result.current, token = first.ownerToken;
  h.rerender({ ...options, isAdmin: false, canConfirm: false });
  expect(h.result.current.ownerToken).toBe(token);
  expect(first.canAct('save', token)).toBe(true);
  expect(first.canAct('confirm', token)).toBe(false);
  expect(first.canAct('delete', token)).toBe(false);
  m.user = { uid: 'b' };
  expect(first.isCurrent(token)).toBe(false);
  expect(first.canAct('save', token)).toBe(false);
});
it('회사 및 직원 교체는 이전 owner를 폐기한다', () => {
  const h = renderHook(props => useHaccpRecordActor(props), { initialProps: { ...options, companyId: 'taebaek' as 'taebaek' | 'punghoe' } });
  const a = h.result.current;
  h.rerender({ ...options, companyId: 'punghoe' });
  expect(a.isCurrent(a.ownerToken)).toBe(false);
  const b = h.result.current;
  h.rerender({ ...options, currentUserId: 'other', companyId: 'punghoe' });
  expect(b.isCurrent(b.ownerToken)).toBe(false);
});
it('UID 알림의 ABA 뒤에도 이전 owner는 살아나지 않는다', () => {
  const h = renderHook(() => useHaccpRecordActor(options));
  const a = h.result.current;
  act(() => { m.user = { uid: 'b' }; for (const callback of [...m.listeners]) callback(m.user); });
  act(() => { m.user = { uid: 'a' }; for (const callback of [...m.listeners]) callback(m.user); });
  expect(h.result.current.ownerToken).not.toBe(a.ownerToken);
  expect(a.isCurrent(a.ownerToken)).toBe(false);
  expect(h.result.current.canAct('delete')).toBe(true);
});
it('로그아웃 송신 차단과 unmount 구독 정리를 보장한다', () => {
  const h = renderHook(() => useHaccpRecordActor(options));
  const a = h.result.current;
  expect(m.listeners.size).toBe(1);
  h.unmount();
  expect(m.listeners.size).toBe(0);
  expect(a.isCurrent(a.ownerToken)).toBe(false);
  m.user = null;
  const loggedOut = renderHook(() => useHaccpRecordActor(options));
  expect(loggedOut.result.current.canAct('save')).toBe(false);
});
