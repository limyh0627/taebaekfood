/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ confirm: vi.fn(), add: vi.fn(), update: vi.fn() }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: m.confirm }));
vi.mock('../src/shared/services/firebaseService', () => ({ addItem: m.add, updateItem: m.update }));
import AdminChecklist from './AdminChecklist';
import type { ReturnRequest } from '../src/shared/types';
const request = { id: 'r', companyId: 'taebaek', partnerId: 'p', partnerName: '합성 거래처', status: 'pending', createdAt: '2026-10-07T00:00:00Z',
  linkedStatementId: 's', totalAmount: 100, items: [{ itemId: 'box', name: '박스', quantity: 1, price: 100, reason: '기타', isResellable: false }] } as ReturnRequest;
const base = { leaveRequests: [], adjustmentRequests: [], employees: [], returnRequests: [request],
  onUpdateLeaveStatus: vi.fn(), onUpdateAdjustmentStatus: vi.fn(), onProcessAdjustment: vi.fn() };
beforeEach(() => { vi.resetAllMocks(); m.confirm.mockResolvedValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(cleanup);
it('관리자 확인창에서 원자 처리 callback을 기다리며 옛 writer와 임의 전표 작성창은 없다', async () => {
  let resolve!: () => void; const process = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  render(<AdminChecklist {...base} onProcessReturn={process} />);
  fireEvent.click(screen.getByRole('button', { name: /반품 원자 처리/ }));
  await waitFor(() => expect(process).toHaveBeenCalledExactlyOnceWith(request));
  expect((screen.getByRole('button', { name: /처리 중/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(m.add).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  resolve(); await waitFor(() => expect((screen.getByRole('button', { name: /반품 원자 처리/ }) as HTMLButtonElement).disabled).toBe(false));
});
it('callback 미연결 또는 서버 실패에서 성공으로 표시하거나 개별 전표를 만들지 않는다', async () => {
  const view = render(<AdminChecklist {...base} />);
  expect((screen.getByRole('button', { name: /반품 원자 처리/ }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<AdminChecklist {...base} onProcessReturn={vi.fn().mockRejectedValue(new Error('서버 거절'))} />);
  fireEvent.click(screen.getByRole('button', { name: /반품 원자 처리/ }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('서버 거절'));
  expect(screen.getByText('합성 거래처')).toBeTruthy(); expect(m.add).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
