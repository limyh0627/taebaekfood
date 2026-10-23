/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee,ChatRoom,ChatMessage} from '../types';
const m=vi.hoisted(()=>({upload:vi.fn()}));
vi.mock('../src/firebase',()=>({db:{},auth:{currentUser:{uid:'qa'}}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),collection:vi.fn(()=>({})),query:vi.fn(()=>({})),where:vi.fn(()=>({})),onSnapshot:vi.fn((_q,cb)=>{cb({docs:[]});return()=>{};})}));
vi.mock('../src/shared/chatUpload',async original=>({...await original<typeof import('../src/shared/chatUpload')>(),uploadChatFile:(...a:unknown[])=>m.upload(...a)}));
import OfficeTalk from './OfficeTalk';
const me={id:'me',name:'관리자',companyId:'taebaek',position:'관리자',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const other={...me,id:'other',name:'동료'};
const room={id:'r1',companyId:'taebaek',participantIds:['me','other'],isGroup:false,lastUpdatedAt:'2026-01-01'} as ChatRoom;
const props={currentUser:me,employees:[me,other],chatRooms:[room],chatMessages:[] as ChatMessage[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();});afterEach(cleanup);
it('업로드 대기 뒤 작성한 새 본문은 옛 첨부 전송이 지우지 않는다',async()=>{let finish!:(v:unknown)=>void;m.upload.mockReturnValue(new Promise(r=>{finish=r;}));render(<OfficeTalk {...props} initialRoomId="r1"/>);const input=screen.getByPlaceholderText(/메시지 입력/);fireEvent.change(input,{target:{value:'첨부 원문'}});fireEvent.change(document.querySelector('input[type=file]')!,{target:{files:[new File(['x'],'x.png',{type:'image/png'})]}});fireEvent.change(input,{target:{value:'다음 글'}});await act(async()=>finish({url:'https://example.invalid/x',isImage:true}));expect(input).toHaveValue('다음 글');});
