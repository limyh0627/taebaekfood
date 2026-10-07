// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import BenzopyreneLog from './BenzopyreneLog';
import * as services from '../src/shared/services/firebaseService';

const state = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), subscriptions: [] as any[], rows: [] as any[] }));
vi.mock('../src/shared/firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: { currentUser: {
  getIdTokenResult: async () => ({ claims: { companyId: 'taebaek' } }),
} } }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }),
  query: (ref: any, ...constraints: any[]) => ({ ...ref, constraints }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  onSnapshot: (ref: any, callback: any) => {
    const unsubscribe = vi.fn();
    state.subscriptions.push({ ref, callback, unsubscribe });
    const rows = ref.constraints[0].value === 'taebaek' ? state.rows : [];
    callback({ docs: rows.map(row => ({ id: row.id, data: () => row })) });
    return unsubscribe;
  },
  updateDoc: state.update, deleteDoc: state.remove, addDoc: vi.fn(), setDoc: vi.fn(),
  getDocs: vi.fn(), getDoc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(), documentId: vi.fn(), arrayUnion: vi.fn(),
}));
beforeEach(() => {
  state.update.mockReset().mockResolvedValue(undefined);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.subscriptions = [];
  state.rows = [{ id: 'synthetic-test', companyId: 'taebaek', productName: '합성 검사 제품', receivedDate: '2026-10-01',
    completedDate: '2026-10-02', testItem: '벤조피렌', criteria: '합성 기준', result: '0.1', judgment: '적합', createdAt: '2026-10-02' }];
  vi.spyOn(services, 'updateItem');
  vi.spyOn(services, 'deleteItem');
});

it('검사 수정은 공용 서비스를 통해 회사 claim을 포함하며 실패하면 편집 내용을 유지한다', async () => {
  state.update.mockRejectedValueOnce(new Error('synthetic failure'));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<BenzopyreneLog companyId="taebaek" isAdmin currentUserName="합성 담당" />);
  fireEvent.click(screen.getByRole('button', { name: '수정' }));
  fireEvent.change(screen.getByDisplayValue('0.1'), { target: { value: '0.2' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalled());
  expect(screen.getByDisplayValue('0.2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2));
  expect(services.updateItem).toHaveBeenCalledWith('benzopyreneTests', 'synthetic-test', expect.objectContaining({ result: '0.2' }));
  expect(state.update).toHaveBeenLastCalledWith({ collection: 'benzopyreneTests', id: 'synthetic-test' }, expect.objectContaining({ result: '0.2', companyId: 'taebaek' }));
});

it('확인된 검사 기록만 정확한 ID로 공용 삭제 서비스에 전달한다', async () => {
  render(<BenzopyreneLog companyId="taebaek" isAdmin />);
  fireEvent.click(screen.getByRole('button', { name: '검사 기록 삭제' }));
  await waitFor(() => expect(state.remove).toHaveBeenCalledTimes(1));
  expect(services.deleteItem).toHaveBeenCalledWith('benzopyreneTests', 'synthetic-test');
});

it('회사 질의와 회사 전환 때 초안·기록 초기화로 이전 회사 결과가 섞이지 않는다', () => {
  const view = render(<BenzopyreneLog companyId="taebaek" isAdmin />);
  expect(state.subscriptions[0].ref.constraints).toEqual([{ field: 'companyId', op: '==', value: 'taebaek' }]);
  fireEvent.click(screen.getByRole('button', { name: '수정' }));
  fireEvent.change(screen.getByDisplayValue('0.1'), { target: { value: '옛 회사 초안' } });
  const old = state.subscriptions[0];
  view.rerender(<BenzopyreneLog companyId="punghoe" isAdmin />);
  act(() => old.callback({ docs: state.rows.map(row => ({ id: row.id, data: () => row })) }));
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(state.subscriptions.at(-1).ref.constraints).toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
  expect(screen.queryByText('합성 검사 제품')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('옛 회사 초안')).not.toBeInTheDocument();
});
