// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TempForm } from './HaccpChecklist';
import { today } from '../src/shared/day';
import * as services from '../src/shared/services/firebaseService';

const boundary = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), token: vi.fn(), rows: [] as any[] }));
vi.mock('../src/shared/firebase', () => ({
  db: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: boundary.token } },
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }), query: (ref: unknown) => ref, orderBy: vi.fn(),
  onSnapshot: (ref: any, callback: any) => {
    if (ref.collection === 'haccp_temp') callback({ docs: boundary.rows.map(row => ({ id: row.id, data: () => row })) });
    else callback({ exists: () => false });
    return () => {};
  },
  updateDoc: boundary.update, deleteDoc: boundary.remove, addDoc: vi.fn(), setDoc: vi.fn(),
  where: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(), documentId: vi.fn(), arrayUnion: vi.fn(),
}));

beforeEach(() => {
  boundary.update.mockReset().mockResolvedValue(undefined);
  boundary.remove.mockReset().mockResolvedValue(undefined);
  boundary.token.mockReset().mockResolvedValue({ claims: { companyId: 'taebaek' } });
  boundary.rows = [{ id: 'synthetic-temp', companyId: 'taebaek', date: today(), measureTime: '12:30',
    rows: [{ zone: '합성 냉장창고', temp: '5', result: 'O', corrective: '', inspector: '합성 담당' }],
    createdBy: '합성 담당', createdAt: '2026-10-07T00:00:00Z', revisionCount: 2 }];
  vi.spyOn(services, 'updateItem');
  vi.spyOn(services, 'deleteItem');
});
const view = () => {
  render(<TempForm currentUser={{ id: 'synthetic-user', name: '합성 담당' }} isAdmin canConfirm />);
  fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
};

it('온도 수정은 회사 claim을 확인한 후 기존 기록과 revision을 공용 서비스로 저장한다', async () => {
  let release!: (value: unknown) => void;
  boundary.token.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  view();
  fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(boundary.token).toHaveBeenCalledTimes(1));
  expect(boundary.update).not.toHaveBeenCalled();
  release({ claims: { companyId: 'taebaek' } });
  await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
  expect(services.updateItem).toHaveBeenCalledWith('haccp_temp', 'synthetic-temp', expect.objectContaining({ revisionCount: 3 }));
  expect(boundary.update).toHaveBeenCalledWith({ collection: 'haccp_temp', id: 'synthetic-temp' }, expect.objectContaining({
    companyId: 'taebaek', revisionCount: 3, rows: [expect.objectContaining({ temp: '7' })],
  }));
});

it('관리자 확인도 회사 claim을 포함하고 저장 완료 뒤 확인완료를 표시한다', async () => {
  view();
  fireEvent.click(screen.getByRole('button', { name: '관리자 확인' }));
  await waitFor(() => expect(screen.getByText(/합성 담당 확인완료/)).toBeVisible());
  expect(services.updateItem).toHaveBeenCalledWith('haccp_temp', 'synthetic-temp', expect.objectContaining({ confirmedBy: '합성 담당' }));
  expect(boundary.update).toHaveBeenCalledWith({ collection: 'haccp_temp', id: 'synthetic-temp' }, expect.objectContaining({ companyId: 'taebaek', confirmedBy: '합성 담당' }));
});

it('과거 기록 삭제는 확인 후 공용 삭제 서비스에 정확한 기록 ID를 전달한다', async () => {
  boundary.rows[0].date = '2020-01-01';
  render(<TempForm currentUser={{ id: 'synthetic-user', name: '합성 담당' }} isAdmin />);
  fireEvent.click(screen.getByRole('button', { name: /이전 측정 기록/ }));
  fireEvent.click(screen.getByRole('button', { name: '' }));
  await waitFor(() => expect(boundary.remove).toHaveBeenCalledTimes(1));
  expect(services.deleteItem).toHaveBeenCalledWith('haccp_temp', 'synthetic-temp');
});
