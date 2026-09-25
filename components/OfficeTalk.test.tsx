/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatRoom, Employee } from '../types';

const messages = vi.hoisted(() => [
  { id: 'm2', roomId: 'r1', senderId: 'other', senderName: '동료', text: '자정 뒤', createdAt: '2026-09-24T15:01:00Z' },
  { id: 'm1', roomId: 'r1', senderId: 'other', senderName: '동료', text: '자정 전', createdAt: '2026-09-24T14:59:00Z' },
]);
vi.mock('../src/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(() => ({})),
  onSnapshot: vi.fn((_query, onNext) => {
    onNext({ docs: messages.map(message => ({ id: message.id, data: () => message })) });
    return vi.fn();
  }),
}));

import OfficeTalk from './OfficeTalk';

const me = { id: 'me', name: '관리자', companyId: 'taebaek', position: '관리자', department: '사무', joinDate: '2026-01-01', status: 'working', phone: '' } as Employee;
const room = { id: 'r1', companyId: 'taebaek', participantIds: ['me', 'other'], isGroup: false, lastUpdatedAt: '2026-09-24T15:01:00Z' } as ChatRoom;
const props = {
  currentUser: me, employees: [me], chatRooms: [room], chatMessages: [] as ChatMessage[],
  initialRoomId: 'r1', onAddRoom: vi.fn(), onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn(), onSendMessage: vi.fn(),
};

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

describe('오피스톡 메시지 날짜와 주문 출처', () => {
  it('KST 날짜가 바뀌는 두 말을 순서대로 표시하고 각 말에 날짜·시각을 붙인다', async () => {
    render(<OfficeTalk {...props} />);
    await screen.findByText('자정 전');

    const text = document.body.textContent ?? '';
    expect(text.indexOf('자정 전')).toBeLessThan(text.indexOf('자정 뒤'));
    expect(screen.getByText('2026.09.24 23:59 KST')).toBeInTheDocument();
    expect(screen.getByText('2026.09.25 00:01 KST')).toBeInTheDocument();
    expect(screen.getAllByRole('separator').map(element => element.getAttribute('aria-label')))
      .toEqual(['2026-09-24', '2026-09-25']);
    expect(screen.getAllByText('동료')).toHaveLength(2);
  });

  it('주문 추출창을 여는 것만으로는 체크하지 않고 저장 주문이 연결된 메시지만 표시한다', async () => {
    const onExtractOrder = vi.fn();
    const { rerender } = render(<OfficeTalk {...props} onExtractOrder={onExtractOrder} onUpdateMessage={vi.fn()} extractedMessageIds={[]} />);
    const bubble = await screen.findByText('자정 전');
    fireEvent.contextMenu(bubble);
    fireEvent.click(screen.getByRole('button', { name: '주문 추출하기' }));
    expect(onExtractOrder).toHaveBeenCalledWith('m1', '자정 전');
    expect(screen.queryByLabelText('주문 생성 완료')).not.toBeInTheDocument();

    rerender(<OfficeTalk {...props} onExtractOrder={onExtractOrder} onUpdateMessage={vi.fn()} extractedMessageIds={['m1']} />);
    await waitFor(() => expect(screen.getByLabelText('주문 생성 완료')).toBeInTheDocument());
    expect(within(screen.getByLabelText('주문 생성 완료')).getByText('주문 생성')).toBeInTheDocument();
  });
});
