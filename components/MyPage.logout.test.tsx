/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Employee } from '../types';
import MyPage from './MyPage';
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: confirm }));
vi.mock('../src/shared/notify', () => ({
  notify: vi.fn(), notifySupported: () => false, notifyPermission: () => 'default',
  askNotifyPermission: vi.fn(), notifyDiagnose: vi.fn(), loadNotifyMode: () => 'all',
  saveNotifyMode: vi.fn(), loadNotifyVolume: () => 'normal', saveNotifyVolume: vi.fn(), playChime: vi.fn(),
}));
vi.mock('../src/shared/push', () => ({ registerPush: vi.fn(), unregisterPush: vi.fn(),
  pushSupported: () => false, pushMuted: () => false, setPushMuted: vi.fn() }));
vi.mock('../src/shared/deviceLabel', () => ({ currentDeviceLabel: () => '시험 기기' }));

it('StrictMode에서 연속 클릭을 한 번만 확인하고 취소 후 재시도를 허용한다', async () => {
  let resolve!: (result: boolean) => void;
  confirm.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
  const logout = vi.fn();
  render(<React.StrictMode><MyPage currentUser={{ id: 'e', name: '직원', role: 'staff' } as Employee}
    onLogout={logout} /></React.StrictMode>);
  const button = screen.getByRole('button', { name: '로그아웃' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => resolve(false));
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(2);
  await act(async () => resolve(true));
  expect(logout).toHaveBeenCalledTimes(1);
});
