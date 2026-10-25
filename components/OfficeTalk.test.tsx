/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatRoom, Employee } from '../types';

const messages = vi.hoisted(() => [
  { id: 'm2', roomId: 'r1', senderId: 'other', senderName: '동료', text: '자정 뒤', createdAt: '2026-09-24T15:01:00Z' },
  { id: 'm1', roomId: 'r1', senderId: 'other', senderName: '동료', text: '자정 전', createdAt: '2026-09-24T14:59:00Z' },
]);
const firebaseFixture=vi.hoisted(()=>({db:{},storage:{},authReady:Promise.resolve(),auth:{currentUser:{uid:'firebase-user'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/firebase',()=>firebaseFixture);
vi.mock('../src/shared/firebase',()=>firebaseFixture);
vi.mock('firebase/storage',()=>({ref:vi.fn(),uploadBytes:vi.fn(),getDownloadURL:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),runTransaction:vi.fn(),getDocFromServer:vi.fn(),
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(() => ({})),
  onSnapshot: vi.fn((_query, onNext) => {
    onNext({ docs: messages.map(message => ({ id: message.id, data: () => message })) });
    return vi.fn();
  }),
}));

vi.mock('../src/shared/chatUpload', async importOriginal => ({...(await importOriginal<typeof import('../src/shared/chatUpload')>()),saveImage:vi.fn()}));
import {saveImage} from '../src/shared/chatUpload';
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
it('사진과 배경 클릭은 보기·작성초안을 유지하고 이전다음·저장·명시닫기를 보존한다',async()=>{
 const original={...messages[0]};Object.assign(messages[0],{images:['https://example.test/photo-1.png','https://example.test/photo-2.png']});
 try{
  render(<OfficeTalk {...props}/>);
  await screen.findByText('자정 뒤');
  const input=screen.getByPlaceholderText(/메시지/);fireEvent.change(input,{target:{value:'작성중인 메시지'}});
  const thumb=document.querySelector('img[src="https://example.test/photo-1.png"]')!;fireEvent.click(thumb);
  const viewer=screen.getByRole('button',{name:'다음 사진'}).parentElement!;
  fireEvent.click(viewer);fireEvent.click(viewer.querySelector('img')!);
  expect(viewer.isConnected).toBe(true);expect(input).toHaveValue('작성중인 메시지');
  fireEvent.click(screen.getByRole('button',{name:'다음 사진'}));expect(viewer.querySelector('img')).toHaveAttribute('src','https://example.test/photo-2.png');
  fireEvent.click(screen.getByRole('button',{name:'이전 사진'}));expect(viewer.querySelector('img')).toHaveAttribute('src','https://example.test/photo-1.png');
  fireEvent.click(within(viewer).getByRole('button',{name:/저장/}));expect(saveImage).toHaveBeenCalledWith('https://example.test/photo-1.png');expect(viewer.isConnected).toBe(true);
  fireEvent.click(within(viewer).getByRole('button',{name:'닫기'}));expect(viewer.isConnected).toBe(false);expect(input).toHaveValue('작성중인 메시지');expect(props.onSendMessage).not.toHaveBeenCalled();
 }finally{Object.keys(messages[0]).forEach(key=>Reflect.deleteProperty(messages[0],key));Object.assign(messages[0],original);}
});
