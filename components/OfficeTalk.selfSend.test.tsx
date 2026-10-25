/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee,ChatRoom,ChatMessage} from '../types';
const m=vi.hoisted(()=>({upload:vi.fn(),messages:[{id:'source',roomId:'r1',senderId:'other',senderName:'동료',text:'전달 원문',createdAt:'2026-10-23T00:00:00Z'}]}));
const firebaseFixture=vi.hoisted(()=>({db:{},storage:{},authReady:Promise.resolve(),auth:{currentUser:{uid:'qa'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/firebase',()=>firebaseFixture);
vi.mock('../src/shared/firebase',()=>firebaseFixture);
vi.mock('firebase/storage',()=>({ref:vi.fn(),uploadBytes:vi.fn(),getDownloadURL:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),runTransaction:vi.fn(),getDocFromServer:vi.fn(),collection:vi.fn(()=>({})),query:vi.fn(()=>({})),where:vi.fn(()=>({})),onSnapshot:vi.fn((_q,cb)=>{cb({docs:m.messages.map(message=>({id:message.id,data:()=>message}))});return()=>{};})}));
vi.mock('../src/shared/chatUpload',async original=>({...await original<typeof import('../src/shared/chatUpload')>(),uploadChatFile:(...a:unknown[])=>m.upload(...a)}));
import OfficeTalk from './OfficeTalk';
const me={id:'me',name:'관리자',companyId:'taebaek',position:'관리자',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const other={...me,id:'other',name:'동료'};
const room={id:'r1',companyId:'taebaek',participantIds:['me','other'],isGroup:false,lastUpdatedAt:'2026-01-01'} as ChatRoom;
const props={currentUser:me,employees:[me,other],chatRooms:[room],chatMessages:[] as ChatMessage[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();});afterEach(cleanup);
it('자기방 생성이 완료되기 전에는 메시지를 보내지 않는다',()=>{const add=vi.fn(()=>new Promise(()=>{})),send=vi.fn();render(<OfficeTalk {...props} initialRoomId="r1" onAddRoom={add} onSendMessage={send}/>);fireEvent.contextMenu(screen.getByText('전달 원문'));fireEvent.click(screen.getByRole('button',{name:'나에게'}));expect(add).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();});
