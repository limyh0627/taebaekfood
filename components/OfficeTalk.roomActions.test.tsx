/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee,ChatRoom,ChatMessage} from '../types';
const m=vi.hoisted(()=>({upload:vi.fn(),messages:[{id:'source',roomId:'r1',senderId:'other',senderName:'동료',text:'전달 원문',createdAt:'2026-10-23T00:00:00Z'}]}));
vi.mock('../src/firebase',()=>({db:{},auth:{currentUser:{uid:'qa'}}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),collection:vi.fn(()=>({})),query:vi.fn(()=>({})),where:vi.fn(()=>({})),onSnapshot:vi.fn((_q,cb)=>{cb({docs:m.messages.map(message=>({id:message.id,data:()=>message}))});return()=>{};})}));
vi.mock('../src/shared/chatUpload',async original=>({...await original<typeof import('../src/shared/chatUpload')>(),uploadChatFile:(...a:unknown[])=>m.upload(...a)}));
import OfficeTalk from './OfficeTalk';
const me={id:'me',name:'관리자',companyId:'taebaek',position:'관리자',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const other={...me,id:'other',name:'동료'};
const room={id:'r1',companyId:'taebaek',participantIds:['me','other'],isGroup:false,lastUpdatedAt:'2026-01-01'} as ChatRoom;
const props={currentUser:me,employees:[me,other],chatRooms:[room],chatMessages:[] as ChatMessage[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();});afterEach(cleanup);
it('방 이름 저장 대기에는 작성창과 원문을 유지한다',()=>{render(<OfficeTalk {...props} initialRoomId="r1" onUpdateRoom={()=>new Promise(()=>{})}/>);fireEvent.click(screen.getByRole('button',{name:'이름 바꾸기'}));const input=screen.getByPlaceholderText('모두에게 보일 이름');fireEvent.change(input,{target:{value:'새 이름'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(input).toBeDisabled();expect(screen.getByPlaceholderText('모두에게 보일 이름')).toHaveValue('새 이름');});
