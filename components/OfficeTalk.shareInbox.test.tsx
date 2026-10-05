/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ChatRoom, Employee } from '../types';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(), discard: vi.fn(), send: vi.fn(),
}));
vi.mock('../src/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(() => ({})),
  onSnapshot: vi.fn((_query, next) => { next({ docs: [] }); return vi.fn(); }),
}));
vi.mock('../src/shared/shareInbox', () => ({
  shareIdFromUrl: () => '123e4567-e89b-42d3-a456-426614174000',
  readSharedFile: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000', file: new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }), text: '견적' }),
  discardSharedFile: mocks.discard,
}));
vi.mock('../src/shared/chatUpload', () => ({
  uploadChatFile: mocks.upload, filesFromPaste: () => [], messageImages: () => [],
  imagePatch: (urls: string[]) => ({ imageUrl: urls[0], images: urls }),
  fileSizeLabel: (size: number) => `${size} B`, saveImage: vi.fn(),
}));
import OfficeTalk from './OfficeTalk';

const me = { id: 'me', name: '나', companyId: 'taebaek', position: '직원', department: '사무', joinDate: '2026-01-01', status: 'working', phone: '' } as Employee;
const room = { id: 'r1', companyId: 'taebaek', participantIds: ['me'], isGroup: false, lastUpdatedAt: '2026-09-24T15:01:00Z' } as ChatRoom;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

it('previews and sends manually, retaining one upload and message on retry', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  mocks.discard.mockResolvedValue(undefined);
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await screen.findByText(/quote.pdf/);
  expect(mocks.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '선택한 대화방에 전송' }));
  await screen.findByText('offline');
  expect(mocks.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '선택한 대화방에 전송' }));
  await waitFor(() => expect(mocks.discard).toHaveBeenCalledTimes(1));
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[0][0]).toEqual(mocks.send.mock.calls[1][0]);
});


it('rejects a different-company room before upload', async () => {
  mocks.upload.mockClear();
  mocks.send.mockClear();
  const foreign = { ...room, id: 'foreign', companyId: 'punghoe' } as ChatRoom;
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[foreign]} chatMessages={[]} initialRoomId="foreign"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button', { name: '선택한 대화방에 전송' }));
  await screen.findByText('본인 회사의 참여 중인 대화방을 선택해 주세요.');
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('blocks repeated clicks during an in-flight upload', async () => {
  mocks.upload.mockClear();
  mocks.send.mockClear();
  let finish!: (value: any) => void;
  mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.send.mockResolvedValue(undefined);
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await screen.findByText(/quote.pdf/);
  const button = screen.getByRole('button', { name: '선택한 대화방에 전송' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  finish({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
});

it('explains why a second share was not accepted', async () => {
  window.history.replaceState(null, '', '/?share=123e4567-e89b-42d3-a456-426614174000&shareRejected=1');
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await screen.findByText(/quote.pdf/);
  expect(screen.getByRole('alert')).toHaveTextContent('새 공유를 받지 않았습니다');
  window.history.replaceState(null, '', '/');
});
