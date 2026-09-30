// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HaccpChecklist from './HaccpChecklist';
import * as services from '../src/shared/services/firebaseService';

const boundary = vi.hoisted(() => ({ update: vi.fn(), add: vi.fn(), rows: [] as any[], company: 'taebaek' }));
vi.mock('../src/shared/firebase', () => ({
  db: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: boundary.company } }) } },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: any, collection: string, id: string) => ({ collection, id }),
  collection: (_db: any, collection: string) => ({ collection }), query: (ref: any) => ref, orderBy: vi.fn(),
  onSnapshot: (ref: any, callback: any) => {
    if (ref.collection === 'haccp_incoming') callback({ docs: boundary.rows.map(row => ({ id: row.id, data: () => row })) });
    else callback({ exists: () => false });
    return () => {};
  },
  updateDoc: boundary.update, addDoc: boundary.add, deleteDoc: vi.fn(), setDoc: vi.fn(),
  where: vi.fn(), getDocs: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(), documentId: vi.fn(), arrayUnion: vi.fn(),
}));

const month = new Date().toISOString().slice(0, 7);
const record = () => ({ id: 'synthetic-incoming-one', companyId: 'taebaek', month,
  rows: [{ date: '', inboundPartner: '합성 공급처', material: '참깨', materialType: '원료', quantity: '5', unit: 'kg', lotNo: '', expDate: '', appearance: '', packaging: '', label: '', certAvail: '', result: '', corrective: '', inspector: '' }],
  createdBy: '합성 최초', createdAt: '2026-09-30T00:00:00Z', updatedBy: '합성 최초', updatedAt: '2026-09-30T00:00:00Z', revisionCount: 2 });
beforeEach(() => {
  boundary.update.mockReset().mockResolvedValue(undefined); boundary.add.mockReset().mockResolvedValue({ id: 'synthetic-new' });
  boundary.rows = [record()]; boundary.company = 'taebaek'; vi.spyOn(services, 'updateItem'); vi.spyOn(services, 'addItem');
});
const view = () => {
  render(<HaccpChecklist currentUser={{ id: 'synthetic-user', name: '합성 담당' }} isAdmin companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name: /입고검사일지/ }));
};
it('기존 기록 수정은 정확한 ID·행·revision과 로그인 claim 회사를 공용 서비스로 전달한다', async () => {
  view();
  fireEvent.change(screen.getByDisplayValue('합성 공급처'), { target: { value: '수정 공급처' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
  expect(services.updateItem).toHaveBeenCalledWith('haccp_incoming', 'synthetic-incoming-one', expect.objectContaining({ revisionCount: 3, updatedBy: '합성 담당', rows: [expect.objectContaining({ inboundPartner: '수정 공급처' })] }));
  expect(boundary.update).toHaveBeenCalledWith({ collection: 'haccp_incoming', id: 'synthetic-incoming-one' }, expect.objectContaining({ companyId: 'taebaek', revisionCount: 3 }));
});
it('신규 기록은 기존 addItem 경로를 유지한다', async () => {
  boundary.rows = []; view(); fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(boundary.add).toHaveBeenCalledTimes(1));
  expect(services.addItem).toHaveBeenCalledWith('haccp_incoming', expect.objectContaining({ month, revisionCount: 0, createdBy: '합성 담당' }));
  expect(services.updateItem).not.toHaveBeenCalled();
});
it('서비스 완료 전에는 중복 저장을 막고 완료 후 다시 저장할 수 있다', async () => {
  let release!: () => void;
  boundary.update.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  view();
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled());
  expect(boundary.update).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(2));
});
