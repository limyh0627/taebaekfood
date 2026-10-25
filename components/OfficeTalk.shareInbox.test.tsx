/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ChatRoom, Employee } from '../types';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(), discard: vi.fn(), send: vi.fn(), missing: false, shareId: '123e4567-e89b-42d3-a456-426614174000' as string | null,
}));
const firebaseFixture=vi.hoisted(()=>({db:{},storage:{},authReady:Promise.resolve(),auth:{currentUser:{uid:'firebase-user'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/firebase',()=>firebaseFixture);
vi.mock('../src/shared/firebase',()=>firebaseFixture);
vi.mock('firebase/storage',()=>({ref:vi.fn(),uploadBytes:vi.fn(),getDownloadURL:vi.fn()}));
vi.mock('../src/shared/services/sharedChatMessageService', () => ({ sharedChatActor: async () => 'firebase-user' }));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),runTransaction:vi.fn(),getDocFromServer:vi.fn(),
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
import {auth} from '../src/firebase';
import {SHARE_KEY,resetShareRead} from '../src/shared/shareTarget';
import {readSharedChatAttempts,readRetainedSharedChatAttempts} from '../src/shared/sharedChatAttempt';
import { beginSharedChatAttempt, completeSharedChatAttempt, beginSharedTextChatAttempt } from '../src/shared/sharedChatAttempt';

function ack(message:any,shareId:string,actorUid='firebase-user'){return Promise.resolve({companyId:'taebaek',actorUid,shareId,messageText:JSON.stringify(message)});}
async function chooseFile(){await act(async()=>{});const list=within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:/공유 실패 /});if(!list.textContent?.endsWith('0')){fireEvent.click(list);fireEvent.click(await screen.findByRole('button',{name:/quote.pdf · r1/}));}else fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 파일 연결'}));await screen.findByText(/quote.pdf/);}
const me = { id: 'me', name: '나', companyId: 'taebaek', position: '직원', department: '사무', joinDate: '2026-01-01', status: 'working', phone: '' } as Employee;
const room = { id: 'r1', companyId: 'taebaek', participantIds: ['me'], isGroup: false, lastUpdatedAt: '2026-09-24T15:01:00Z' } as ChatRoom;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('crypto', webcrypto); });
beforeEach(() => { localStorage.clear();sessionStorage.clear();resetShareRead();(auth.currentUser as any).uid='firebase-user'; mocks.missing=false; mocks.shareId='123e4567-e89b-42d3-a456-426614174000'; mocks.upload.mockReset(); mocks.send.mockReset();mocks.send.mockImplementation(ack); mocks.discard.mockReset(); });

it('previews and sends manually, retaining one upload and message on retry', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(ack);
  mocks.discard.mockResolvedValue(undefined);
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await chooseFile();
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
  fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 파일 연결'}));
  await screen.findByText('현재 회사의 참여 중인 대화방을 선택해주세요.');
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('blocks repeated clicks during an in-flight upload', async () => {
  mocks.upload.mockClear();
  mocks.send.mockClear();
  let finish!: (value: any) => void;
  mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.send.mockImplementation(ack);
  render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send} />);
  await chooseFile();
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
  fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:/공유 실패 /}));
  expect(screen.getByText(/새 공유를 받지 않았습니다/)).toBeInTheDocument();
  window.history.replaceState(null, '', '/');
});

it('응답 유실 후 재마운트에서 다른 방을 거절하고 최초 원문만 재시도한다', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockRejectedValueOnce(Error('응답 유실')).mockImplementation(ack);
  mocks.discard.mockResolvedValue(undefined);
  const props={currentUser:me,employees:[me],chatRooms:[room,{...room,id:'r2'}],chatMessages:[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
  const first=render(<OfficeTalk {...props} initialRoomId="r1"/>);
  await chooseFile();
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await screen.findByText('응답 유실');
  const original=mocks.send.mock.calls[0]; first.unmount();
  const second=render(<OfficeTalk {...props} initialRoomId="r2"/>);
  await chooseFile();
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await screen.findByText('이미 선택한 최초 대화방에서 같은 내용으로 다시 시도해 주세요.');
  expect(mocks.send).toHaveBeenCalledTimes(1); second.unmount();
  render(<OfficeTalk {...props} initialRoomId="r1"/>);
  await chooseFile();
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
  await waitFor(()=>expect(mocks.discard).toHaveBeenCalledTimes(1));
  expect(mocks.send.mock.calls[1]).toEqual(original); expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
});

it('캐시 삭제 실패 후 파일이 없는 재마운트에서도 완성 원문으로 결과를 확인한다', async () => {
  mocks.upload.mockResolvedValue({ url: 'https://example.test/quote.pdf', name: 'quote.pdf', size: 3, isImage: false });
  mocks.send.mockImplementation(ack);
  mocks.discard.mockRejectedValueOnce(Error('캐시 삭제 실패')).mockResolvedValue(undefined);
  const props={currentUser:me,employees:[me],chatRooms:[room],chatMessages:[],initialRoomId:'r1',onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
  const first=render(<OfficeTalk {...props}/>); await chooseFile();
  fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'})); await screen.findByText('캐시 삭제 실패');
  const original=mocks.send.mock.calls[0]; first.unmount(); mocks.missing=true;
  render(<OfficeTalk {...props}/>); await chooseFile();
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
  fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 파일 연결'}));
  await screen.findByText('저장 공간 부족');expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
 }finally{store.mockRestore();}
});

it('화면이 닫힌 동안 업로드가 끝나도 메시지를 보내거나 원문을 정리하지 않는다',async()=>{
 let finish!:(value:any)=>void;mocks.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
    onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
 await chooseFile();fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.upload).toHaveBeenCalledTimes(1));view.unmount();
 finish({url:'https://example.test/quote.pdf',name:'quote.pdf',size:3,isImage:false});
 await new Promise(resolve=>setTimeout(resolve,10));expect(mocks.send).not.toHaveBeenCalled();expect(mocks.discard).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
});

it('캐시와 URL은 지워졌지만 pending 정리에 실패하면 URL 없는 재마운트로 재확인한다',async()=>{
 mocks.upload.mockResolvedValue({url:'https://example.test/quote.pdf',name:'quote.pdf',size:3,isImage:false});mocks.send.mockImplementation(ack);
 mocks.discard.mockImplementation(async()=>{mocks.missing=true;mocks.shareId=null;});
 const props={currentUser:me,employees:[me],chatRooms:[room],chatMessages:[],initialRoomId:'r1',onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('원문 정리 실패');});
 const first=render(<OfficeTalk {...props}/>);await chooseFile();
 fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await screen.findByText('원문 정리 실패');
 const original=mocks.send.mock.calls[0];first.unmount();remove.mockRestore();
 render(<OfficeTalk {...props}/>);await chooseFile();
 fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await waitFor(()=>expect(localStorage.length).toBe(0));
 expect(mocks.send.mock.calls[1]).toEqual(original);expect(mocks.upload).toHaveBeenCalledTimes(1);
});

it('URL 없는 복수 보존 전송은 사용자가 고른 원문만 결과 확인한다',async()=>{
 mocks.shareId=null;mocks.missing=true;mocks.send.mockImplementation(ack);mocks.discard.mockResolvedValue(undefined);
 const ids=['123e4567-e89b-42d3-a456-426614174000','123e4567-e89b-42d3-a456-426614174001'];
 const messages: import("../src/shared/types").ChatMessage[]=[];
 for(const [index,id] of ids.entries()){
  const a=await beginSharedChatAttempt('taebaek','firebase-user',{id,file:new File(['pdf'],'quote'+index+'.pdf',{type:'application/pdf'}),text:'원문'+index},'r1','me','나');
  const m={id:'MSG-share-'+id,companyId:'taebaek' as const,roomId:a.roomId,senderId:a.senderId,senderName:a.senderName,text:a.text,createdAt:a.createdAt,fileUrl:'https://example.test/'+index,fileName:a.file.name,fileSize:a.file.size};
  completeSharedChatAttempt(a,m);messages.push(m);
 }
 render(<OfficeTalk currentUser={me} employees={[me]} chatRooms={[room]} chatMessages={[]} initialRoomId="r1"
  onAddRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} onSendMessage={mocks.send}/>);
 fireEvent.click(await within(screen.getByTestId('shared-controls-desktop')).findByRole('button',{name:/공유 실패 2/}));const select=await screen.findByRole('button',{name:/quote1.pdf · r1/});
 expect(mocks.send).not.toHaveBeenCalled();fireEvent.click(select);
 fireEvent.click(await screen.findByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.send).toHaveBeenCalledWith(messages[1],ids[1],'firebase-user'));
 await waitFor(()=>expect(localStorage.length).toBe(1));expect(mocks.upload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:/quote0.pdf · r1/}));
 fireEvent.click(await screen.findByRole('button',{name:'선택한 대화방에 전송'}));
 await waitFor(()=>expect(mocks.send).toHaveBeenCalledWith(messages[0],ids[0],'firebase-user'));
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

const textProps={currentUser:me,employees:[me],chatRooms:[room],chatMessages:[],initialRoomId:'r1',onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:mocks.send};
it('미연결 글은 노출·전송하지 않고 명시 연결의 최초 원문으로 실패 뒤 재시도한다',async()=>{
 mocks.shareId=null;sessionStorage.setItem(SHARE_KEY,'  첫 공유 원문\n둘째줄  ');mocks.send.mockRejectedValueOnce(Error('응답 미확인'));
 render(<OfficeTalk {...textProps}/>);expect(screen.queryByText(/첫 공유 원문/)).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 내용 연결'}));await screen.findByText(/첫 공유 원문/);const entry=readSharedChatAttempts('taebaek','firebase-user')[0];expect(entry.kind).toBe('text');expect(sessionStorage.getItem(SHARE_KEY)).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await screen.findByText('응답 미확인');fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await waitFor(()=>expect(readSharedChatAttempts('taebaek','firebase-user')).toHaveLength(0));expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);expect(mocks.upload).not.toHaveBeenCalled();
});
it('임의 ACK는 원문을 정리하지 않고 삭제는 목록만 제외한다',async()=>{
 mocks.shareId=null;sessionStorage.setItem(SHARE_KEY,'원문 A');mocks.send.mockResolvedValue({id:'임의 응답'});render(<OfficeTalk {...textProps}/>);fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 내용 연결'}));await screen.findByText('원문 A');fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await screen.findByText(/처리 결과를 확인하지 못했습니다/);expect(readSharedChatAttempts('taebaek','firebase-user')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'실패 요청 삭제'}));await waitFor(()=>expect(readSharedChatAttempts('taebaek','firebase-user')).toHaveLength(0));expect(readRetainedSharedChatAttempts('taebaek','firebase-user')).toHaveLength(1);expect(mocks.discard).not.toHaveBeenCalled();
});
it('응답 대기 중 UID가 바뀌면 정확한 ACK도 이전 원문을 지우지 않는다',async()=>{
 mocks.shareId=null;sessionStorage.setItem(SHARE_KEY,'원문 A');let finish!:(value:any)=>void;mocks.send.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<OfficeTalk {...textProps}/>);fireEvent.click(within(screen.getByTestId('shared-controls-desktop')).getByRole('button',{name:'공유 내용 연결'}));await screen.findByText('원문 A');fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await waitFor(()=>expect(mocks.send).toHaveBeenCalledOnce());const [msg,id,uid]=mocks.send.mock.calls[0];(auth.currentUser as any).uid='different';await act(async()=>{finish(await ack(msg,id,uid));});expect(readRetainedSharedChatAttempts('taebaek','firebase-user')).toHaveLength(1);expect(mocks.discard).not.toHaveBeenCalled();
});

it('모바일 선택 대화방에서 공유 연결과 실패 삭제가 같은 최초 요청을 사용한다',async()=>{
 mocks.shareId=null;sessionStorage.setItem(SHARE_KEY,'모바일 원문');mocks.send.mockRejectedValue(Error('전송 결과 미확인'));render(<OfficeTalk {...textProps}/>);const controls=screen.getByTestId('shared-controls-mobile');expect(controls).toHaveClass('lg:hidden');expect(screen.getByTestId('shared-controls-desktop').closest('.hidden')).toHaveClass('lg:flex');expect(screen.queryByText('모바일 원문')).toBeNull();fireEvent.click(within(controls).getByRole('button',{name:'공유 내용 연결'}));await screen.findByText('모바일 원문');const original=readSharedChatAttempts('taebaek','firebase-user')[0];fireEvent.click(screen.getByRole('button',{name:'선택한 대화방에 전송'}));await screen.findByText('전송 결과 미확인');expect(mocks.send.mock.calls[0][1]).toBe(original.shareId);expect(screen.getByTestId('shared-controls-desktop').parentElement!.contains(screen.getByRole('dialog'))).toBe(false);fireEvent.click(screen.getByRole('button',{name:'실패 요청 삭제'}));await waitFor(()=>expect(readSharedChatAttempts('taebaek','firebase-user')).toHaveLength(0));expect(readRetainedSharedChatAttempts('taebaek','firebase-user')[0]).toEqual(original);expect(within(controls).getByRole('button',{name:'공유 실패 0'})).toBeInTheDocument();
});
