/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ChatRoom, Employee } from '../types';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(), discard: vi.fn(), send: vi.fn(), missing: false, shareId: '123e4567-e89b-42d3-a456-426614174000' as string | null,
}));
vi.mock('../src/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'firebase-user' } } }));
vi.mock('../src/shared/services/sharedChatMessageService', () => ({ sharedChatActor: async () => 'firebase-user' }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(() => ({})),
  onSnapshot: vi.fn((_query, next) => { next({ docs: [] }); return vi.fn(); }),
}));
vi.mock('../src/shared/shareInbox', () => ({
  shareIdFromUrl: () => mocks.shareId,
  readSharedFile: async () => { if(mocks.missing) throw Error('캐시 없음'); return ({ id: '123e4567-e89b-42d3-a456-426614174000', file: new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }), text: '견적' }); },
  discardSharedFile: mocks.discard,
}));
vi.mock('../src/shared/chatUpload', () => ({
  uploadChatFile: mocks.upload, filesFromPaste: () => [], messageImages: () => [],
  imagePatch: (urls: string[]) => ({ imageUrl: urls[0], images: urls }),
  fileSizeLabel: (size: number) => `${size} B`, saveImage: vi.fn(),
}));
import OfficeTalk from './OfficeTalk';
import { beginSharedChatAttempt, completeSharedChatAttempt } from '../src/shared/sharedChatAttempt';

const me = { id: 'me', name: '나', companyId: 'taebaek', position: '직원', department: '사무', joinDate: '2026-01-01', status: 'working', phone: '' } as Employee;
const room = { id: 'r1', companyId: 'taebaek', participantIds: ['me'], isGroup: false, lastUpdatedAt: '2026-09-24T15:01:00Z' } as ChatRoom;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('crypto', webcrypto); });
beforeEach(() => { localStorage.clear(); mocks.missing=false; mocks.shareId='123e4567-e89b-42d3-a456-426614174000'; mocks.upload.mockReset(); mocks.send.mockReset(); mocks.discard.mockReset(); });

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
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
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

it('응답 유실 후 재마운트에서 다른 방을 거절하고 최초 원문만 재시도한다', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockRejectedValueOnce(Error('응답 유실')).mockResolvedValue(undefined);
  mocks.discard.mockResolvedValue(undefined);
  const props={currentUser:me,employees:[me],chatRooms:[room,{...room,id:'r2'}],chatMessages:[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
  const first=render(<OfficeTalk {...props} initialRoomId="r1"/>);
  await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await screen.findByText('응답 유실');
  const original=mocks.send.mock.calls[0]; first.unmount();
  const second=render(<OfficeTalk {...props} initialRoomId="r2"/>);
  await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await screen.findByText('이미 선택한 최초 대화방에서 다시 시도하거나 공유 파일을 폐기해 주세요.');
  expect(mocks.send).toHaveBeenCalledTimes(1); second.unmount();
  render(<OfficeTalk {...props} initialRoomId="r1"/>);
  await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await waitFor(()=>expect(mocks.discard).toHaveBeenCalledTimes(1));
  expect(mocks.send.mock.calls[1]).toEqual(original); expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
});

it('캐시 삭제 실패 후 파일이 없는 재마운트에서도 완성 원문으로 결과를 확인한다', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockResolvedValue(undefined);
  mocks.discard.mockRejectedValueOnce(Error('캐시 삭제 실패')).mockResolvedValue(undefined);
  const props={currentUser:me,employees:[me],chatRooms:[room],chatMessages:[],initialRoomId:'r1',onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
  const first=render(<OfficeTalk {...props}/>); await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'})); await screen.findByText('캐시 삭제 실패');
  const original=mocks.send.mock.calls[0]; first.unmount(); mocks.missing=true;
  render(<OfficeTalk {...props}/>); await screen.findByText(/quote.pdf/);
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await waitFor(()=>expect(mocks.discard).toHaveBeenCalledTimes(2));
  expect(mocks.send.mock.calls[1]).toEqual(original); expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
});

it('최초 원문 보존이 실패하면 업로드와 메시지 전송을 시작하지 않는다',async()=>{
 const store=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('저장 공간 부족');});
 try{
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
  await screen.findByText(/quote.pdf/);fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await screen.findByText('저장 공간 부족');expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
 }finally{store.mockRestore();}
});

it('화면이 닫힌 동안 업로드가 끝나도 메시지를 보내거나 원문을 정리하지 않는다',async()=>{
 let finish!:(value:any)=>void;mocks.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
 await screen.findByText(/quote.pdf/);fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.upload).toHaveBeenCalledTimes(1));view.unmount();
 finish({url:'https://example.test/quote.pdf',name:'quote.pdf',size:3,isImage:false});
 await new Promise(resolve=>setTimeout(resolve,10));expect(mocks.send).not.toHaveBeenCalled();expect(mocks.discard).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
});

it('캐시와 URL은 지워졌지만 pending 정리에 실패하면 URL 없는 재마운트로 재확인한다',async()=>{
 mocks.upload.mockResolvedValue({url:'https://example.test/quote.pdf',name:'quote.pdf',size:3,isImage:false});mocks.send.mockResolvedValue(undefined);
 mocks.discard.mockImplementation(async()=>{mocks.missing=true;mocks.shareId=null;});
 const props={currentUser:me,employees:[me],chatRooms:[room],chatMessages:[],initialRoomId:'r1',onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('원문 정리 실패');});
 const first=render(<OfficeTalk {...props}/>);await screen.findByText(/quote.pdf/);
 fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await screen.findByText('원문 정리 실패');
 const original=mocks.send.mock.calls[0];first.unmount();remove.mockRestore();
 render(<OfficeTalk {...props}/>);await screen.findByText(/quote.pdf/);
 fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await waitFor(()=>expect(localStorage.length).toBe(0));
 expect(mocks.send.mock.calls[1]).toEqual(original);expect(mocks.upload).toHaveBeenCalledTimes(1);
});

it('URL 없는 복수 보존 전송은 사용자가 고른 원문만 결과 확인한다',async()=>{
 mocks.shareId=null;mocks.missing=true;mocks.send.mockResolvedValue(undefined);mocks.discard.mockResolvedValue(undefined);
 const ids=['123e4567-e89b-42d3-a456-426614174000','123e4567-e89b-42d3-a456-426614174001'];
 const messages: import("../src/shared/types").ChatMessage[]=[];
 for(const [index,id] of ids.entries()){
  const a=await beginSharedChatAttempt('taebaek','firebase-user',{id,file:new File(['pdf'],'quote'+index+'.pdf',{type:'application/pdf'}),text:'원문'+index},'r1','me','나');
  const m={id:'MSG-share-'+id,companyId:'taebaek' as const,roomId:a.roomId,senderId:a.senderId,senderName:a.senderName,text:a.text,createdAt:a.createdAt,fileUrl:'https://example.test/'+index,fileName:a.file.name,fileSize:a.file.size};
  completeSharedChatAttempt(a,m);messages.push(m);
 }
 render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
  onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
 const select=await screen.findByRole('button',{name:'보존 전송 선택: quote1.pdf · r1'});
 expect(mocks.send).not.toHaveBeenCalled();fireEvent.click(select);
 fireEvent.click(await screen.findByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.send).toHaveBeenCalledWith(messages[1],ids[1]));
 await waitFor(()=>expect(localStorage.length).toBe(1));expect(mocks.upload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'보존 전송 선택: quote0.pdf · r1'}));
 fireEvent.click(await screen.findByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.send).toHaveBeenCalledWith(messages[0],ids[0]));
 await waitFor(()=>expect(localStorage.length).toBe(0));expect(mocks.send).toHaveBeenCalledTimes(2);
});

it('다른 회사·Firebase UID 보존 원문은 현재 사용자 화면에서 열거나 정리하지 않는다',async()=>{
 mocks.shareId=null;
 await beginSharedChatAttempt('punghoe','foreign-user',{id:'123e4567-e89b-42d3-a456-426614174000',file:new File(['pdf'],'foreign.pdf',{type:'application/pdf'}),text:'다른회사'},'foreign','foreign','외부');
 render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
  onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
 await act(async()=>{await Promise.resolve();});
 expect(screen.queryByText(/foreign.pdf/)).toBeNull();expect(screen.queryByTestId('shared-file-draft')).toBeNull();
 expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
});
